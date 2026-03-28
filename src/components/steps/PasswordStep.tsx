import { useState } from 'react'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'

type PasswordStepProps = {
  onSubmit: (password: string) => void
  error?: string | null
  onBack: () => void
}

export function PasswordStep({ onSubmit, error, onBack }: PasswordStepProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Guard: don't submit whitespace-only input
    if (password.trim()) onSubmit(password)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center">
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Enter Your Password
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the escrow password you chose when setting up this contract.
        </p>
      </div>

      {error && (
        <div className="rounded-[var(--radius-base)] bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {/* Premium password input — larger, more padding, ring expansion on focus */}
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your escrow password"
          className="input-premium w-full rounded-[var(--radius-surface)] border border-border bg-[var(--input-bg)] px-5 py-4 pr-14 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          autoFocus
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
        <span>Your password never leaves this device. All operations happen locally.</span>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={!password.trim()}
          className="btn-primary w-full rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:bg-[var(--button-primary-disabled-bg)] disabled:text-[var(--button-primary-disabled-fg)] disabled:opacity-100 disabled:shadow-none"
        >
          Recover Key
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Back
        </button>
      </div>
    </form>
  )
}
