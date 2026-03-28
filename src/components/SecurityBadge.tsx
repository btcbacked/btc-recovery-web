import { ShieldCheck } from 'lucide-react'

export function SecurityBadge() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[var(--text-body-sm)] text-muted-foreground"
      style={{
        boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
      }}
    >
      {/* Shield icon with shimmer glow overlay */}
      <span className="relative flex-shrink-0">
        <ShieldCheck className="relative z-10 size-3.5 text-success" aria-hidden="true" />
        <span
          className="security-badge-shimmer pointer-events-none absolute inset-[-4px]"
          aria-hidden="true"
        />
      </span>
      <span>Runs locally &mdash; no data leaves your browser</span>
    </div>
  )
}
