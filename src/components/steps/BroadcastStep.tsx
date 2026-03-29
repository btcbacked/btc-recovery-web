import { useEffect, useState } from 'react'
import { CircleCheck, ExternalLink, Radio, RefreshCw, RotateCcw, AlertTriangle, Info } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import type { Network } from '@/crypto'

type BroadcastStepProps = {
  txid: string | null
  isProcessing: boolean
  error: string | null
  network: Network
  onBroadcast: () => void
  onStartOver: () => void
}

const BROADCAST_MESSAGES = [
  'Broadcasting to the network...',
  'Waiting for relay confirmation...',
  'Verifying broadcast success...',
]

function getMempoolTxUrl(txid: string, network: Network): string {
  switch (network) {
    case 'mainnet':
      return `https://mempool.space/tx/${txid}`
    case 'testnet':
      return `https://mempool.space/testnet/tx/${txid}`
    case 'signet':
      return `https://mempool.space/signet/tx/${txid}`
    case 'regtest':
      return `http://localhost:8999/tx/${txid}`
  }
}

/**
 * Translate common Bitcoin node / mempool error strings into plain English.
 */
function translateBroadcastError(raw: string): string {
  const lower = raw.toLowerCase()

  if (lower.includes('txn-mempool-conflict') || lower.includes('mempool conflict')) {
    return 'This transaction conflicts with another transaction already in the mempool. The inputs may have already been spent.'
  }
  if (lower.includes('bad-txns-inputs-missingorspent') || lower.includes('missing or spent')) {
    return 'One or more inputs no longer exist or have already been spent. The funds may have moved.'
  }
  if (lower.includes('insufficient fee') || lower.includes('min relay fee not met')) {
    return 'The fee rate is too low for the current network conditions. Try increasing the fee rate and rebuilding the transaction.'
  }
  if (lower.includes('non-final') || lower.includes('non final')) {
    return 'The transaction is not yet final (it may have a future lock time). Wait until the specified block height or time has passed.'
  }
  if (lower.includes('dust') || lower.includes('tx-size')) {
    return 'The transaction output amount is too small (below the "dust" limit). Increase the send amount or use "send all".'
  }
  if (lower.includes('already known') || lower.includes('transaction already in block chain')) {
    return 'This transaction has already been broadcast and may be confirmed. Check the block explorer to verify.'
  }
  if (lower.includes('bad-txns-in-belowout')) {
    return 'The total output value exceeds the total input value. The transaction is invalid.'
  }
  if (lower.includes('scriptsig') || lower.includes('script failed') || lower.includes('non-mandatory')) {
    return 'A signature or script in this transaction is invalid. The transaction cannot be accepted.'
  }
  if (lower.includes('connection') || lower.includes('network') || lower.includes('fetch')) {
    return 'Could not connect to the broadcast endpoint. Check your internet connection or API endpoint and try again.'
  }

  return raw
}

export function BroadcastStep({
  txid,
  isProcessing,
  error,
  network,
  onBroadcast,
  onStartOver,
}: BroadcastStepProps) {
  const [messageIndex, setMessageIndex] = useState(0)
  const [messageKey, setMessageKey] = useState(0)

  useEffect(() => {
    if (!isProcessing) return
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % BROADCAST_MESSAGES.length)
      setMessageKey((prev) => prev + 1)
    }, 1800)
    return () => clearInterval(interval)
  }, [isProcessing])

  const explorerUrl = txid ? getMempoolTxUrl(txid, network) : null
  const friendlyError = error ? translateBroadcastError(error) : null

  // Idle state — waiting for user to confirm broadcast
  const isIdle = !txid && !isProcessing && !error

  return (
    <div className="space-y-6">
      {/* Idle state — user must click to broadcast */}
      {isIdle && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Radio className="size-7 text-primary" aria-hidden="true" />
            </div>
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Ready to Broadcast
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your transaction is fully signed and ready to be submitted to the Bitcoin network.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-warning/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-xs text-warning">
              <strong>Before broadcasting,</strong> check{' '}
              {network !== 'regtest' && (
                <a
                  href="https://mempool.space"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  mempool.space
                </a>
              )}{' '}
              {network === 'regtest' ? 'your local mempool' : ''} to confirm the inputs are still unspent.
              Broadcasting a transaction that conflicts with another one in the mempool will fail.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={onBroadcast}
              className="btn-primary inline-flex items-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
            >
              <Radio className="size-4" aria-hidden="true" />
              Broadcast Transaction
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
      )}

      {/* Broadcasting animation */}
      {isProcessing && (
        <div className="space-y-6 text-center" aria-busy="true" aria-label="Broadcasting transaction">
          <div className="deriving-ring-container mx-auto">
            <div className="deriving-ring-glow" aria-hidden="true" />
            <svg className="deriving-ring-svg" viewBox="0 0 72 72" aria-hidden="true">
              <defs>
                <linearGradient id="ring-gradient-broadcast" x1="0%" y1="0%" x2="100%" y2="100%">
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
                style={{ stroke: 'url(#ring-gradient-broadcast)' }}
              />
            </svg>
            <span className="deriving-ring-icon relative z-10 text-lg font-bold" aria-hidden="true">
              ₿
            </span>
          </div>

          <div>
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Broadcasting Transaction
            </h2>
            <p
              key={messageKey}
              className="animate-msg-fade mt-2 text-sm text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              {BROADCAST_MESSAGES[messageIndex]}
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {!isProcessing && error && (
        <div className="space-y-4">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-7 text-destructive" aria-hidden="true" />
            </div>
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Broadcast Failed
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The transaction could not be submitted to the network.
            </p>
          </div>

          <div className="rounded-[var(--radius-base)] border border-destructive/20 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{friendlyError}</p>
          </div>

          {/* Mempool check warning before retry */}
          <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-accent/50 px-4 py-3">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              Before retrying, check{' '}
              {network !== 'regtest' ? (
                <a
                  href="https://mempool.space"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  mempool.space
                </a>
              ) : (
                'your local mempool'
              )}{' '}
              to confirm the inputs are still unspent and no conflicting transaction is pending.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={onBroadcast}
              className="btn-primary inline-flex items-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry Broadcast
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
      )}

      {/* Success state */}
      {!isProcessing && !error && txid && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="animate-success-pop mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <CircleCheck className="size-7 text-success" aria-hidden="true" />
            </div>
            <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
              Transaction Broadcast
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your transaction has been submitted to the Bitcoin network.
            </p>
          </div>

          {/* TXID */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transaction ID
            </p>
            <div className="code-block">
              <pre className="break-all">{txid}</pre>
            </div>
            <div className="mt-2 flex justify-end">
              <CopyButton text={txid} label="Copy TXID" className="px-3 py-1.5 text-xs" />
            </div>
          </div>

          {/* View on mempool.space */}
          {explorerUrl && network !== 'regtest' && (
            <div className="text-center">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline inline-flex items-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                View on mempool.space
              </a>
            </div>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={onStartOver}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
