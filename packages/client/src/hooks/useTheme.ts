import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'theme'
type Theme = 'light' | 'dark'

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return false
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'dark') return true
  if (saved === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * E2B 主题切换：深浅 + 记忆。
 *
 * - localStorage `theme` 优先，缺省读 `prefers-color-scheme`。
 * - 在 <html> 上 toggle `.dark` 类，与 index.css 的 `.dark` 选择器对应。
 * - 与 index.html 的首屏防闪脚本共用同一个 storage key。
 */
export function useTheme() {
  const [isDark, setIsDark] = useState<boolean>(getInitialDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // 跟随系统偏好变化（仅当用户未显式设置时）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) setIsDark(e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, (next ? 'dark' : 'light') as Theme)
      return next
    })
  }, [])

  return { isDark, toggleTheme }
}
