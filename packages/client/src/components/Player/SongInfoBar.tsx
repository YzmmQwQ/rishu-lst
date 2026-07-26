import { MediaButton } from '@/components/ui/media-button'
import { ChatIcon, SpeakerIcon, SpeakerMutedIcon } from '@/components/player-icons/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MarqueeText } from '@/components/ui/marquee-text'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/lib/utils'
import { motion } from 'motion/react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LAYOUT_TRANSITION, SPRING } from './constants'

/** Must match PlayerControls.DESIGN_WIDTH so zoom factors are identical */
const DESIGN_WIDTH = 300

/**
 * 音量控制组件：解决 Tooltip + Popover 共享 trigger 时 tooltip 闪现的问题。
 * 核心策略：Popover 打开时通过 `open={false}` 强制隐藏外层 Tooltip。
 */
function VolumeControl({
  volume,
  setVolume,
  toggleMute,
}: {
  volume: number
  setVolume: (v: number) => void
  toggleMute: () => void
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  // 点击 mute 时触发喇叭声波动画（一次性）
  const [animate, setAnimate] = useState(false)
  const animateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMuteClick = () => {
    setAnimate(true)
    if (animateTimer.current) clearTimeout(animateTimer.current)
    animateTimer.current = setTimeout(() => setAnimate(false), 700)
    toggleMute()
  }

  useEffect(() => () => { if (animateTimer.current) clearTimeout(animateTimer.current) }, [])

  return (
    <Tooltip delayDuration={300} open={popoverOpen ? false : undefined}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <MediaButton
              aria-label={volume === 0 ? '取消静音' : '调节音量'}
              className="h-7 w-7"
              style={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              {volume === 0 ? <SpeakerMutedIcon className="size-7" /> : <SpeakerIcon className="size-7" />}
            </MediaButton>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>音量</TooltipContent>
        <PopoverContent side="top" align="center" className="slider-on-surface flex w-60 items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={handleMuteClick}
            aria-label="静音切换"
            className="media-ghost flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground"
          >
            {volume === 0 ? (
              <SpeakerMutedIcon className="size-7" />
            ) : (
              <SpeakerIcon className={cn('size-7', animate && 'speaker-animate')} />
            )}
          </button>
          <Slider min={0} max={100} value={[volume * 100]} onValueChange={([v]) => setVolume(v / 100)} />
          <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {Math.round(volume * 100)}
          </span>
        </PopoverContent>
      </Popover>
    </Tooltip>
  )
}

interface SongInfoBarProps {
  onOpenChat: () => void
  chatUnreadCount: number
}

export const SongInfoBar = memo(function SongInfoBar({ onOpenChat, chatUnreadCount }: SongInfoBarProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const volume = usePlayerStore((s) => s.volume)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const prevVolumeRef = useRef(0.8)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const toggleMute = useCallback(() => {
    if (volume === 0) {
      setVolume(prevVolumeRef.current)
    } else {
      prevVolumeRef.current = volume
      setVolume(0)
    }
  }, [volume, setVolume])

  // Zoom scaling — identical to PlayerControls
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

  return (
    <div ref={wrapperRef} className="w-full">
      <div ref={innerRef} className="flex w-full items-end gap-2" style={{ width: DESIGN_WIDTH }}>
        {/* Left: song title + artist — layoutId pairs with NowPlaying compact for shared animation */}
        <motion.div layoutId="song-info" transition={LAYOUT_TRANSITION} className="min-w-0 flex-1" style={{ fontFamily: 'var(--font-apple)' }}>
          <motion.div
            initial={{ fontSize: 18 }}
            animate={{ fontSize: 20 }}
            transition={SPRING}
            className="font-bold leading-tight text-white/90"
          >
            <MarqueeText>{currentTrack?.title ?? '暂无歌曲'}</MarqueeText>
          </motion.div>
          <motion.div
            initial={{ fontSize: 16 }}
            animate={{ fontSize: 14 }}
            transition={SPRING}
            className="text-white/50"
          >
            <MarqueeText>{currentTrack ? currentTrack.artist.join(' / ') : '点击搜索添加歌曲到队列'}</MarqueeText>
          </motion.div>
        </motion.div>

        {/* Right-bottom: volume + chat buttons (always visible, aligned to bottom) */}
        <div className="flex shrink-0 items-center">
          <VolumeControl volume={volume} setVolume={setVolume} toggleMute={toggleMute} />
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <MediaButton
                onClick={onOpenChat}
                aria-label="聊天"
                className="relative h-6 w-6"
                style={{ color: 'rgba(255, 255, 255, 0.7)' }}
              >
                <ChatIcon className="size-5" />
                {chatUnreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/90 px-1 text-[10px] font-semibold leading-none text-black">
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </span>
                )}
              </MediaButton>
            </TooltipTrigger>
            <TooltipContent>聊天</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})
