import { Cpu, Download } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import type { RecoveryFile } from '@/crypto'

type HardwareStepProps = {
  file: RecoveryFile
  onContinue: () => void
  onBack: () => void
}

export function HardwareStep({ file, onContinue, onBack }: HardwareStepProps) {
  const handleDownload = () => {
    const blob = new Blob([file.outputDescriptor], { type: 'text/plain' })
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
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-info/10">
          <Cpu className="size-7 text-info" aria-hidden="true" />
        </div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Hardware Wallet Key
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This recovery file uses a ColdCard hardware wallet. No password is needed because
          the private key is stored securely on your ColdCard device — it never touches this
          browser. Import the output descriptor below into your wallet software, then sign
          transactions using your ColdCard.
        </p>
      </div>

      {/* Descriptor code block — premium monospace treatment */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Output Descriptor
        </p>
        <div className="code-block">
          <pre>{file.outputDescriptor}</pre>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <CopyButton text={file.outputDescriptor} label="Copy Descriptor" />
        <button
          type="button"
          onClick={handleDownload}
          className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <Download className="size-4" aria-hidden="true" />
          Download as .txt
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onContinue}
          className="btn-primary w-full rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          View Import Instructions
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Back
        </button>
      </div>
    </div>
  )
}
