import { useState } from 'react'
import { ArrowLeft, PenLine, AlertTriangle } from 'lucide-react'
import { formatBtc, formatSats, truncateHash } from '@/lib/btcFormat'
import type { PsbtAnalysis } from '@/crypto/psbt-finalizer'

type ReviewSignStepProps = {
  analysis: PsbtAnalysis
  error: string | null
  onSign: () => void
  onBack: () => void
}

export function ReviewSignStep({ analysis, error, onSign, onBack }: ReviewSignStepProps) {
  const [confirmed, setConfirmed] = useState(false)

  const destinationOutputs = analysis.outputs.filter((o) => !o.isChange)
  const changeOutputs = analysis.outputs.filter((o) => o.isChange)
  const primaryDestination = destinationOutputs[0]

  // Fee rate: fee (sats) / vbytes. vbytes is not directly available from PsbtAnalysis,
  // so we expose it as a computed display if feeRate is present, else omit.
  const feeRate = analysis.feeRate ?? null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Review Transaction
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verify all details carefully before adding your signature.
        </p>
      </div>

      {/* Error from psbt workflow */}
      {error && (
        <div className="rounded-[var(--radius-base)] border border-destructive/20 bg-destructive/10 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Prominent destination summary */}
      {primaryDestination && (
        <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sending
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {formatBtc(primaryDestination.value)}{' '}
            <span className="text-base text-muted-foreground">BTC</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatSats(primaryDestination.value)} sats
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            To
          </p>
          {/* Full address, larger text, not truncated */}
          <p className="mt-1 break-all font-mono text-sm font-semibold text-foreground">
            {primaryDestination.address}
          </p>
        </div>
      )}

      {/* Outputs table */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Outputs
        </p>
        <div className="divide-y divide-border rounded-[var(--radius-base)] border border-border">
          {analysis.outputs.map((output, i) => (
            <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-mono text-xs text-foreground">
                    {truncateHash(output.address, 10)}
                  </p>
                  {output.isChange && (
                    <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      change
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-medium text-foreground">
                  {formatBtc(output.value)} BTC
                </p>
                <p className="text-xs text-muted-foreground">{formatSats(output.value)} sats</p>
              </div>
            </div>
          ))}
          {changeOutputs.length === 0 && (
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">No change output — all funds sent.</p>
            </div>
          )}
        </div>
      </div>

      {/* Fee breakdown */}
      <div className="divide-y divide-border rounded-[var(--radius-base)] border border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs text-muted-foreground">Total Input</span>
          <span className="text-sm font-medium text-foreground">
            {formatBtc(analysis.totalInputValue)} BTC
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs text-muted-foreground">Total Output</span>
          <span className="text-sm font-medium text-foreground">
            {formatBtc(analysis.totalOutputValue)} BTC
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-medium text-foreground">Network Fee</span>
          <div className="text-right">
            <span className="text-sm font-semibold text-foreground">
              {formatSats(analysis.fee)} sats
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({formatBtc(analysis.fee)} BTC)
              </span>
            </span>
            {feeRate !== null && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {feeRate} sat/vB
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Signature warning */}
      <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-warning/10 px-4 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-xs text-warning">
          <strong>Partial signature.</strong> You will add 1 of {analysis.requiredSignatures} required
          signatures. The transaction cannot be broadcast until all {analysis.requiredSignatures} signatures
          are collected. You will export the PSBT to share with the other signer.
        </p>
      </div>

      {/* Confirmation checkbox */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
        />
        <span className="text-sm text-foreground">
          I have verified the destination address and amount shown above and confirm this transaction is correct.
        </span>
      </label>

      {/* Actions */}
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
          onClick={onSign}
          disabled={!confirmed}
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:bg-[var(--button-primary-disabled-bg)] disabled:text-[var(--button-primary-disabled-fg)] disabled:opacity-100 disabled:shadow-none"
        >
          <PenLine className="size-4" aria-hidden="true" />
          Sign Transaction
        </button>
      </div>
    </div>
  )
}
