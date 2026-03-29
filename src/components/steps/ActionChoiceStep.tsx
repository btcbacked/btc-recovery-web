import { Send, FileInput, ExternalLink, ArrowLeft } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { truncateHash } from '@/lib/btcFormat'

type ActionChoiceStepProps = {
  escrowAddress: string
  network: string
  customEndpoint: string
  needsCustomEndpoint: boolean
  onCustomEndpointChange: (value: string) => void
  onCreateTransaction: () => void
  onSignExisting: () => void
  onImportWallet: () => void
  onBack: () => void
}

export function ActionChoiceStep({
  escrowAddress,
  network,
  customEndpoint,
  needsCustomEndpoint,
  onCustomEndpointChange,
  onCreateTransaction,
  onSignExisting,
  onImportWallet,
  onBack,
}: ActionChoiceStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Key Recovered Successfully
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose how you would like to proceed with your recovered signing key.
        </p>
      </div>

      {/* Escrow address preview */}
      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Escrow Address ({network})
        </p>
        <div className="flex items-center justify-between gap-3">
          <code className="flex-1 truncate font-mono text-xs text-foreground">
            {truncateHash(escrowAddress, 12)}
          </code>
          <CopyButton
            text={escrowAddress}
            label="Copy"
            className="shrink-0 px-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* Regtest custom endpoint */}
      {needsCustomEndpoint && (
        <div className="space-y-1.5">
          <label
            htmlFor="custom-endpoint"
            className="text-xs font-medium text-muted-foreground"
          >
            Mempool API Endpoint (regtest)
          </label>
          <input
            id="custom-endpoint"
            type="url"
            value={customEndpoint}
            onChange={(e) => onCustomEndpointChange(e.target.value)}
            placeholder="http://localhost:8999/api"
            className="input-premium w-full rounded-[var(--radius-base)] border border-border bg-[var(--input-bg)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <p className="text-xs text-muted-foreground">
            Required for regtest — point to your local mempool instance.
          </p>
        </div>
      )}

      {/* Action choices */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onCreateTransaction}
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-3 text-sm font-medium text-primary-foreground"
          >
            <Send className="size-4" aria-hidden="true" />
            Create Transaction
          </button>
          <p className="px-1 text-xs text-muted-foreground">
            Build a new Bitcoin transaction from your escrow address, add your signature, and export the file for the other signer to co-sign.
          </p>
        </div>

        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onSignExisting}
            className="btn-outline flex w-full items-center justify-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-3 text-sm font-medium text-foreground hover:bg-accent"
          >
            <FileInput className="size-4" aria-hidden="true" />
            Sign Existing PSBT
          </button>
          <p className="px-1 text-xs text-muted-foreground">
            Import a PSBT (a transaction file that needs signatures from multiple parties) that another signer has already started, and add your signature so it can be broadcast.
          </p>
        </div>

        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={onImportWallet}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            Import into External Wallet Instead
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            Export your descriptor to a wallet app like Sparrow or Specter.
          </p>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Your private key is held in memory only and will be cleared when you close this tab.
      </p>

      {/* Back button */}
      <div className="flex justify-start">
        <button
          type="button"
          onClick={onBack}
          className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
      </div>
    </div>
  )
}
