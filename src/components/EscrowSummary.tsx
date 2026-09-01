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
   * False when the escrow does not use the plain ranged address layout, which
   * is the one thing this component says anything about.
   *
   * The address below is correct either way. What changes is that other wallet
   * software may disagree with it, so the user is told which one to believe.
   * There is no matching line on the true branch: the paragraph THIS COMPONENT
   * used to carry, telling a customer not to send Bitcoin and to ask support if
   * the numbers differ, was removed. It was wrong twice over here. It told a
   * customer not to send Bitcoin in a tool whose whole purpose is moving
   * Bitcoin out, and it named a support desk in the one tool that exists for
   * when there is no support desk to name.
   *
   * The compare-and-ask-support instruction itself is NOT gone from the tool.
   * `WalletGuideStep` still carries it on its own true branch, where it belongs:
   * that screen is walking the customer through an import into another wallet,
   * so a difference there is a botched import and not a fact about the escrow.
   */
  isStandardDerivation: boolean
  onLoad: () => void
}

/**
 * The escrow's address, balance and deposit count. Shown wherever we hand the
 * user a descriptor, so that a wallet which quietly builds a different wallet
 * becomes a visible mismatch rather than a silent zero balance.
 *
 * It shows those three facts and says nothing else about them. This component
 * does not instruct the reader to compare them anywhere and names nobody to
 * contact if they differ; `WalletGuideStep` still does both, on the screen that
 * is walking them through an import. See `isStandardDerivation` for what this
 * component dropped and why.
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
        <div className="flex items-start justify-between gap-3">
          <code className="flex-1 break-all font-mono text-xs text-foreground">{address}</code>
          <CopyButton text={address} variant="icon" ariaLabel="Copy escrow address" />
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
    </div>
  )
}
