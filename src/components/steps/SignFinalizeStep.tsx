import { useEffect, useState } from 'react'
import { ArrowLeft, CircleCheck, Download, Radio, RefreshCw } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import type { PsbtAnalysis } from '@/crypto/psbt-finalizer'

type SignFinalizeStepProps = {
  analysis: PsbtAnalysis | null
  psbtBase64: string | null
  isProcessing: boolean
  error: string | null
  onBroadcast: () => void
  onDownloadPsbt: () => void
  onBack: () => void
  onRetrySign?: () => void
}

const SIGNING_MESSAGES = [
  'Signing transaction inputs...',
  'Applying your signature...',
  'Verifying signature validity...',
]

export function SignFinalizeStep({
  analysis,
  psbtBase64,
  isProcessing,
  error,
  onBroadcast,
  onDownloadPsbt,
  onBack,
  onRetrySign,
}: SignFinalizeStepProps) {
  const [messageIndex, setMessageIndex] = useState(0)
  const [messageKey, setMessageKey] = useState(0)

  useEffect(() => {
    if (!isProcessing) return
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % SIGNING_MESSAGES.length)
      setMessageKey((prev) => prev + 1)
    }, 1800)
    return () => clearInterval(interval)
  }, [isProcessing])

  const isDone = !isProcessing && !error && analysis !== null
  const isFullySigned = isDone && analysis.isFullySigned
  const sigCount = analysis?.signatureCount[0] ?? 0

  return (
    <div className="space-y-6">
      {/* Processing state */}
      {isProcessing && (
        <div className="space-y-6 text-center" aria-busy="true" aria-label="Signing transaction">
          <div className="deriving-ring-container mx-auto">
            <div className="deriving-ring-glow" aria-hidden="true" />
            <svg className="deriving-ring-svg" viewBox="0 0 72 72" aria-hidden="true">
              <defs>
                <linearGradient id="ring-gradient-sign" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffb060" />
                  <stop offset="50%" stopColor="#fe7921" />
                  <stop offset="100%" stopColor="#c34e00" />
                </linearGradient>
              </defs>
              <circle className="deriving-ring-track" cx="36" cy="36" r="28" />
              <circle
                className="deriving-ring-progress"
                cx="36"
                cy="36"
                r="28"
                style={{ stroke: 'url(#ring-gradient-sign)' }}
              />
            </svg>
            <span className="deriving-ring-icon relative z-10 text-lg font-bold" aria-hidden="true">
              ₿
            </span>
          </div>

          <div>
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Signing Transaction
            </h2>
            <p
              key={messageKey}
              className="animate-msg-fade mt-2 text-sm text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              {SIGNING_MESSAGES[messageIndex]}
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {!isProcessing && error && (
        <div className="space-y-4">
          <div className="text-center">
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Signing Failed
            </h2>
          </div>
          <div className="rounded-[var(--radius-base)] border border-destructive/20 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={onBack}
              className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>

            {onRetrySign && (
              <button
                type="button"
                onClick={onRetrySign}
                className="btn-primary inline-flex items-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Success: fully signed */}
      {isDone && isFullySigned && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="animate-success-pop mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <CircleCheck className="size-7 text-success" aria-hidden="true" />
            </div>
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Transaction Fully Signed
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              All {analysis.requiredSignatures} required signatures are present. Ready to broadcast.
            </p>
          </div>

          <div className="rounded-[var(--radius-base)] border border-success/20 bg-success/5 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Signature status</span>
              <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                {sigCount} of {analysis.requiredSignatures} — fully signed
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={onBack}
              className="btn-outline inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>

            <button
              type="button"
              onClick={onBroadcast}
              className="btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
            >
              <Radio className="size-4" aria-hidden="true" />
              Broadcast Transaction
            </button>
          </div>
        </div>
      )}

      {/* Success: partially signed */}
      {isDone && !isFullySigned && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="animate-success-pop mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CircleCheck className="size-7 text-primary" aria-hidden="true" />
            </div>
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Signature Added
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {sigCount} of {analysis.requiredSignatures} signatures present.
              Share this PSBT with the remaining signer.
            </p>
          </div>

          <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Signature status</span>
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                {sigCount} of {analysis.requiredSignatures}
              </span>
            </div>
          </div>

          {psbtBase64 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Updated PSBT
              </p>
              <div className="code-block max-h-32 overflow-y-auto">
                <pre className="break-all">{psbtBase64}</pre>
              </div>
              <div className="mt-2 flex justify-end">
                <CopyButton text={psbtBase64} label="Copy PSBT" className="px-3 py-1.5 text-xs" />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={onBack}
              className="btn-outline inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>

            <button
              type="button"
              onClick={onDownloadPsbt}
              className="btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
            >
              <Download className="size-4" aria-hidden="true" />
              Download .psbt File
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
