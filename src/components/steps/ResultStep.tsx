import { CircleCheck, AlertTriangle, Download } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'

type ResultStepProps = {
  descriptor: string
  onContinue: () => void
}

export function ResultStep({ descriptor, onContinue }: ResultStepProps) {
  const handleDownload = () => {
    const blob = new Blob([descriptor], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'btcbacked-recovery-descriptor.txt'
    // Firefox requires the anchor to be in the DOM before .click()
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Delay revoke so Firefox has time to initiate the download
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        {/* Animated success checkmark */}
        <div className="animate-success-pop mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CircleCheck className="size-7 text-success" aria-hidden="true" />
        </div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Recovery Complete
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your signing-ready descriptor has been derived successfully.
        </p>
      </div>

      {/* Plain-English explanation */}
      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">What is this descriptor?</p>
        <p className="mt-1">
          A wallet descriptor is a self-contained string that encodes your multisig wallet
          configuration — including your recovered private key and the other participants'
          public keys. Paste it into Sparrow Wallet or another compatible wallet to view
          your balance and broadcast transactions.
        </p>
      </div>

      {/* Descriptor code block — premium monospace treatment */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Signing-Ready Descriptor
        </p>
        <div className="code-block">
          <pre>{descriptor}</pre>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <CopyButton text={descriptor} />
        <button
          type="button"
          onClick={handleDownload}
          className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <Download className="size-4" aria-hidden="true" />
          Download as .txt
        </button>
      </div>

      {/* Security warning */}
      <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-warning/10 px-4 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-xs text-warning">
          <strong>Keep this secret.</strong> This descriptor contains your private signing
          key in plain text. Anyone who obtains it can spend your Bitcoin. Do not share it,
          screenshot it, or store it in an insecure location. Treat it like a seed phrase.
        </p>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="btn-primary w-full rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Next: Import into Wallet
      </button>
    </div>
  )
}
