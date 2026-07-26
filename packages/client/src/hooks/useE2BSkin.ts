import { useEffect } from 'react'

/**
 * E2B 皮肤交互层：自定义 L 形光标 + 磁吸按钮 + 滚动进度条。
 *
 * 对应 main/src/App.vue 与 lst/src/App.vue 的 setup 逻辑，React 化。
 * 需要在 App 根渲染对应的固定层 DOM：
 *   <div class="dotted-bg" />
 *   <div class="scroll-progress" />                ← ref={scrollProgressRef}
 *   <div class="side-scroll-indicator"><span /></div>  ← ref={sideScrollRef}
 *   <div class="cursor" ref={cursorRef}><span/>×4</div>
 *
 * 调用方负责把这几个 ref 传进来；本 hook 只接管交互行为。
 */

interface E2BSkinRefs {
  cursorRef: React.RefObject<HTMLDivElement | null>
  scrollProgressRef: React.RefObject<HTMLDivElement | null>
  sideScrollRef: React.RefObject<HTMLDivElement | null>
}

// 光标跟随相关
const CURSOR_SMOOTH = 0.28
const CURSOR_HOVER_SCALE = 0.12
const CURSOR_BASE = 26
const CURSOR_HOVER_PAD = 20

// 磁吸作用的选择器：仅显式标记的导航/主题按钮与 .is-magnetic 元素。
// 不对通用 shadcn Button（[data-slot="button"]）磁吸，避免内容按钮跟着鼠标跑。
const MAGNETIC_SELECTOR = '.theme-toggle, .nav-link, .is-magnetic'
// 光标 hover 放大的目标选择器
const HOVER_SELECTOR = 'a, button, .tag, .link-card, .is-magnetic, .theme-toggle, .nav-link, [data-slot="button"]'

export function useE2BSkin({ cursorRef, scrollProgressRef, sideScrollRef }: E2BSkinRefs) {
  useEffect(() => {
    // 触屏不启用自定义光标
    const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches
    const cursorEl = cursorRef.current
    const progressEl = scrollProgressRef.current
    const sideEl = sideScrollRef.current

    // ---- 滚动进度条 ----
    let scrollRAF = 0
    const updateScroll = () => {
      scrollRAF = 0
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)
      const progress = Math.min(window.scrollY / maxScroll, 1)
      if (progressEl) progressEl.style.transform = `scaleX(${progress})`
      if (sideEl) {
        const span = sideEl.firstElementChild as HTMLElement | null
        if (span) span.style.transform = `scaleY(${Math.max(progress, 0.08)})`
      }
    }
    const queueUpdateScroll = () => {
      if (scrollRAF) return
      scrollRAF = window.requestAnimationFrame(updateScroll)
    }
    updateScroll()
    window.addEventListener('scroll', queueUpdateScroll, { passive: true })
    window.addEventListener('resize', queueUpdateScroll, { passive: true })

    if (coarse || !cursorEl) {
      return () => {
        window.removeEventListener('scroll', queueUpdateScroll)
        window.removeEventListener('resize', queueUpdateScroll)
        if (scrollRAF) window.cancelAnimationFrame(scrollRAF)
      }
    }

    // ---- 自定义光标 ----
    document.body.classList.add('has-custom-cursor')

    const pos = { x: -100, y: -100 }
    const smooth = { x: -100, y: -100 }
    const size = { w: CURSOR_BASE, h: CURSOR_BASE }
    let target: HTMLElement | null = null
    let clickScale = 1
    let clickTarget = 1
    let cursorRAF = 0
    const listeners: Array<{ target: EventTarget; type: string; fn: EventListenerOrEventListenerObject }> = []

    const tick = () => {
      let x = pos.x
      let y = pos.y

      if (target && !target.isConnected) {
        target = null
        cursorEl.classList.remove('is-hover')
      }

      if (target) {
        const rect = target.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          target = null
          cursorEl.classList.remove('is-hover')
        } else {
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          x = cx + (x - cx) * CURSOR_HOVER_SCALE
          y = cy + (y - cy) * CURSOR_HOVER_SCALE
          size.w = rect.width + CURSOR_HOVER_PAD
          size.h = rect.height + CURSOR_HOVER_PAD
        }
      }

      if (!target) {
        size.w += (CURSOR_BASE - size.w) * 0.2
        size.h += (CURSOR_BASE - size.h) * 0.2
      }

      smooth.x += (x - smooth.x) * CURSOR_SMOOTH
      smooth.y += (y - smooth.y) * CURSOR_SMOOTH
      clickScale += (clickTarget - clickScale) * 0.3

      cursorEl.style.transform = `translate3d(${smooth.x}px, ${smooth.y}px, 0) translate(-50%, -50%) scale(${clickScale})`
      cursorEl.style.setProperty('--cursor-width', `${size.w}px`)
      cursorEl.style.setProperty('--cursor-height', `${size.h}px`)

      cursorRAF = window.requestAnimationFrame(tick)
    }

    const onPointerMove = (e: PointerEvent) => {
      pos.x = e.clientX
      pos.y = e.clientY
    }
    const onOver = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.(HOVER_SELECTOR) as HTMLElement | null
      if (!t || target === t) return
      target = t
      cursorEl.classList.add('is-hover')
    }
    const onOut = (e: PointerEvent) => {
      if (!target) return
      if (e.relatedTarget && target.contains(e.relatedTarget as Node)) return
      target = null
      cursorEl.classList.remove('is-hover')
    }
    const onLeave = () => cursorEl.classList.add('is-hidden')
    const onEnter = () => cursorEl.classList.remove('is-hidden')
    const onDown = () => {
      clickTarget = 0.82
    }
    const onUp = () => {
      clickTarget = 1
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('mouseenter', onEnter)
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    listeners.push(
      { target: window, type: 'pointermove', fn: onPointerMove as EventListenerOrEventListenerObject },
      { target: document, type: 'pointerover', fn: onOver as EventListenerOrEventListenerObject },
      { target: document, type: 'pointerout', fn: onOut as EventListenerOrEventListenerObject },
      { target: document, type: 'mouseleave', fn: onLeave as EventListenerOrEventListenerObject },
      { target: document, type: 'mouseenter', fn: onEnter as EventListenerOrEventListenerObject },
      { target: window, type: 'pointerdown', fn: onDown as EventListenerOrEventListenerObject },
      { target: window, type: 'pointerup', fn: onUp as EventListenerOrEventListenerObject },
      { target: window, type: 'pointercancel', fn: onUp as EventListenerOrEventListenerObject },
    )
    cursorRAF = window.requestAnimationFrame(tick)

    // ---- 磁吸按钮 ----
    let magneticTarget: HTMLElement | null = null
    let magneticRect: DOMRect | null = null
    const onMagneticMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(MAGNETIC_SELECTOR) as HTMLElement | null
      if (!el) return
      if (magneticTarget !== el) {
        magneticTarget = el
        magneticRect = el.getBoundingClientRect()
      }
      el.classList.add('is-magnetic')
      const x = (e.clientX - magneticRect!.left - magneticRect!.width / 2) * 0.4
      const y = (e.clientY - magneticRect!.top - magneticRect!.height / 2) * 0.4
      el.style.setProperty('--mx', String(x))
      el.style.setProperty('--my', String(y))
    }
    const onMagneticOut = (e: PointerEvent) => {
      if (!magneticTarget) return
      if (e.relatedTarget && magneticTarget.contains(e.relatedTarget as Node)) return
      magneticTarget.style.setProperty('--mx', '0')
      magneticTarget.style.setProperty('--my', '0')
      magneticTarget = null
      magneticRect = null
    }
    document.addEventListener('pointermove', onMagneticMove)
    document.addEventListener('pointerout', onMagneticOut)
    listeners.push(
      { target: document, type: 'pointermove', fn: onMagneticMove as EventListenerOrEventListenerObject },
      { target: document, type: 'pointerout', fn: onMagneticOut as EventListenerOrEventListenerObject },
    )

    return () => {
      window.cancelAnimationFrame(cursorRAF)
      if (scrollRAF) window.cancelAnimationFrame(scrollRAF)
      document.body.classList.remove('has-custom-cursor')
      window.removeEventListener('scroll', queueUpdateScroll)
      window.removeEventListener('resize', queueUpdateScroll)
      listeners.forEach(({ target, type, fn }) => target.removeEventListener(type, fn))
      target = null
      magneticTarget = null
      magneticRect = null
    }
  }, [cursorRef, scrollProgressRef, sideScrollRef])
}
