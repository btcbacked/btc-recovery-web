import { ArrowLeft, PenLine, AlertTriangle } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { formatBtc, formatSats } from '@/lib/btcFormat'
import type { PsbtAnalysis } from '@/crypto/psbt-finalizer'

type ReviewPsbtStepProps = {
  analysis: PsbtAnalysis
  onSign: () => void
  onBack: () => void
}

export function ReviewPsbtStep({ analysis, onSign, onBack }: ReviewPsbtStepProps) {
  const minSigCount = Math.min(...(analysis.signatureCount.length > 0 ? analysis.signatureCount : [0]))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Review Imported PSBT
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verify the transaction details before adding your signature.
        </p>
      </div>

      {/* Signature status */}
      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Current signature status</span>
          <span
            className={
              analysis.isFullySigned
                ? 'rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success-text'
                : 'rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning-text'
            }
          >
            {minSigCount} of {analysis.requiredSignatures} signatures
          </span>
        </div>
        {!analysis.isFullySigned && (
          <p className="mt-2 text-xs text-muted-foreground">
            This PSBT needs {analysis.requiredSignatures - minSigCount} more signature
            {analysis.requiredSignatures - minSigCount !== 1 ? 's' : ''} to be broadcast.
          </p>
        )}
      </div>

      {/* Inputs */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Inputs ({analysis.inputCount})
        </p>
        <div className="divide-y divide-border rounded-[var(--radius-base)] border border-border">
          {Array.from({ length: analysis.inputCount }, (_, i) => {
            // This row used to divide the total by the number of inputs, so
            // every row showed the same average. With two unequal inputs that
            // is a figure neither input has, and it can carry a fraction of a
            // satoshi. Each row now reads its own value.
            const value = analysis.inputValues[i]
            return (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs text-muted-foreground">Input {i + 1}</span>
                <div className="text-right">
                  {value === null || value === undefined ? (
                    <span className="text-xs font-medium text-muted-foreground">Unknown</span>
                  ) : (
                    <span className="text-xs font-medium text-foreground">
                      {formatSats(value)} sats
                    </span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({analysis.signatureCount[i] ?? 0} sig{(analysis.signatureCount[i] ?? 0) !== 1 ? 's' : ''})
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Outputs */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Outputs ({analysis.outputCount})
        </p>
        <div className="divide-y divide-border rounded-[var(--radius-base)] border border-border">
          {analysis.outputs.map((output, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-1.5">
                  {output.address === null ? (
                    /* The script decodes to no address, so there is nothing to
                       show and nothing to copy. Offering a copy control here
                       handed the customer a placeholder word that a block
                       explorer finds nothing for, leaving them unable to tell
                       a broken tool from a bad address. */
                    <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
                      Unknown
                    </span>
                  ) : (
                    <>
                      {/* The full address, never truncated. This screen tells
                          the customer to confirm the destination, and a
                          shortened address cannot rule out a substitution that
                          matches on the first and last characters. */}
                      <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                        {output.address}
                      </code>
                      {output.isChange && (
                        <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          change
                        </span>
                      )}
                      <CopyButton
                        text={output.address}
                        variant="icon"
                        ariaLabel={`Copy ${output.isChange ? 'change' : 'destination'} address, output ${i + 1} of ${analysis.outputs.length}`}
                      />
                    </>
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
        </div>
      </div>

      {/* Fee */}
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
          <span className="text-sm font-semibold text-foreground">
            {formatSats(analysis.fee)} sats
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({formatBtc(analysis.fee)} BTC)
            </span>
          </span>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-warning/10 px-4 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-xs text-warning-text">
          <strong>Verify before signing.</strong> Confirm the destination address and amount are
          correct. Once signed, this cannot be reversed.
        </p>
      </div>

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
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          <PenLine className="size-4" aria-hidden="true" />
          Add Your Signature
        </button>
      </div>
    </div>
  )
}
