import { CircleCheck, Download } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import {
  PrivateKeyWarning,
  privateKeyWarningDescribedBy,
} from '@/components/PrivateKeyWarning'

/** Names the key block for assistive technology. Reuses the visible label. */
const LABEL_ID = 'result-signing-file-label'

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
    a.download = 'btcbacked-signing-file.txt'
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
          Your signing file has been rebuilt successfully.
        </p>
      </div>

      {/* Plain-English explanation */}
      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">What is this signing file?</p>
        <p className="mt-1">
          A signing file is a self-contained line of text that holds your recovered
          private key together with the other participants' public keys. Paste it into
          Sparrow Wallet or another compatible wallet to view your balance and broadcast
          transactions.
        </p>
      </div>

      {/* Read before the key is on screen, not after the buttons that copy it.
          `always`, because this screen is only reachable on the password path
          and the string below always carries the recovered key. Nothing the
          scan concludes should be able to take the warning off this screen. */}
      <PrivateKeyWarning text={descriptor} always />

      {/* The signing file itself — premium monospace treatment */}
      <div>
        <p
          id={LABEL_ID}
          className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          Signing File
        </p>
        {/* Named and described, so landing on the key by any route reads the
            warning first. `always` matches the warning above it: this screen is
            only reachable carrying the key, so the description always resolves. */}
        <div
          role="group"
          aria-labelledby={LABEL_ID}
          aria-describedby={privateKeyWarningDescribedBy(descriptor, true)}
          className="code-block"
        >
          <pre>{descriptor}</pre>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <CopyButton text={descriptor} label="Copy Signing File" />
        <button
          type="button"
          onClick={handleDownload}
          className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <Download className="size-4" aria-hidden="true" />
          Download as .txt
        </button>
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
