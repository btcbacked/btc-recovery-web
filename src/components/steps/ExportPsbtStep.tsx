import { useState } from 'react'
import { CircleCheck, Download, RotateCcw, Info, ArrowLeft, AlertTriangle } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import type { PsbtAnalysis } from '@/crypto/psbt-finalizer'

type ExportPsbtStepProps = {
  analysis: PsbtAnalysis
  psbtBase64: string
  psbtError: string | null
  onDownload: () => void
  onBack: () => void
  onStartOver: () => void
}

export function ExportPsbtStep({
  analysis,
  psbtBase64,
  psbtError,
  onDownload,
  onBack,
  onStartOver,
}: ExportPsbtStepProps) {
  const [downloadedFlash, setDownloadedFlash] = useState(false)
  const sigCount = analysis.signatureCount[0] ?? 0

  const handleDownload = () => {
    onDownload()
    setDownloadedFlash(true)
    setTimeout(() => setDownloadedFlash(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Error from psbt workflow */}
      {psbtError && (
        <div className="flex items-start gap-2 rounded-[var(--radius-base)] border border-destructive/20 bg-destructive/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{psbtError}</p>
        </div>
      )}

      {/* Success indicator */}
      <div className="text-center">
        <div className="animate-success-pop mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CircleCheck className="size-7 text-success" aria-hidden="true" />
        </div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Signature Added
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your signature has been applied to the transaction.
        </p>
      </div>

      {/* Signature status */}
      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Signature status</span>
          <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            {sigCount} of {analysis.requiredSignatures} signatures
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {analysis.requiredSignatures - sigCount} more signature
          {analysis.requiredSignatures - sigCount !== 1 ? 's are' : ' is'} needed before this
          transaction can be broadcast to the network.
        </p>
      </div>

      {/* PSBT base64 */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Partially-Signed Bitcoin Transaction (PSBT)
        </p>
        <div className="code-block max-h-40 overflow-y-auto">
          <pre className="break-all">{psbtBase64}</pre>
        </div>
        <div className="mt-2 flex justify-end">
          <CopyButton text={psbtBase64} label="Copy PSBT" className="px-3 py-1.5 text-xs" />
        </div>
      </div>

      {/* Instructions */}
      <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-accent/50 px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">What to do next</p>
          <ol className="step-list mt-1 space-y-1">
            <li className="step-list-item">
              Download or copy the PSBT above.
            </li>
            <li className="step-list-item">
              Share it securely with the other signer (e.g. the counterparty or BTCBacked platform).
            </li>
            <li className="step-list-item">
              The second signer adds their signature and then broadcasts the transaction.
            </li>
          </ol>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleDownload}
            className="btn-primary inline-flex items-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            {downloadedFlash ? (
              <>
                <CircleCheck className="size-4" aria-hidden="true" />
                Downloaded!
              </>
            ) : (
              <>
                <Download className="size-4" aria-hidden="true" />
                Download .psbt File
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onStartOver}
            className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Start Over
          </button>
        </div>
      </div>
    </div>
  )
}
