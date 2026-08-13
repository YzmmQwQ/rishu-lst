/**
 * AMLL 风格进度条（BouncingSlider），移植自
 * amll-page/packages/react-full/src/components/BouncingSlider。
 *
 * 视觉：默认一条细药丸条（圆角，左填充白色半透明进度），hover/拖拽时高度
 * 从 MIN 展开到 MAX（clipPath inset 动画），无拨杆圆点；拖到边界有橡皮筋回弹。
 * 行为：onPan 拖动 → onChange(value)；onTap 点击 → onChange(value)。
 *
 * 与项目现状对齐：value/duration 由外部 store 驱动，onChange 即 seek。
 */
import { cn } from '@/lib/utils'
import {
	animate,
	motion,
	type PanInfo,
	useAnimationFrame,
	useMotionTemplate,
	useMotionValue,
	useSpring,
	useTransform,
} from 'motion/react'
import { memo, useEffect, useRef } from 'react'

export interface BouncingSliderProps {
	className?: string
	style?: React.CSSProperties
	/** 当前播放位置（秒） */
	value: number
	/** 总时长（秒） */
	max: number
	min?: number
	isPlaying?: boolean
	/** 是否允许拖拽（无 seek 权限时禁用） */
	disabled?: boolean
	/** 拖拽开始/结束回调；结束时应把最终值提交给外部（seek） */
	onSeeking?: (seeking: boolean) => void
	/** 拖拽/点击过程中位置变化（秒）；用于外部本地预览 */
	onValueChange?: (v: number) => void
	onChange?: (v: number) => void
}

const MAX_HEIGHT = 20
const MIN_HEIGHT = 8
const INITIAL_INSET = (MAX_HEIGHT - MIN_HEIGHT) / 2
const MAX_BOUNCE_DISTANCE = 12

export const BouncingSlider = memo(function BouncingSlider({
	className,
	style,
	value,
	max,
	min = 0,
	isPlaying = false,
	disabled = false,
	onSeeking,
	onValueChange,
	onChange,
}: BouncingSliderProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const innerRef = useRef<HTMLDivElement>(null)
	const rectRef = useRef<DOMRect | null>(null)
	const isHoveringRef = useRef(false)

	const progressMv = useMotionValue(0)
	const scaleX = useTransform(progressMv, [0, 1], [0, 1])

	const insetMv = useMotionValue(INITIAL_INSET)
	const clipPath = useMotionTemplate`inset(${insetMv}px 0px round 100px)`

	const bounceXSpring = useSpring(0, { damping: 12, stiffness: 300 })

	const isDraggingRef = useRef(false)
	const localTimeRef = useRef(value)

	useEffect(() => {
		if (isDraggingRef.current) return

		localTimeRef.current = value
		const range = max - min
		const newProgress = range > 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0
		progressMv.set(newProgress)
	}, [value, min, max, progressMv])

	useAnimationFrame((_time, delta) => {
		if (isPlaying && !isDraggingRef.current) {
			localTimeRef.current += delta / 1000

			if (localTimeRef.current > max) localTimeRef.current = max

			const range = max - min
			const newProgress = range > 0 ? Math.max(0, Math.min(1, (localTimeRef.current - min) / range)) : 0
			progressMv.set(newProgress)
		}
	})

	const expand = () => {
		animate(insetMv, 0, { type: 'tween', ease: 'easeOut', duration: 0.28 })
	}

	const collapse = () => {
		animate(insetMv, INITIAL_INSET, { type: 'spring', damping: 12, stiffness: 200 })
	}

	const handlePanStart = (_event: MouseEvent | TouchEvent | PointerEvent) => {
		if (disabled) return
		isDraggingRef.current = true

		if (innerRef.current) {
			rectRef.current = innerRef.current.getBoundingClientRect()
		}

		expand()
		onSeeking?.(true)
	}

	const handlePan = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
		if (disabled) return
		const rect = rectRef.current
		if (!rect) return

		const relPos = (info.point.x - rect.left) / rect.width

		if (relPos < 0) {
			bounceXSpring.set(Math.tanh(relPos * 2) * MAX_BOUNCE_DISTANCE)
		} else if (relPos > 1) {
			bounceXSpring.set(Math.tanh((relPos - 1) * 2) * MAX_BOUNCE_DISTANCE)
		} else {
			bounceXSpring.set(0)
		}

		const clampedPos = Math.max(0, Math.min(1, relPos))
		const newValue = min + clampedPos * (max - min)

		localTimeRef.current = newValue
		progressMv.set(clampedPos)
		onValueChange?.(newValue)
	}

	const handlePanEnd = () => {
		if (disabled) return
		isDraggingRef.current = false
		rectRef.current = null

		if (isHoveringRef.current) {
			expand()
		} else {
			collapse()
		}

		bounceXSpring.set(0)

		onSeeking?.(false)
		onChange?.(localTimeRef.current)
	}

	const handleHoverStart = () => {
		isHoveringRef.current = true
		if (!isDraggingRef.current) {
			expand()
		}
	}

	const handleHoverEnd = () => {
		isHoveringRef.current = false
		if (!isDraggingRef.current) {
			collapse()
		}
	}

	const handleTap = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
		if (disabled) return
		const rect = innerRef.current?.getBoundingClientRect()
		if (!rect) return

		const relPos = Math.max(0, Math.min(1, (info.point.x - rect.left) / rect.width))
		const newValue = min + relPos * (max - min)

		localTimeRef.current = newValue
		progressMv.set(relPos)

		onValueChange?.(newValue)
		onSeeking?.(true)
		onChange?.(newValue)
		// 单击 seek 立即结束拖拽态
		onSeeking?.(false)
	}

	return (
		<motion.div
			ref={containerRef}
			className={cn(
				'flex h-6 items-center justify-stretch touch-none',
				disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
				className,
			)}
			style={{
				...style,
				x: bounceXSpring,
				// GPU 合成
				translateZ: 0,
			}}
			onPanStart={handlePanStart}
			onPan={handlePan}
			onPanEnd={handlePanEnd}
			onTap={handleTap}
			onHoverStart={handleHoverStart}
			onHoverEnd={handleHoverEnd}
		>
			<motion.div
				ref={innerRef}
				className="relative h-[20px] w-full flex-1 bg-white/15"
				style={{
					clipPath,
				}}
			>
				<motion.div
					className="h-full w-full bg-white opacity-40"
					style={{
						scaleX,
						originX: 0,
					}}
				/>
			</motion.div>
		</motion.div>
	)
})
