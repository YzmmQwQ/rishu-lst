import { MediaButton } from '@/components/ui/media-button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ForwardIcon, PauseIcon, PlayIcon, PlaylistIcon, RepeatIcon, RewindIcon, ShuffleIcon } from '@/components/player-icons/icons'
import { formatTime } from '@/lib/format'
import { AbilityContext } from '@/providers/AbilityProvider'
import { useSocketContext } from '@/providers/SocketProvider'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import type { PlayMode, VoteAction } from '@music-together/shared'
import { EVENTS, TIMING } from '@music-together/shared'
import { memo, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Design-time width (px) at which the controls are laid out — CSS zoom scales from this baseline */
const DESIGN_WIDTH = 300

const PLAY_MODE_CYCLE: PlayMode[] = ['sequential', 'loop-all', 'loop-one', 'shuffle']

const PLAY_MODE_CONFIG: Record<PlayMode, { label: string }> = {
  sequential: { label: '顺序播放' },
  'loop-all': { label: '列表循环' },
  'loop-one': { label: '单曲循环' },
  shuffle: { label: '随机播放' },
}

interface PlayerControlsProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenQueue: () => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

export const PlayerControls = memo(function PlayerControls({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onOpenQueue,
  onStartVote,
}: PlayerControlsProps) {
  const { socket } = useSocketContext()
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const queueLength = useRoomStore((s) => s.room?.queue?.length ?? 0)
  const playMode = useRoomStore((s) => s.room?.playMode ?? 'sequential')
  const ability = useContext(AbilityContext)
  const canSeek = ability.can('seek', 'Player')
  const canPlay = ability.can('play', 'Player')
  const canSetMode = ability.can('set-mode', 'Player')
  const canVote = ability.can('vote', 'Player')
  const [skipCooldown, setSkipCooldown] = useState(false)
  const [playCooldown, setPlayCooldown] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekTime, setSeekTime] = useState(0)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const playCooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const disabled = !currentTrack

  // Clean up cooldown timers on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
      if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    }
  }, [])

  // Scale entire controls area proportionally — like the cover image
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const inner = innerRef.current
    if (!wrapper || !inner) return
    const update = () => {
      inner.style.setProperty('zoom', String(wrapper.clientWidth / DESIGN_WIDTH))
    }
    update()
    const ro = new ResizeObserver(() => update())
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [])

  const handleSkip = (action: () => void, voteAction: 'next' | 'prev') => {
    if (skipCooldown) return
    if (ability.can(voteAction, 'Player')) {
      action()
    } else if (canVote) {
      onStartVote(voteAction)
    }
    setSkipCooldown(true)
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
    cooldownTimer.current = setTimeout(() => setSkipCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
  }

  const handlePlayPause = () => {
    if (playCooldown) return
    if (canPlay) {
      if (isPlaying) {
        onPause()
      } else {
        onPlay()
      }
    } else if (canVote) {
      onStartVote(isPlaying ? 'pause' : 'resume')
    }
    setPlayCooldown(true)
    if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    playCooldownTimer.current = setTimeout(() => setPlayCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
  }

  const handlePlayModeToggle = () => {
    const currentIdx = PLAY_MODE_CYCLE.indexOf(playMode)
    const nextMode = PLAY_MODE_CYCLE[(currentIdx + 1) % PLAY_MODE_CYCLE.length]
    if (canSetMode) {
      socket.emit(EVENTS.PLAYER_SET_MODE, { mode: nextMode })
    } else if (canVote) {
      onStartVote('set-mode', { mode: nextMode })
    }
  }

  const modeConfig = PLAY_MODE_CONFIG[playMode]

  return (
    <div ref={wrapperRef} className="w-full">
      <div ref={innerRef} className="flex flex-col gap-6" style={{ width: DESIGN_WIDTH }}>
        {/* 1. Progress bar */}
        <div className="flex w-full flex-col gap-1">
          <Slider
            value={[duration > 0 ? ((isSeeking ? seekTime : currentTime) / duration) * 100 : 0]}
            max={100}
            step={0.1}
            disabled={disabled || !canSeek}
            onValueChange={(val) => {
              if (duration > 0) {
                setIsSeeking(true)
                setSeekTime((val[0] / 100) * duration)
              }
            }}
            onValueCommit={(val) => {
              if (duration > 0) {
                onSeek((val[0] / 100) * duration)
              }
              setIsSeeking(false)
            }}
            className="w-full"
          />
          <div className="flex w-full justify-between">
            <span className="text-xs text-white/50 tabular-nums">{formatTime(isSeeking ? seekTime : currentTime)}</span>
            <span className="text-xs text-white/50 tabular-nums">{formatTime(duration)}</span>
          </div>
        </div>

        {/* 2. Controls row — left/right flex-1 keeps center truly centered */}
        <div className="flex w-full items-center">
          {/* Left: play mode */}
          <div className="flex flex-1 items-center justify-start">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <MediaButton
                  onClick={handlePlayModeToggle}
                  disabled={!canSetMode && !canVote}
                  aria-label={modeConfig.label}
                  className="h-10 w-10"
                >
                  {playMode === 'shuffle' ? <ShuffleIcon className="h-7 w-7" /> : <RepeatIcon className="h-7 w-7" />}
                </MediaButton>
              </TooltipTrigger>
              <TooltipContent>{modeConfig.label}</TooltipContent>
            </Tooltip>
          </div>

          {/* Center: prev + play/pause + next */}
          <div className="flex items-center gap-2">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <MediaButton
                  disabled={disabled || skipCooldown}
                  onClick={() => handleSkip(onPrev, 'prev')}
                  aria-label="上一首"
                  className="h-14 w-14"
                >
                  <RewindIcon className="h-10 w-10" />
                </MediaButton>
              </TooltipTrigger>
              <TooltipContent>上一首</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <MediaButton
                  disabled={disabled || playCooldown}
                  onClick={handlePlayPause}
                  aria-label={isPlaying ? '暂停' : '播放'}
                  className="h-14 w-14"
                >
                  {isPlaying ? (
                    <PauseIcon className="h-6 w-6" />
                  ) : (
                    <PlayIcon className="h-6 w-6" />
                  )}
                </MediaButton>
              </TooltipTrigger>
              <TooltipContent>{isPlaying ? '暂停' : '播放'}</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <MediaButton
                  disabled={disabled || skipCooldown}
                  onClick={() => handleSkip(onNext, 'next')}
                  aria-label="下一首"
                  className="h-14 w-14"
                >
                  <ForwardIcon className="h-10 w-10" />
                </MediaButton>
              </TooltipTrigger>
              <TooltipContent>下一首</TooltipContent>
            </Tooltip>
          </div>

          {/* Right: queue */}
          <div className="flex flex-1 items-center justify-end">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <MediaButton
                  onClick={onOpenQueue}
                  aria-label="播放列表"
                  className="relative h-10 w-10"
                >
                  <PlaylistIcon className="h-6 w-6" />
                  {queueLength > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/90 px-1 text-[10px] font-semibold leading-none text-black">
                      {queueLength > 99 ? '99+' : queueLength}
                    </span>
                  )}
                </MediaButton>
              </TooltipTrigger>
              <TooltipContent>播放列表</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
})
