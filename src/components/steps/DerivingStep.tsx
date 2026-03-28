import { useEffect, useState } from 'react'

const STATUS_MESSAGES = [
  'Deriving your key...',
  'Running cryptographic verification...',
  'Almost there...',
]

export function DerivingStep() {
  const [messageIndex, setMessageIndex] = useState(0)
  const [messageKey, setMessageKey] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % STATUS_MESSAGES.length)
      setMessageKey((prev) => prev + 1)
    }, 2400)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-6 text-center" aria-busy="true" aria-label="Deriving your signing key">
      {/* Premium circular progress ring */}
      <div className="deriving-ring-container mx-auto">
        {/* Breathing glow behind the ring */}
        <div className="deriving-ring-glow" aria-hidden="true" />

        {/* SVG ring with gradient stroke */}
        <svg
          className="deriving-ring-svg"
          viewBox="0 0 72 72"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffb060" />
              <stop offset="50%" stopColor="#fe7921" />
              <stop offset="100%" stopColor="#c34e00" />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle
            className="deriving-ring-track"
            cx="36"
            cy="36"
            r="28"
          />
          {/* Progress arc */}
          <circle
            className="deriving-ring-progress"
            cx="36"
            cy="36"
            r="28"
          />
        </svg>

        {/* Bitcoin "₿" symbol in centre */}
        <span
          className="deriving-ring-icon relative z-10 text-lg font-bold"
          aria-hidden="true"
        >
          ₿
        </span>
      </div>

      <div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Deriving Your Key
        </h2>

        {/* Smoothly fading status message — re-keyed so each swap triggers animation */}
        <p
          key={messageKey}
          className="animate-msg-fade mt-2 text-sm text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {STATUS_MESSAGES[messageIndex]}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          Running 100,000 rounds of PBKDF2. This typically takes a few seconds.
        </p>
      </div>

      {/* Animated progress bar */}
      <div
        className="mx-auto h-1 w-full max-w-xs overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Derivation progress"
      >
        <div
          className="h-full w-full origin-left animate-pulse rounded-full opacity-80"
          style={{
            background: 'linear-gradient(90deg, #fe7921 0%, #ffb060 60%, #fe7921 100%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 2s linear infinite, pulse 2s ease-in-out infinite',
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
