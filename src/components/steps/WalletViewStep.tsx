import { useEffect } from 'react'
import { ArrowLeft, Send, RefreshCw, AlertTriangle, HelpCircle } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { formatBtc, formatSats, truncateHash } from '@/lib/btcFormat'
import type { Utxo } from '@/crypto/blockchain-api'
import type { DerivedAddress } from '@/crypto/address'
import type { ParsedDescriptor } from '@/crypto/descriptor-parser'
import type { Network } from '@/crypto'

type WalletViewStepProps = {
  parsedDescriptor: ParsedDescriptor
  network: Network
  apiBaseUrl: string
  addresses: DerivedAddress[]
  utxos: Utxo[]
  balance: number
  isLoading: boolean
  error: string | null
  onLoadWallet: (parsed: ParsedDescriptor, network: Network, apiBase: string) => void
  onCreateTransaction: () => void
  onBack: () => void
}

export function WalletViewStep({
  parsedDescriptor,
  network,
  apiBaseUrl,
  addresses,
  utxos,
  balance,
  isLoading,
  error,
  onLoadWallet,
  onCreateTransaction,
  onBack,
}: WalletViewStepProps) {
  const escrowAddress = addresses[0]?.address ?? null

  useEffect(() => {
    onLoadWallet(parsedDescriptor, network, apiBaseUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Wallet Overview
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live balance and UTXOs fetched from the blockchain.
        </p>
      </div>

      {/* Escrow address */}
      {escrowAddress && (
        <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Escrow Address
          </p>
          <div className="flex items-center justify-between gap-3">
            <code className="flex-1 break-all font-mono text-xs text-foreground">
              {escrowAddress}
            </code>
            <CopyButton
              text={escrowAddress}
              label="Copy"
              className="shrink-0 px-3 py-1.5 text-xs"
            />
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col items-center gap-3 py-8" aria-busy="true">
          <div className="deriving-ring-container">
            <div className="deriving-ring-glow" aria-hidden="true" />
            <svg className="deriving-ring-svg" viewBox="0 0 72 72" aria-hidden="true">
              <defs>
                <linearGradient id="ring-gradient-wallet" x1="0%" y1="0%" x2="100%" y2="100%">
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
                style={{ stroke: 'url(#ring-gradient-wallet)' }}
              />
            </svg>
            <span className="deriving-ring-icon relative z-10 text-lg font-bold" aria-hidden="true">
              ₿
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Fetching wallet data...</p>
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="rounded-[var(--radius-base)] border border-destructive/20 bg-destructive/10 px-4 py-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-destructive">Failed to Load Wallet</p>
              <p className="text-xs text-destructive/80">{error}</p>
              <button
                type="button"
                onClick={() => onLoadWallet(parsedDescriptor, network, apiBaseUrl)}
                className="btn-outline inline-flex items-center gap-1.5 rounded-[var(--radius-base)] border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Balance display */}
      {!isLoading && !error && escrowAddress && (
        <>
          <div className="rounded-[var(--radius-base)] border border-border bg-accent/30 px-4 py-4 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total Balance
            </p>
            <p className="mt-1 text-3xl font-semibold text-foreground">
              {formatBtc(balance)}{' '}
              <span className="text-lg text-muted-foreground">BTC</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatSats(balance)} sats
            </p>
          </div>

          {/* Deposits / coins list */}
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Deposits ({utxos.length})
              </p>
              <span
                className="group relative cursor-help"
                title="Deposits are individual incoming Bitcoin payments that are available to spend. Each one is called a UTXO (unspent transaction output)."
                aria-label="What are Deposits?"
              >
                <HelpCircle className="size-3.5 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
              </span>
            </div>
            {utxos.length === 0 ? (
              <div className="rounded-[var(--radius-base)] border border-border px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">No deposits found.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This address has no funds or all coins have already been spent.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-[var(--radius-base)] border border-border">
                {utxos.map((utxo) => (
                  <div
                    key={`${utxo.txid}:${utxo.vout}`}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-foreground">
                        {truncateHash(utxo.txid, 10)}:{utxo.vout}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {utxo.status.confirmed ? 'Confirmed' : 'Unconfirmed — pending'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium text-foreground">
                        {formatBtc(utxo.value)} BTC
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatSats(utxo.value)} sats
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

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

        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={onCreateTransaction}
            disabled={isLoading || balance === 0}
            className="btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:bg-[var(--button-primary-disabled-bg)] disabled:text-[var(--button-primary-disabled-fg)] disabled:opacity-100 disabled:shadow-none"
          >
            <Send className="size-4" aria-hidden="true" />
            Create Transaction
          </button>
          {!isLoading && balance === 0 && (
            <p className="text-right text-xs text-muted-foreground">
              No spendable balance — send Bitcoin to your escrow address first.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
