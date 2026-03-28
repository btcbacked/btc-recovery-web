import { NetworkBadge } from '@/components/NetworkBadge'
import type { RecoveryFile } from '@/crypto'

type FileInfoStepProps = {
  file: RecoveryFile
  onConfirm: () => void
  onBack: () => void
}

export function FileInfoStep({ file, onConfirm, onBack }: FileInfoStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Recovery File Details
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Please verify that the information below matches your contract.
        </p>
      </div>

      <div
        className="rounded-[var(--radius-surface)] border border-border bg-card p-5"
        style={{ boxShadow: 'var(--auth-card-glow)' }}
      >
        <div className="space-y-4">
          <InfoRow label="Network">
            <NetworkBadge network={file.network} />
          </InfoRow>
          <InfoRow label="Contract ID">
            <span className="font-mono text-xs">{file.context.contractId}</span>
          </InfoRow>
          <InfoRow label="Your Role">
            <span className="capitalize">{file.context.role}</span>
          </InfoRow>
          <InfoRow label="Multisig">
            {file.context.threshold}-of-{file.context.totalKeys}
          </InfoRow>
          <InfoRow label="Key Type">
            {file.userKey.keySource === 'PASSWORD' ? 'Password-derived' : 'Hardware Wallet (ColdCard)'}
          </InfoRow>
          <InfoRow label="Fingerprint">
            <span className="font-mono text-xs">{file.userKey.fingerprint}</span>
          </InfoRow>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onConfirm}
          className="btn-primary w-full rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Confirm and Continue
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Upload a different file
        </button>
      </div>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{children}</span>
    </div>
  )
}
