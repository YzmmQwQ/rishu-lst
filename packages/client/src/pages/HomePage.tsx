import { ActionCards } from '@/components/Lobby/ActionCards'
import { CreateRoomDialog } from '@/components/Lobby/CreateRoomDialog'
import { HeroSection } from '@/components/Lobby/HeroSection'
import { NicknameDialog } from '@/components/Lobby/NicknameDialog'
import { PasswordDialog } from '@/components/Lobby/PasswordDialog'
import { RoomListSection } from '@/components/Lobby/RoomListSection'
import { UserPopover } from '@/components/Lobby/UserPopover'
import { Separator } from '@/components/ui/separator'
import { useLobby } from '@/hooks/useLobby'
import { unlockAudio } from '@/lib/audioUnlock'
import { ACTION_LOADING_TIMEOUT_MS } from '@/lib/constants'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/SocketProvider'
import { useRoomStore } from '@/stores/roomStore'
import { useChatStore } from '@/stores/chatStore'
import { useTheme } from '@/hooks/useTheme'
import { EVENTS, ERROR_CODE, type RoomListItem, type RoomState } from '@music-together/shared'
import { Code } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

export default function HomePage() {
  const navigate = useNavigate()
  const { socket } = useSocketContext()
  const { rooms, isLoading, createRoom, joinRoom } = useLobby()
  const { isDark, toggleTheme } = useTheme()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [passwordDialog, setPasswordDialog] = useState<{ open: boolean; room: RoomListItem | null }>({
    open: false,
    room: null,
  })
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [directRoomId, setDirectRoomId] = useState('')
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false)

  // Stores the pending join action while waiting for nickname input
  const pendingJoinRef = useRef<{ type: 'room'; room: RoomListItem } | { type: 'direct'; roomId: string } | null>(null)

  // Refs for onError closure to always read the latest values
  const passwordDialogRef = useRef(passwordDialog)
  passwordDialogRef.current = passwordDialog
  const directRoomIdRef = useRef(directRoomId)
  directRoomIdRef.current = directRoomId
  const lastJoinedRoomIdRef = useRef('')

  const setRoom = useRoomStore((s) => s.setRoom)
  const savedNickname = storage.getNickname()

  // Safety timeout: reset actionLoading after 15s to prevent stuck button
  useEffect(() => {
    if (actionLoading) {
      actionTimeoutRef.current = setTimeout(() => {
        setActionLoading(false)
        toast.error('操作超时，请重试')
      }, ACTION_LOADING_TIMEOUT_MS)
    } else {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current)
        actionTimeoutRef.current = null
      }
    }
    return () => {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current)
        actionTimeoutRef.current = null
      }
    }
  }, [actionLoading])

  // Listen for room created / room state / chat history events for navigation
  useEffect(() => {
    const onCreated = () => {
      // currentUser will be auto-derived when onState fires and calls setRoom
      setActionLoading(false)
      setCreateDialogOpen(false)
      // Navigation is handled by onState which fires right after onCreated
    }

    const onState = (roomState: RoomState) => {
      // setRoom automatically derives currentUser from room.users
      setRoom(roomState)
      if ('password' in roomState) {
        useRoomStore.getState().setRoomPassword(roomState.password ?? null)
      }
      setActionLoading(false)
      setPasswordDialog({ open: false, room: null })
      setPasswordError(null)
      navigate(`/room/${roomState.id}`)
    }

    const onRejoinToken = (data: { roomId: string; token: string; expiresAt: number }) => {
      storage.setRejoinToken(data.roomId, data.token, data.expiresAt)
    }

    // 服务端在 ROOM_JOIN 后同时 emit ROOM_STATE + CHAT_HISTORY，
    // 若不在这里监听 CHAT_HISTORY，消息会在 navigate 之前丢失
    // （RoomPage 的 useChatSync 尚未挂载）。
    const onChatHistory = (messages: import('@music-together/shared').ChatMessage[]) => {
      useChatStore.getState().setMessages(messages)
    }

    const onError = (error: { code: string; message: string }) => {
      setActionLoading(false)
      if (error.code === ERROR_CODE.WRONG_PASSWORD) {
        // If password dialog is already open, show error
        if (passwordDialogRef.current.open) {
          setPasswordError('密码错误，请重试')
        } else {
          // Direct join hit a password-protected room — open password dialog
          const targetRoomId = lastJoinedRoomIdRef.current || directRoomIdRef.current.trim()
          if (targetRoomId) {
            setPasswordDialog({
              open: true,
              room: {
                id: targetRoomId,
                name: targetRoomId,
                hasPassword: true,
                userCount: 0,
                currentTrackTitle: null,
                currentTrackArtist: null,
              },
            })
            setPasswordError(null)
          } else {
            toast.error(error.message)
          }
        }
      } else {
        toast.error(error.message)
      }
    }

    socket.on(EVENTS.ROOM_CREATED, onCreated)
    socket.on(EVENTS.ROOM_STATE, onState)
    socket.on(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
    socket.on(EVENTS.CHAT_HISTORY, onChatHistory)
    socket.on(EVENTS.ROOM_ERROR, onError)

    return () => {
      socket.off(EVENTS.ROOM_CREATED, onCreated)
      socket.off(EVENTS.ROOM_STATE, onState)
      socket.off(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
      socket.off(EVENTS.CHAT_HISTORY, onChatHistory)
      socket.off(EVENTS.ROOM_ERROR, onError)
    }
  }, [socket, navigate, setRoom])

  const handleCreateRoom = async (nickname: string, roomName?: string, password?: string) => {
    await unlockAudio()
    storage.setNickname(nickname)
    setActionLoading(true)
    createRoom(nickname, roomName, password)
  }

  const handleRoomClick = async (room: RoomListItem) => {
    if (actionLoading) return
    if (!savedNickname) {
      pendingJoinRef.current = { type: 'room', room }
      setNicknameDialogOpen(true)
      return
    }

    await unlockAudio()

    if (room.hasPassword) {
      setPasswordDialog({ open: true, room })
      setPasswordError(null)
    } else {
      setActionLoading(true)
      joinRoom(room.id, savedNickname)
    }
  }

  const handlePasswordSubmit = (password: string) => {
    if (!passwordDialog.room) return
    if (!savedNickname) return
    setActionLoading(true)
    setPasswordError(null)
    joinRoom(passwordDialog.room.id, savedNickname, password)
  }

  const handleDirectJoin = async () => {
    if (actionLoading) return
    if (!directRoomId.trim()) {
      toast.error('请输入房间号')
      return
    }
    if (!savedNickname) {
      pendingJoinRef.current = { type: 'direct', roomId: directRoomId.trim() }
      setNicknameDialogOpen(true)
      return
    }
    await unlockAudio()
    lastJoinedRoomIdRef.current = directRoomId.trim()
    setActionLoading(true)
    joinRoom(directRoomId.trim(), savedNickname)
  }

  /** Called after the user sets their nickname in NicknameDialog */
  const handleNicknameConfirm = useCallback(
    async (nickname: string) => {
      setNicknameDialogOpen(false)
      const pending = pendingJoinRef.current
      pendingJoinRef.current = null
      if (!pending) return

      await unlockAudio()

      if (pending.type === 'room') {
        const room = pending.room
        if (room.hasPassword) {
          setPasswordDialog({ open: true, room })
          setPasswordError(null)
        } else {
          setActionLoading(true)
          joinRoom(room.id, nickname)
        }
      } else {
        lastJoinedRoomIdRef.current = pending.roomId
        setActionLoading(true)
        joinRoom(pending.roomId, nickname)
      }
    },
    [joinRoom],
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="relative z-10 flex min-h-screen flex-col"
    >
      {/* Top Bar — 照搬 lst 的 .top-bar（fixed 全宽贴顶） */}
      <nav className="top-bar">
        <button type="button" className="site-title" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          LST.RISHU.CFD
        </button>
        <div className="nav-right">
          <UserPopover />
          <button
            type="button"
            className="theme-toggle"
            aria-label="Toggle theme"
            onClick={toggleTheme}
          >
            {isDark ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
            <span id="themeText">{isDark ? 'LIGHT' : 'DARK'}</span>
          </button>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 has-top-bar">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <HeroSection />

          <ActionCards
            directRoomId={directRoomId}
            onDirectRoomIdChange={setDirectRoomId}
            onCreateClick={() => setCreateDialogOpen(true)}
            onDirectJoin={handleDirectJoin}
            actionLoading={actionLoading}
          />

          <Separator className="mb-8" />

          <RoomListSection rooms={rooms} isLoading={isLoading} onRoomClick={handleRoomClick} />
        </div>
      </main>

      {/* Footer — 强制底部（main flex-1 撑满，footer 在视口底） */}
      <div className="mx-auto w-full max-w-5xl px-6 pb-6">
        <div className="footer">
          <span className="footer-credit">
            Made by <a href="https://yz-mm.top" target="_blank" rel="noopener noreferrer" className="footer-link">YZMM</a>
          </span>
          <a
            href="https://github.com/YzmmQwQ/Rishu-lst"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link inline-flex items-center gap-1.5"
          >
            <Code className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </div>

      {/* Dialogs */}
      <CreateRoomDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateRoom={handleCreateRoom}
        defaultNickname={savedNickname}
        isLoading={actionLoading}
      />

      <NicknameDialog
        open={nicknameDialogOpen}
        onOpenChange={setNicknameDialogOpen}
        onConfirm={handleNicknameConfirm}
      />

      <PasswordDialog
        open={passwordDialog.open}
        onOpenChange={(open: boolean) => {
          setPasswordDialog((prev) => ({ ...prev, open }))
          if (!open) setPasswordError(null)
        }}
        roomName={passwordDialog.room?.name ?? ''}
        onSubmit={handlePasswordSubmit}
        error={passwordError}
        isLoading={actionLoading}
      />
    </motion.div>
  )
}
