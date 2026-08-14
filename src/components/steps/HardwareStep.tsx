import { Cpu, Download } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { EscrowSummary } from '@/components/EscrowSummary'
import { describeKeySource } from '@/crypto'
import type { RecoveryFile } from '@/crypto'

type HardwareStepProps = {
  file: RecoveryFile
  /** Descriptor to hand to the user, with a valid checksum attached. */
  descriptor: string
  escrowAddress: string
  balance: number
  depositCount: number
  isLoadingBalance: boolean
  balanceError: string | null
  isStandardDerivation: boolean
  onLoadBalance: () => void
  onContinue: () => void
  onBack: () => void
}

export function HardwareStep({
  file,
  descriptor,
  escrowAddress,
  balance,
  depositCount,
  isLoadingBalance,
  balanceError,
  isStandardDerivation,
  onLoadBalance,
  onContinue,
  onBack,
}: HardwareStepProps) {
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
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-info/10">
          <Cpu className="size-7 text-info" aria-hidden="true" />
        </div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Hardware Wallet Key
        </h2>
        <p className="mt-1 text-sm font-medium text-foreground">
          {describeKeySource(file.userKey.keySource)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          There is no password to enter, because your private key stays on the device and
          never reaches this browser. Copy the wallet configuration below into your wallet
          app, then approve payments on your device.
        </p>
      </div>

      {escrowAddress && (
        <EscrowSummary
          address={escrowAddress}
          balance={balance}
          depositCount={depositCount}
          isLoading={isLoadingBalance}
          error={balanceError}
          isStandardDerivation={isStandardDerivation}
          onLoad={onLoadBalance}
        />
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Wallet Configuration (Output Descriptor)
        </p>
        <div className="code-block">
          <pre>{descriptor}</pre>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <CopyButton text={descriptor} label="Copy Descriptor" />
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
