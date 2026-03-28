import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type AppLayoutProps = {
  children: ReactNode
  className?: string
  onReset?: () => void
}

export function AppLayout({ children, className, onReset }: AppLayoutProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-dvh w-full flex-col bg-background',
        className,
      )}
    >
      {/* Page gradient background — gentle radial glow from top */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'var(--page-bg-gradient)' }}
        aria-hidden="true"
      />

      {/* Ambient orange glow — centred, subtle */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'var(--auth-ambient-glow)' }}
        aria-hidden="true"
      />

      {/* Logo — top left */}
      <div className="absolute left-6 top-6 z-20 h-7 w-[120px] md:left-[70px] md:top-[60px] md:w-[150px]">
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="size-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring transition-opacity hover:opacity-75"
            aria-label="BTCBacked — return to start"
          >
            <img
              src="/logo/logo-light.svg"
              alt="BTCBacked"
              className="size-full object-contain"
            />
          </button>
        ) : (
          <img
            src="/logo/logo-light.svg"
            alt="BTCBacked"
            className="size-full object-contain"
          />
        )}
      </div>

      {/* Centred content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-20 md:px-6 md:py-24">
        <div className="w-full max-w-[540px] animate-page-enter">
          {children}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 shrink-0 pb-6 md:pb-8">
        <div className="mx-auto max-w-[540px] px-4">
          <div className="mb-4 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-60" />
          <p className="text-center font-outfit text-[var(--text-body-sm)] text-muted-foreground">
            BTCBacked AG &mdash; Zug, Switzerland
          </p>
        </div>
      </div>
    </div>
  )
}
