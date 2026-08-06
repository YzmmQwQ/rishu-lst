import { timingSafeEqual } from 'node:crypto'
import type { AudioQuality, RoomListItem, User, UserRole } from '@music-together/shared'
import { nanoid } from 'nanoid'
import type { RoomData } from '../repositories/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { chatRepo } from '../repositories/chatRepository.js'
import { scheduleDeletion, cancelDeletionTimer } from './roomLifecycleService.js'
import { consumeRejoinTicket } from './rejoinTicketService.js'
import { estimateCurrentTime } from './syncService.js'
import { updateVoteThreshold } from './voteService.js'
import { logger } from '../utils/logger.js'
import type { TypedServer } from '../middleware/types.js'

// Re-export from their new homes so existing `roomService.xxx()` callers
// in controllers don't need import changes.
export { toPublicRoomState, toPublicRoomStateForOwner } from '../utils/roomUtils.js'
export { broadcastRoomList } from './roomLifecycleService.js'

// ---------------------------------------------------------------------------
// Room role invariant + conductor election
// ---------------------------------------------------------------------------

function isPermanentPrivileged(room: RoomData, userId: string): boolean {
  return userId === room.creatorId || room.adminUserIds.has(userId)
}

function setRoleIfChanged(user: User, role: UserRole): boolean {
  if (user.role === role) return false
  user.role = role
  return true
}

/**
 * 保证非空房间始终至少有一个具备管理能力的在线用户，并维护临时管理员集合。
 *
 * - creator 在线：creator 为 owner，清空临时管理员集合
 * - 持久 admin 在线：保持 admin，清空临时管理员集合（房主/持久 admin 上线时
 *   所有临时管理员自动降回 member —— "房主上线自动降级"语义）
 * - owner / 持久 admin 都不在线：保留并剪枝临时管理员集合（移除已离线成员），
 *   仅当集合为空时自动授予 users[0] 临时 admin，保证非空房间始终 ≥1 个可管理在线用户。
 *   显式凭 superPassword 授权的成员已在集合中，不会被这里的自动补位覆盖。
 *   集合内 → admin，其余 → member。
 *
 * 临时管理员仅存在于当前在线会话，不写入 adminUserIds；当 owner / 持久 admin
 * 回来时自动降回 member。
 */
function reconcileRoomRoles(room: RoomData): boolean {
  let changed = false

  if (room.users.length === 0) {
    if (room.temporaryAdminUserIds.size > 0) {
      room.temporaryAdminUserIds.clear()
      changed = true
    }
    return changed
  }

  const hasOnlinePermanentPrivileged = room.users.some((u) => isPermanentPrivileged(room, u.id))

  if (hasOnlinePermanentPrivileged) {
    if (room.temporaryAdminUserIds.size > 0) {
      room.temporaryAdminUserIds.clear()
      changed = true
    }
    for (const user of room.users) {
      const role: UserRole = user.id === room.creatorId ? 'owner' : room.adminUserIds.has(user.id) ? 'admin' : 'member'
      changed = setRoleIfChanged(user, role) || changed
    }
    return changed
  }

  // 无在线特权用户：先剪枝掉已离线的临时管理员（处理"提权后断线"等情况）
  const onlineIds = new Set(room.users.map((u) => u.id))
  for (const tempId of room.temporaryAdminUserIds) {
    if (!onlineIds.has(tempId)) {
      room.temporaryAdminUserIds.delete(tempId)
      changed = true
    }
  }

  // 自动补位仅当集合为空（没有显式授权的临时管理员幸存）时授予 users[0]
  // —— 避免覆盖凭 superPassword 显式授权的成员
  if (room.temporaryAdminUserIds.size === 0) {
    room.temporaryAdminUserIds.add(room.users[0]!.id)
    changed = true
  }

  for (const user of room.users) {
    const role: UserRole = room.temporaryAdminUserIds.has(user.id) ? 'admin' : 'member'
    changed = setRoleIfChanged(user, role) || changed
  }

  return changed
}

/**
 * 从在线用户中选出最高优先级的 conductor（播放主持）。
 * 优先级：owner > admin(含临时 admin) > member（按加入顺序）。
 * 若 conductor 变更且正在播放，刷新 playState 时间戳以确保
 * 新 conductor 的首次 report 不被 validateConductorReport 拒绝。
 */
function electConductor(room: RoomData): boolean {
  const prev = room.hostId
  const candidate =
    room.users.find((u) => u.role === 'owner') ?? room.users.find((u) => u.role === 'admin') ?? room.users[0]
  room.hostId = candidate?.id ?? room.hostId

  if (room.hostId !== prev) {
    if (room.playState.isPlaying) {
      room.playState = {
        ...room.playState,
        currentTime: estimateCurrentTime(room.id),
        serverTimestamp: Date.now(),
      }
    }
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Public API — Room CRUD
// ---------------------------------------------------------------------------

export function createRoom(
  socketId: string,
  nickname: string,
  roomName?: string,
  password?: string | null,
  persistentUserId?: string,
): { room: RoomData; user: User } {
  const roomId = nanoid(6).toUpperCase()
  const userId = persistentUserId || socketId

  const user: User = { id: userId, nickname, role: 'owner' }

  const room: RoomData = {
    id: roomId,
    name: roomName?.trim() || `${nickname}的房间`,
    password: password || null,
    superPassword: null,
    creatorId: userId,
    hostId: userId,
    adminUserIds: new Set(),
    temporaryAdminUserIds: new Set(),
    audioQuality: 320,
    users: [user],
    queue: [],
    currentTrack: null,
    playState: {
      isPlaying: false,
      currentTime: 0,
      serverTimestamp: Date.now(),
    },
    playMode: 'loop-all',
  }

  roomRepo.set(roomId, room)
  chatRepo.createRoom(roomId)
  roomRepo.setSocketMapping(socketId, roomId, userId)

  logger.info(`Room created: ${roomId} by ${nickname}`, { roomId })
  return { room, user }
}

export function joinRoom(
  socketId: string,
  roomId: string,
  nickname: string,
  persistentUserId?: string,
): { room: RoomData; user: User; hostChanged: boolean; roleChanged: boolean } | null {
  const room = roomRepo.get(roomId)
  if (!room) return null

  // Cancel any pending room deletion (e.g. user refreshed and is rejoining)
  cancelDeletionTimer(roomId)

  const userId = persistentUserId || socketId
  const isCreator = userId === room.creatorId

  // Determine the permission role — purely based on identity, no grace logic
  function resolveRole(): User['role'] {
    if (isCreator) return 'owner'
    if (room!.adminUserIds.has(userId)) return 'admin'
    return 'member'
  }

  // Rejoin — update existing user entry instead of creating duplicate
  const existing = room.users.find((u) => u.id === userId)
  if (existing) {
    existing.nickname = nickname
    existing.role = resolveRole()
    roomRepo.setSocketMapping(socketId, roomId, userId)
    const roleChanged = reconcileRoomRoles(room)
    const hostChanged = electConductor(room)
    return { room, user: existing, hostChanged, roleChanged }
  }

  // New user entry
  const role = resolveRole()
  const user: User = { id: userId, nickname, role }
  room.users.push(user)
  roomRepo.setSocketMapping(socketId, roomId, userId)

  // Reconcile roles first so owner/admin returning clears any temporary admin.
  const roleChanged = reconcileRoomRoles(room)
  // Re-elect conductor (owner joining takes priority over current conductor)
  const hostChanged = electConductor(room)

  logger.info(`User ${nickname} joined room ${roomId} as ${role}`, { roomId })
  return { room, user, hostChanged, roleChanged }
}

export function leaveRoom(
  socketId: string,
  io?: TypedServer,
): {
  roomId: string
  user: User
  room: RoomData | null
  hostChanged: boolean
  roleChanged: boolean
  voteUpdated: boolean
  staleSocketOnly: boolean
} | null {
  const mapping = roomRepo.getSocketMapping(socketId)
  if (!mapping) return null

  const { roomId, userId } = mapping
  const room = roomRepo.get(roomId)
  if (!room) return null

  const user = room.users.find((u) => u.id === userId)
  if (!user) return null

  // Race condition guard: if the user has another active socket in this room
  // (e.g. page refresh — new socket joined before old socket disconnected),
  // only clean up the stale mapping without removing the user from the room.
  if (roomRepo.hasOtherSocketForUser(roomId, userId, socketId)) {
    roomRepo.deleteSocketMapping(socketId)
    logger.info(`Stale disconnect for user ${userId} in room ${roomId} — newer socket exists`, { roomId })
    return { roomId, user, room, hostChanged: false, roleChanged: false, voteUpdated: false, staleSocketOnly: true }
  }

  room.users = room.users.filter((u) => u.id !== userId)
  roomRepo.deleteSocketMapping(socketId)

  // If room is empty, schedule deletion after grace period
  if (room.users.length === 0) {
    reconcileRoomRoles(room)
    scheduleDeletion(roomId, io)
    return { roomId, user, room, hostChanged: false, roleChanged: false, voteUpdated: false, staleSocketOnly: false }
  }

  // Keep at least one online admin-capable user before electing conductor.
  const roleChanged = reconcileRoomRoles(room)
  // Re-elect conductor immediately — no grace period
  const hostChanged = electConductor(room)

  // Update active vote threshold so it doesn't become impossible to pass
  const voteUpdated = updateVoteThreshold(roomId, room.users.length, user.id)

  logger.info(`User ${user.nickname} left room ${roomId}`, { roomId })
  return { roomId, user, room, hostChanged, roleChanged, voteUpdated, staleSocketOnly: false }
}

// ---------------------------------------------------------------------------
// Public API — Read / Settings / Roles
// ---------------------------------------------------------------------------

export function getRoom(roomId: string): RoomData | undefined {
  return roomRepo.get(roomId)
}

export function listRooms(): RoomListItem[] {
  return roomRepo.getAllAsList()
}

export function updateSettings(
  roomId: string,
  settings: { name?: string; password?: string | null; superPassword?: string | null; audioQuality?: AudioQuality },
): void {
  const room = roomRepo.get(roomId)
  if (!room) return

  if (settings.name !== undefined) {
    room.name = settings.name
  }

  // password: string -> set password; null -> remove password; undefined -> no change
  if (settings.password !== undefined) {
    room.password = settings.password
  }

  // superPassword: string -> set management password; null -> remove; undefined -> no change
  if (settings.superPassword !== undefined) {
    room.superPassword = settings.superPassword
  }

  if (settings.audioQuality !== undefined) {
    room.audioQuality = settings.audioQuality
  }
}

export function setUserRole(
  roomId: string,
  targetUserId: string,
  role: 'admin' | 'member',
): { success: boolean; roleChanged: boolean; hostChanged: boolean } {
  const room = roomRepo.get(roomId)
  if (!room) return { success: false, roleChanged: false, hostChanged: false }
  const user = room.users.find((u) => u.id === targetUserId)
  if (!user) return { success: false, roleChanged: false, hostChanged: false }
  // Cannot change owner's role
  if (user.role === 'owner') return { success: false, roleChanged: false, hostChanged: false }

  let roleChanged: boolean
  if (role === 'admin') {
    // 提升：写入持久 admin 集合；若先前是凭 superPassword 的临时管理员，把它从
    // 临时集合挪除（随后的 reconcile 在"永久特权在线"分支会清空整个临时集合，
    // 但显式删除让语义自洽，避免临时/持久身份并存）。
    roleChanged = setRoleIfChanged(user, 'admin')
    room.adminUserIds.add(targetUserId)
    room.temporaryAdminUserIds.delete(targetUserId)
    // 提升后房主（调用者）在线 → 永久特权在线分支，reconcile 清临时集合并按身份定角色
    const reconciledRoleChanged = reconcileRoomRoles(room)
    roleChanged = roleChanged || reconciledRoleChanged
  } else {
    // 降级：只清目标一人，不走 reconcile 的"清空整个临时集合"分支，避免房主降某一人
    // 时牵连清掉其他凭 superPassword 授权的临时管理员（他们应当保持 admin）。
    room.adminUserIds.delete(targetUserId)
    room.temporaryAdminUserIds.delete(targetUserId)
    // 按身份重新定角色：creator→owner、其余 member
    let changed = false
    for (const u of room.users) {
      const r: UserRole = u.id === room.creatorId ? 'owner' : room.adminUserIds.has(u.id) ? 'admin' : 'member'
      changed = setRoleIfChanged(u, r) || changed
    }
    roleChanged = changed
  }
  // Re-elect conductor (admin promotion/demotion may change priority)
  const hostChanged = electConductor(room)
  return { success: true, roleChanged, hostChanged }
}

/**
 * 房间内成员凭管理密码（superPassword）获取临时 admin 权限。
 *
 * 临时管理员写入 temporaryAdminUserIds 集合（支持多人同时持有），不写入 adminUserIds，
 * 不调用 reconcileRoomRoles（避免其覆盖显式授权）；仅 setRoleIfChanged + electConductor。
 * 房主/持久 admin 上线时由后续 reconcile 清空集合，对应自动降级语义。
 */
export function grantTempAdminByPassword(
  roomId: string,
  userId: string,
  superPassword: string,
): { success: boolean; errorCode?: string; roleChanged: boolean; hostChanged: boolean } {
  const room = roomRepo.get(roomId)
  if (!room) return { success: false, errorCode: 'ROOM_NOT_FOUND', roleChanged: false, hostChanged: false }
  if (room.superPassword === null) {
    return { success: false, errorCode: 'SUPER_PASSWORD_NOT_SET', roleChanged: false, hostChanged: false }
  }
  const user = room.users.find((u) => u.id === userId)
  if (!user) return { success: false, errorCode: 'NOT_IN_ROOM', roleChanged: false, hostChanged: false }
  // 已是永久特权用户（owner / 持久 admin）：no-op 成功，不动集合、不广播
  if (isPermanentPrivileged(room, userId)) {
    return { success: true, roleChanged: false, hostChanged: false }
  }
  if (!safeCompare(superPassword, room.superPassword)) {
    return { success: false, errorCode: 'WRONG_SUPER_PASSWORD', roleChanged: false, hostChanged: false }
  }
  // 幂等：已是临时管理员则不重复广播
  if (room.temporaryAdminUserIds.has(userId) && user.role === 'admin') {
    return { success: true, roleChanged: false, hostChanged: false }
  }
  room.temporaryAdminUserIds.add(userId)
  const roleChanged = setRoleIfChanged(user, 'admin')
  const hostChanged = electConductor(room)
  return { success: true, roleChanged, hostChanged }
}

export function getUserBySocket(socketId: string): User | null {
  const mapping = roomRepo.getSocketMapping(socketId)
  if (!mapping) return null
  const room = roomRepo.get(mapping.roomId)
  if (!room) return null
  return room.users.find((u) => u.id === mapping.userId) ?? null
}

export function getRoomBySocket(socketId: string): { roomId: string; room: RoomData } | null {
  const mapping = roomRepo.getSocketMapping(socketId)
  if (!mapping) return null
  const room = roomRepo.get(mapping.roomId)
  if (!room) return null
  return { roomId: mapping.roomId, room }
}

// ---------------------------------------------------------------------------
// Join validation (business logic extracted from roomController)
// ---------------------------------------------------------------------------

/** Constant-time string comparison to mitigate timing attacks */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface JoinValidationResult {
  valid: boolean
  errorCode?: string
  errorMessage?: string
  /** Whether this is a rejoin (user already in room or same socket mapping) — skip join notification */
  isRejoin: boolean
  /** Whether password should be bypassed (rejoin, creator, or persistent admin) */
  skipPassword: boolean
}

/**
 * Validate a join request: check room existence, password, rejoin scenarios.
 * Pure business logic — no socket operations.
 */
export function validateJoinRequest(
  roomId: string,
  socketId: string,
  identityUserId: string,
  password?: string,
  rejoinToken?: string,
): JoinValidationResult {
  const room = roomRepo.get(roomId)
  if (!room) {
    return {
      valid: false,
      errorCode: 'ROOM_NOT_FOUND',
      errorMessage: '房间不存在',
      isRejoin: false,
      skipPassword: false,
    }
  }

  const existingMapping = roomRepo.getSocketMapping(socketId)
  const effectiveUserId = identityUserId
  const alreadyInRoom = room.users.some((u) => u.id === effectiveUserId)
  const isCreator = effectiveUserId === room.creatorId
  const isPersistentAdmin = room.adminUserIds.has(effectiveUserId)
  const hasValidRejoinTicket =
    typeof rejoinToken === 'string' && rejoinToken.length > 0
      ? consumeRejoinTicket(rejoinToken, roomId, effectiveUserId)
      : false

  // Password bypass: same socket mapping, already in room, creator, or persistent admin
  const skipPassword =
    hasValidRejoinTicket || existingMapping?.roomId === roomId || alreadyInRoom || isCreator || isPersistentAdmin
  // Notification skip: only when user is literally still in the room
  const isRejoin = existingMapping?.roomId === roomId || alreadyInRoom

  if (!skipPassword && room.password !== null) {
    if (!password || !safeCompare(password, room.password)) {
      return { valid: false, errorCode: 'WRONG_PASSWORD', errorMessage: '密码错误', isRejoin, skipPassword }
    }
  }

  // Auto-leave check: if the socket is mapped to a different room, the caller
  // should call leaveRoom before proceeding. We just flag the scenario here.

  return { valid: true, isRejoin, skipPassword }
}
