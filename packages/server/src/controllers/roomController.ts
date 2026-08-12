import {
  ERROR_CODE,
  EVENTS,
  roomCreateSchema,
  roomGrantAdminByPasswordSchema,
  roomJoinSchema,
  roomSettingsSchema,
  setRoleSchema,
} from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { createWithOwnerOnly } from '../middleware/withControl.js'
import { createWithRoom } from '../middleware/withRoom.js'
import { cleanupSocketRateLimit } from '../middleware/socketRateLimiter.js'
import { roomRepo } from '../repositories/roomRepository.js'
import * as chatService from '../services/chatService.js'
import * as playerService from '../services/playerService.js'
import { issueRejoinTicket, revokeRejoinTickets } from '../services/rejoinTicketService.js'
import * as roomService from '../services/roomService.js'
import * as voteService from '../services/voteService.js'
import { logger } from '../utils/logger.js'

export function registerRoomController(io: TypedServer, socket: TypedSocket) {
  const withOwnerOnly = createWithOwnerOnly(io)
  const withRoom = createWithRoom(io)

  // ---- Room list (不需要在房间内) ----
  socket.on(EVENTS.ROOM_LIST, () => {
    try {
      socket.emit(EVENTS.ROOM_LIST_UPDATE, roomService.listRooms())
    } catch (err) {
      logger.error('ROOM_LIST handler error', err, { socketId: socket.id })
    }
  })

  // ---- Create room (含可选密码) ----
  socket.on(EVENTS.ROOM_CREATE, (raw) => {
    try {
      const parsed = roomCreateSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }
      const { nickname, roomName, password } = parsed.data

      // Auto-leave any previous room before creating a new one
      handleLeave(io, socket, 'auto-leave before create', true)

      const { room, user } = roomService.createRoom(
        socket.id,
        nickname.trim(),
        roomName,
        password,
        socket.data.identityUserId,
      )

      socket.leave('lobby')
      socket.join(room.id)
      socket.emit(EVENTS.ROOM_CREATED, { roomId: room.id, userId: user.id })
      // 创建者是 owner，发送含密码的完整状态
      socket.emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(room))
      const rejoin = issueRejoinTicket(room.id, user.id)
      socket.emit(EVENTS.ROOM_REJOIN_TOKEN, { roomId: room.id, token: rejoin.token, expiresAt: rejoin.expiresAt })

      // 广播房间列表给大厅用户
      roomService.broadcastRoomList(io)
    } catch (err) {
      logger.error('ROOM_CREATE handler error', err, { socketId: socket.id })
      socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INTERNAL, message: '服务器内部错误' })
    }
  })

  // ---- Join room (含密码校验) ----
  socket.on(EVENTS.ROOM_JOIN, (raw) => {
    try {
      const parsed = roomJoinSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }
      const { roomId, nickname, password, rejoinToken } = parsed.data

      // Validate join request (password, rejoin scenarios) — pure business logic
      const validation = roomService.validateJoinRequest(
        roomId,
        socket.id,
        socket.data.identityUserId,
        password,
        rejoinToken,
      )
      if (!validation.valid) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE[validation.errorCode as keyof typeof ERROR_CODE] ?? ERROR_CODE.JOIN_FAILED,
          message: validation.errorMessage ?? '加入房间失败',
        })
        return
      }

      // Auto-leave any previous room (different from target) before joining
      const existingMapping = roomRepo.getSocketMapping(socket.id)
      if (existingMapping && existingMapping.roomId !== roomId) {
        handleLeave(io, socket, 'auto-leave before join', true)
      }

      const result = roomService.joinRoom(socket.id, roomId, nickname.trim(), socket.data.identityUserId)
      if (!result) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.JOIN_FAILED, message: '加入房间失败' })
        return
      }

      const { room: updatedRoom, user, hostChanged, roleChanged } = result
      const rejoin = issueRejoinTicket(roomId, user.id)

      socket.leave('lobby')
      socket.join(roomId)

      // Send full room state + chat history
      // Owner 收到含密码版本，其他成员收到不含密码版本
      const isOwner = user.role === 'owner'
      const stateForJoiner = isOwner
        ? roomService.toPublicRoomStateForOwner(updatedRoom)
        : roomService.toPublicRoomState(updatedRoom)
      socket.emit(EVENTS.ROOM_STATE, stateForJoiner)

      // If conductor or roles changed (owner/admin returned, temporary admin cleared),
      // broadcast to ALL OTHER clients so permissions stay in sync.
      if (hostChanged || roleChanged) {
        socket.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(updatedRoom))
      }
      socket.emit(EVENTS.ROOM_REJOIN_TOKEN, { roomId, token: rejoin.token, expiresAt: rejoin.expiresAt })
      socket.emit(EVENTS.CHAT_HISTORY, chatService.getHistory(roomId))

      // Sync playback state to the joining client (auto-resume, auto-play)
      playerService.syncPlaybackToSocket(io, socket, roomId, updatedRoom).catch((err) => {
        logger.error('syncPlaybackToSocket failed', err, { roomId })
      })

      // Send active vote state if one is in progress
      const activeVote = voteService.getActiveVote(roomId)
      if (activeVote) {
        socket.emit(EVENTS.VOTE_STARTED, voteService.toVoteState(activeVote))
      }

      // Notify others (skip for rejoin — they already know the user is in the room)
      if (!validation.isRejoin) {
        socket.to(roomId).emit(EVENTS.ROOM_USER_JOINED, user)
        // System message for user joined (server-authoritative)
        const joinMsg = chatService.createSystemMessage(roomId, `${user.nickname} 加入了房间`)
        io.to(roomId).emit(EVENTS.CHAT_MESSAGE, joinMsg)
      }

      // 更新大厅房间列表（人数变了）
      roomService.broadcastRoomList(io)
    } catch (err) {
      logger.error('ROOM_JOIN handler error', err, { socketId: socket.id })
      socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INTERNAL, message: '服务器内部错误' })
    }
  })

  // ---- Leave room (explicit user action) ----
  socket.on(EVENTS.ROOM_LEAVE, () => {
    try {
      logger.info(`ROOM_LEAVE event from ${socket.id}`, { socketId: socket.id })
      handleLeave(io, socket, undefined, true)
    } catch (err) {
      logger.error('ROOM_LEAVE handler error', err, { socketId: socket.id })
    }
  })

  // ---- Room settings (仅房主，含密码管理) ----
  socket.on(
    EVENTS.ROOM_SETTINGS,
    withOwnerOnly((ctx, raw) => {
      const parsed = roomSettingsSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }

      roomService.updateSettings(ctx.roomId, {
        name: parsed.data.name,
        password: parsed.data.password,
        superPassword: parsed.data.superPassword,
        audioQuality: parsed.data.audioQuality,
      })

      const updatedRoom = roomRepo.get(ctx.roomId)
      if (!updatedRoom) return

      // 仅 owner 收到密码明文（含管理密码），其他成员只收到 hasPassword / hasSuperPassword 标记
      const baseSettings = {
        name: updatedRoom.name,
        hasPassword: updatedRoom.password !== null,
        hasSuperPassword: updatedRoom.superPassword !== null,
        audioQuality: updatedRoom.audioQuality,
      }
      // 给 owner 发送含密码明文（join password + 管理密码）的设置
      ctx.socket.emit(EVENTS.ROOM_SETTINGS, {
        ...baseSettings,
        password: updatedRoom.password ?? null,
        superPassword: updatedRoom.superPassword ?? null,
      })
      // 给房间内其他成员发送不含密码明文的设置
      ctx.socket.to(ctx.roomId).emit(EVENTS.ROOM_SETTINGS, baseSettings)

      logger.info(`Room ${ctx.roomId} settings updated`, { roomId: ctx.roomId })

      // 密码变更也要刷新大厅列表
      roomService.broadcastRoomList(io)
    }),
  )

  // ---- Set user role (仅房主) ----
  socket.on(
    EVENTS.ROOM_SET_ROLE,
    withOwnerOnly((ctx, raw) => {
      const parsed = setRoleSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }

      const { userId, role } = parsed.data
      const result = roomService.setUserRole(ctx.roomId, userId, role)
      if (!result.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.SET_ROLE_FAILED, message: '无法设置该用户的角色' })
        return
      }

      // 房主降级时会牵连其它凭 superPassword 授权的临时管理员一并降级 → 需要把
      // 整个房间角色重同步给所有客户端，仅广播单个 userId 不够（旁人角色也变了）。
      // 提升则只涉及目标一人。两者都先广播目标角色变更，再按 hostChanged/roleChanged
      // 补发完整 ROOM_STATE。
      io.to(ctx.roomId).emit(EVENTS.ROOM_ROLE_CHANGED, { userId, role })
      // 降级后房内其它成员可能已被 setUserRole 的身份重定改动；把更新后的 users 同步给所有人
      ctx.socket.to(ctx.roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(ctx.room))
      if (result.hostChanged || result.roleChanged) {
        // Owner must keep receiving the password-bearing state; other members
        // (including temporary admins) only receive the public state.
        ctx.socket.emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(ctx.room))
      }
      logger.info(`Role changed: ${userId} -> ${role} in room ${ctx.roomId}`, { roomId: ctx.roomId })
    }),
  )

  // ---- Grant temporary admin by super password (任意在线成员可调用) ----
  socket.on(
    EVENTS.ROOM_GRANT_ADMIN_BY_PASSWORD,
    withRoom((ctx, raw) => {
      const parsed = roomGrantAdminByPasswordSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }

      const result = roomService.grantTempAdminByPassword(ctx.roomId, ctx.user.id, parsed.data.superPassword)
      if (!result.success) {
        const message =
          result.errorCode === 'WRONG_SUPER_PASSWORD'
            ? '管理密码错误'
            : result.errorCode === 'SUPER_PASSWORD_NOT_SET'
              ? '房主未设置管理密码'
              : '无法获取管理权限'
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE[result.errorCode as keyof typeof ERROR_CODE] ?? ERROR_CODE.INTERNAL,
          message,
        })
        return
      }

      // 广播角色提升（与 ROOM_SET_ROLE 一致的可见性切分）。仅在角色确实变化时广播，
      // 避免对已是管理员的用户（永久特权 / 已是临时管理员）重复广播。
      if (result.roleChanged) {
        io.to(ctx.roomId).emit(EVENTS.ROOM_ROLE_CHANGED, { userId: ctx.user.id, role: 'admin' })
      }
      // 若新临时管理员成为主持，广播完整状态保持 hostId 同步
      if (result.hostChanged) {
        const owner = ctx.room.users.find((u) => u.role === 'owner')
        const ownerSocketId = owner ? roomRepo.getSocketIdForUser(ctx.roomId, owner.id) : null
        if (ownerSocketId) {
          io.to(ownerSocketId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(ctx.room))
          io.to(ctx.roomId).except(ownerSocketId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(ctx.room))
        } else {
          io.to(ctx.roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(ctx.room))
        }
      }
      logger.info(`User ${ctx.user.id} granted temp admin via super password in room ${ctx.roomId}`, {
        roomId: ctx.roomId,
      })
    }),
  )

  // ---- Disconnect ----
  socket.on('disconnect', (reason) => {
    try {
      logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`, { socketId: socket.id })
      handleLeave(io, socket)
      // Safety net: always clean up socket mapping, RTT data, and rate limiter.
      // handleLeave only cleans up if the socket was in a room, but
      // NTP_PING can store RTT even for sockets that never joined a room.
      roomRepo.deleteSocketMapping(socket.id)
      cleanupSocketRateLimit(socket)
    } catch (err) {
      logger.error('disconnect handler error', err, { socketId: socket.id })
    }
  })
}

// ---------------------------------------------------------------------------
// Unified leave handler (previously duplicated as autoLeaveCurrentRoom + handleLeave)
// ---------------------------------------------------------------------------

/**
 * Leave the current room (if any), notify other users, and update lobby.
 * Used by ROOM_LEAVE, disconnect, and auto-leave before create/join.
 */
function handleLeave(io: TypedServer, socket: TypedSocket, reason?: string, revokeTicket = false): void {
  const result = roomService.leaveRoom(socket.id, io)
  if (!result) return

  const { roomId, user, room, hostChanged, roleChanged, voteUpdated, staleSocketOnly } = result
  if (revokeTicket) {
    revokeRejoinTickets(roomId, user.id)
  }
  socket.leave(roomId)
  socket.join('lobby')

  // Stale socket cleanup (e.g. page refresh) should only remove this socket
  // from the Socket.IO room; the user remains present via another socket.
  if (staleSocketOnly) return

  io.to(roomId).emit(EVENTS.ROOM_USER_LEFT, user)

  // System message for user left (server-authoritative)
  if (room && room.users.length > 0) {
    const leaveMsg = chatService.createSystemMessage(roomId, `${user.nickname} 离开了房间`)
    io.to(roomId).emit(EVENTS.CHAT_MESSAGE, leaveMsg)
  }

  // 角色或主持变更时广播完整状态，确保所有客户端更新 hostId / 权限
  // owner 收到含密码版本，其他成员不含密码
  if ((hostChanged || roleChanged) && room && room.users.length > 0) {
    const newOwner = room.users.find((u) => u.role === 'owner')
    const ownerSocketId = newOwner ? roomRepo.getSocketIdForUser(roomId, newOwner.id) : null
    if (ownerSocketId) {
      io.to(ownerSocketId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(room))
      io.to(roomId).except(ownerSocketId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
    } else {
      io.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
    }
  }

  // Broadcast updated vote state after threshold recalculation
  if (voteUpdated) {
    const activeVote = voteService.getActiveVote(roomId)
    if (activeVote) {
      io.to(roomId).emit(EVENTS.VOTE_STARTED, voteService.toVoteState(activeVote))
    }
  }

  // 更新大厅房间列表
  roomService.broadcastRoomList(io)

  if (reason) {
    logger.info(`${reason}: left room ${roomId} for socket ${socket.id}`, { roomId, socketId: socket.id })
  }
}
