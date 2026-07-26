import { MarqueeText } from '@/components/ui/marquee-text'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/stores/playerStore'
import { Disc3 } from 'lucide-react'
import { motion } from 'motion/react'
import { Squircle } from 'corner-smoothing'
import { useEffect, useState } from 'react'
import { LAYOUT_TRANSITION, SPRING } from './constants'

interface NowPlayingProps {
  /** Compact mode: small cover + song info in a single row (lyric view top bar) */
  compact?: boolean
  /** Called when the cover art is tapped (toggle lyric view) */
  onCoverClick?: () => void
}

export function NowPlaying({ compact = false, onCoverClick }: NowPlayingProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const [coverError, setCoverError] = useState(false)

  // Skip layoutId on first frame to prevent unwanted entry animation
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(true)
  }, [])
  const layoutId = ready ? 'cover-art' : undefined

  // Reset error state when track changes
  useEffect(() => {
    setCoverError(false)
  }, [currentTrack?.id])

  const showCover = currentTrack?.cover && !coverError

  const coverContent = showCover ? (
    <img
      src={currentTrack.cover}
      alt={currentTrack.title}
      className="h-full w-full object-cover"
      onError={() => setCoverError(true)}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-[#222222]">
      <Disc3 className={cn('text-white/20', compact ? 'h-6 w-6' : 'h-1/3 w-1/3')} />
    </div>
  )

  // ---------------------------------------------------------------------------
  // Compact mode: small cover + song info in a horizontal row (lyric view)
  // ---------------------------------------------------------------------------
  if (compact) {
    return (
      <div className="flex w-full items-center gap-3.5">
        <motion.div
          layoutId={layoutId}
          onClick={onCoverClick}
          whileTap={{ scale: 0.92 }}
          transition={LAYOUT_TRANSITION}
          className="cover-shadow h-14 w-14 shrink-0 cursor-pointer"
        >
          <Squircle cornerRadius={8} cornerSmoothing={0.7} className="h-full w-full overflow-hidden">
            {coverContent}
          </Squircle>
        </motion.div>
        <motion.div
          layoutId={ready ? 'song-info' : undefined}
          transition={LAYOUT_TRANSITION}
          className="min-w-0 flex-1"
          style={{ fontFamily: 'var(--font-apple)' }}
        >
          <motion.div
            initial={{ fontSize: 20 }}
            animate={{ fontSize: 22 }}
            transition={SPRING}
            className="font-semibold leading-tight text-white/90"
          >
            <MarqueeText>{currentTrack?.title ?? '暂无歌曲'}</MarqueeText>
          </motion.div>
          <motion.div
            initial={{ fontSize: 14 }}
            animate={{ fontSize: 16 }}
            transition={SPRING}
            className="text-white/50"
          >
            <MarqueeText>{currentTrack ? currentTrack.artist.join(' / ') : '...'}</MarqueeText>
          </motion.div>
        </motion.div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Default mode: cover only (song info is handled by SongInfoBar)
  // amll-page Cover 风格：超椭圆圆角 + 柔和投影 + 暂停缩小弹性过渡
  // ---------------------------------------------------------------------------
  return (
    <motion.div
      layoutId={layoutId}
      onClick={onCoverClick}
      animate={{ scale: isPlaying ? 1 : 0.9 }}
      whileTap={onCoverClick ? { scale: 0.96 } : undefined}
      transition={{ ...SPRING, layout: SPRING }}
      style={{ width: 'min(100cqw, 100cqh)' }}
      className={cn(
        'cover-shadow relative mx-auto aspect-square',
        onCoverClick && 'cursor-pointer',
      )}
    >
      <Squircle cornerRadius={20} cornerSmoothing={0.7} className="h-full w-full overflow-hidden">
        {coverContent}
      </Squircle>
    </motion.div>
  )
}
