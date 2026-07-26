import { lazy, Suspense, useRef } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { SocketProvider } from '@/providers/SocketProvider'
import HomePage from '@/pages/HomePage'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AnimatePresence } from 'motion/react'
import { AlertTriangle } from 'lucide-react'
import { useE2BSkin } from '@/hooks/useE2BSkin'

// Lazy-loaded routes (keep HomePage sync for fast first paint)
const RoomPage = lazy(() => import('@/pages/RoomPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function ErrorFallback({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: () => void }) {
  const message = error instanceof Error ? error.message : '应用遇到了意外错误'
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-lg">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">出了点问题</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={resetErrorBoundary} variant="default">
          重试
        </Button>
      </div>
    </div>
  )
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

/** Route-level ErrorBoundary: navigates home on reset instead of full reload */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => navigate('/', { replace: true })}>
      {children}
    </ErrorBoundary>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Suspense fallback={<RouteFallback />}>
        <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <RouteErrorBoundary>
                <HomePage />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/room/:roomId"
            element={
              <RouteErrorBoundary>
                <RoomPage />
              </RouteErrorBoundary>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AnimatePresence>
  )
}

/**
 * E2B 皮肤固定层：点阵背景 + 滚动进度条 + 自定义光标。
 * 放在 Router 外层，路由切换时不卸载，常驻 DOM。
 */
function E2BSkinLayers() {
  const cursorRef = useRef<HTMLDivElement | null>(null)
  const scrollProgressRef = useRef<HTMLDivElement | null>(null)
  const sideScrollRef = useRef<HTMLDivElement | null>(null)
  useE2BSkin({ cursorRef, scrollProgressRef, sideScrollRef })

  return (
    <>
      <div className="dotted-bg" aria-hidden="true" />
      <div ref={scrollProgressRef} className="scroll-progress" aria-hidden="true" />
      <div ref={sideScrollRef} className="side-scroll-indicator" aria-hidden="true">
        <span />
      </div>
      <div ref={cursorRef} className="cursor" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SocketProvider>
        <TooltipProvider>
          <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
            <AnimatedRoutes />
          </ErrorBoundary>
          <Toaster position="top-center" richColors />
          <E2BSkinLayers />
        </TooltipProvider>
      </SocketProvider>
    </BrowserRouter>
  )
}
