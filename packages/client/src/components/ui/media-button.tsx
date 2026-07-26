import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

/**
 * AMLL 风格媒体按钮，照搬 amll-page/packages/react-full/src/components/MediaButton。
 * - 圆形容器（aspect-ratio:1/1, border-radius:50%）、完全透明背景
 * - hover/active 浮现 rgba(255,255,255,0.133)（#fff2）圆形背景
 * - 子元素 pressed-animation 弹性按压（scale 1→0.85→1.1→1）
 * 尺寸由父级控制（width/height 或 className），组件自身不固定 px。
 */
export interface MediaButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const MediaButton = forwardRef<HTMLButtonElement, MediaButtonProps>(function MediaButton(
  { className, children, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn('media-button', className)}
      {...props}
    >
      {children}
    </button>
  )
})
