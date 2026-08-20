import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { DerivationNotice } from '@/components/DerivationNotice'
import { formatBtc, formatSats } from '@/lib/btcFormat'

type EscrowSummaryProps = {
  address: string
  balance: number
  depositCount: number
  isLoading: boolean
  error: string | null
  /**
   * False when the escrow does not use the plain ranged address layout. The
   * address below is still correct; what changes is that other wallet software
   * may disagree with it, so the user is told which one to believe.
   */
  isStandardDerivation: boolean
  onLoad: () => void
}

/**
 * The address and balance the user must see in whichever wallet they import
 * into. Shown wherever we hand the user a descriptor, so that a wallet which
 * quietly builds a different wallet becomes an obvious mismatch instead of a
 * silent zero balance.
 *
 * Loads its own data on mount through the callback it is given.
 */
export function EscrowSummary({
  address,
  balance,
  depositCount,
  isLoading,
  error,
  isStandardDerivation,
  onLoad,
}: EscrowSummaryProps) {
  useEffect(() => {
    onLoad()
  }, [onLoad])

  return (
    <div className="space-y-3">
      {!isStandardDerivation && <DerivationNotice />}

      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Escrow Address
        </p>
        <div className="flex items-center justify-between gap-3">
          <code className="flex-1 break-all font-mono text-xs text-foreground">{address}</code>
          <CopyButton text={address} label="Copy" className="shrink-0 px-3 py-1.5 text-xs" />
        </div>
      </div>

      {isLoading && (
        <p className="text-center text-sm text-muted-foreground" aria-busy="true">
          Checking the balance...
        </p>
      )}

      {!isLoading && error && (
        <div className="rounded-[var(--radius-base)] border border-warning/30 bg-warning/10 px-4 py-3">
          <p className="text-xs text-warning-text">
            The balance could not be loaded: {error} The address above is still correct.
          </p>
          <button
            type="button"
            onClick={onLoad}
            className="btn-outline mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-base)] border border-warning/30 px-3 py-1.5 text-xs font-medium text-warning-text hover:bg-warning/10"
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {!isLoading && !error && (
        <div className="rounded-[var(--radius-base)] border border-border bg-accent/30 px-4 py-4 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total Balance
          </p>
          <p className="mt-1 text-3xl font-semibold text-foreground">
            {formatBtc(balance)} <span className="text-lg text-muted-foreground">BTC</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatSats(balance)} sats</p>
          <p className="mt-1 text-xs text-muted-foreground">Deposits ({depositCount})</p>
        </div>
      )}

      {isStandardDerivation && (
        <p className="text-xs text-muted-foreground">
          Write these down. Any wallet you import into must show this exact address and this
          exact balance. If it shows anything else, the import went wrong. Do not send any
          Bitcoin and contact BTCBacked support.
        </p>
      )}
    </div>
  )
}
