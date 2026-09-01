import { useEffect } from 'react'
import { Send, FileInput, ExternalLink, ArrowLeft } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { formatBtc } from '@/lib/btcFormat'

type ActionChoiceStepProps = {
  escrowAddress: string
  network: string
  customEndpoint: string
  needsCustomEndpoint: boolean
  balance: number
  isLoadingBalance: boolean
  balanceError: string | null
  /**
   * Whether a balance fetch has actually COMPLETED for the endpoint currently
   * in use. False at mount, before the debounced fetch below has even started,
   * and false again on regtest from the moment the endpoint changes until the
   * fetch for the new one returns.
   *
   * Without it `balance`, `isLoadingBalance` and `balanceError` sit at 0, false
   * and null in two different situations: an escrow that is genuinely empty,
   * and an escrow nobody has asked about yet. This screen reports those
   * differently and cannot otherwise tell them apart.
   */
  balanceChecked: boolean
  /**
   * Fetches the escrow balance. Its identity changes whenever the endpoint
   * changes, which is what the debounce below is built on. See the effect.
   */
  onLoadBalance: () => void
  onCustomEndpointChange: (value: string) => void
  onCreateTransaction: () => void
  onSignExisting: () => void
  onImportWallet: () => void
  onBack: () => void
}

/**
 * Long enough to swallow a burst of typing in the endpoint field, short enough
 * that nobody waits for it. Only regtest shows that field at all, so on every
 * other network this is a single delayed fetch on mount and nothing more.
 */
const ENDPOINT_SETTLE_MS = 400

export function ActionChoiceStep({
  escrowAddress,
  network,
  customEndpoint,
  needsCustomEndpoint,
  balance,
  isLoadingBalance,
  balanceError,
  balanceChecked,
  onLoadBalance,
  onCustomEndpointChange,
  onCreateTransaction,
  onSignExisting,
  onImportWallet,
  onBack,
}: ActionChoiceStepProps) {
  /**
   * Regtest, before the customer has given us anything to ask.
   *
   * NOT `apiBaseUrl === ''`, which never happens: `useNetworkConfig` falls back
   * to `getMempoolApiBase(network)` and regtest returns a localhost default. So
   * an endpoint always exists, and on regtest it is a guess until the customer
   * types their own.
   *
   * This is why the fetch below is withheld, and it is regtest only. What the
   * BALANCE is allowed to say is `balanceChecked`, which is the same question
   * asked on every network.
   */
  const endpointMissing = needsCustomEndpoint && customEndpoint === ''

  // No address means the escrow could not be derived from the file at all. The
  // address block below is already absent in that case, and the balance goes
  // with it: there is nothing to fetch a balance FOR, and asking anyway makes
  // the derivation throw again.
  const canCheckBalance = escrowAddress !== '' && !endpointMissing

  useEffect(() => {
    if (!canCheckBalance) return
    /*
     * Debounced, and the debounce is the whole reason this is not a plain
     * `useEffect(() => onLoadBalance(), [onLoadBalance])`.
     *
     * `onLoadBalance` is rebuilt whenever the API base URL changes, and on
     * regtest that URL is the input field a few lines below THIS component.
     * Firing on every identity change means one fetch per keystroke: typing
     * `http://localhost:8999/api` is about 25 requests to half formed URLs, and
     * every one of them fails. The changing identity is turned into the
     * debounce trigger instead, so only the last endpoint in a burst is used.
     */
    const timer = setTimeout(onLoadBalance, ENDPOINT_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [canCheckBalance, onLoadBalance])

  /*
   * Four states, and the customer is told which one they are in.
   *
   * "Unknown" covers both not-yet-asked and asked-and-failed. Neither is a zero
   * balance and neither may be shown as one: this is the screen where somebody
   * finds out whether their money is still there, and "0.00000000 BTC" to a
   * customer whose endpoint is simply not reachable is the worst possible lie
   * this tool could tell. A failure is deliberately NOT an error box here: the
   * full failure, with its Retry, lives on the screen behind Create
   * Transaction, and an orange box strobing under a half typed URL would be
   * the opposite of what this screen is for.
   *
   * `balanceChecked` is what makes not-yet-asked real. `endpointMissing` cannot
   * carry it: it is false on mainnet, testnet and signet by definition, so on
   * every network a customer actually uses, the mount state used to fall
   * through to the zero branch and this screen told exactly that lie for the
   * length of the debounce, in a live region a screen reader may announce.
   */
  const balanceText = (() => {
    if (isLoadingBalance) return 'Checking the balance...'
    if (!balanceChecked || endpointMissing || balanceError !== null) return 'Unknown'
    return `${formatBtc(balance)} BTC`
  })()

  const escrowIsEmpty =
    balanceChecked &&
    !isLoadingBalance &&
    !endpointMissing &&
    balanceError === null &&
    balance === 0

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

      {/* Escrow address preview. Absent when no address could be derived: an
          empty box with a Copy button that copies nothing reads as an address
          that happens to be short, which is worse than showing none. */}
      {escrowAddress !== '' && (
        <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Escrow Address ({network})
          </p>
          {/* The full address, wrapped. It used to go through
              truncateHash(escrowAddress, 12) AND carry Tailwind's `truncate`,
              so the shortened string was then clipped again by CSS, and the
              ellipsis CSS adds sat next to the helper's own three dots in the
              same font with nothing to tell the two apart. A customer checking
              where their money is has to be able to read the whole thing. */}
          <div className="flex items-start justify-between gap-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
              {escrowAddress}
            </code>
            <CopyButton
              text={escrowAddress}
              variant="icon"
              ariaLabel="Copy escrow address"
            />
          </div>

          {/* The balance, as a second line in the box that already names the
              escrow, not as a panel of its own.

              It belongs on THIS screen because "is my money still there" is the
              first question anyone opening this tool has, and until now the
              answer sat one screen further in, behind a button called Create
              Transaction that sounds irreversible.

              It is one line rather than the `EscrowSummary` panel because this
              screen's job is to present three choices. That panel is about
              200px of second address box and 3xl balance, which pushes two of
              the three below the fold on a laptop, and it renders its own
              address and its own derivation notice, both of which already exist
              here and above. Twenty pixels, in the box that is already here. */}
          {/* A live region, because this number arrives after the screen
              does. Without it the balance simply appears and a screen reader
              user is never told.

              The region is this whole row, not the value alone. `role="status"`
              announces its entire contents, so wrapping only the number read
              out "Unknown" or "0.05000000 BTC" with nothing saying what the
              number was OF. The label is the sighted reader's answer to that
              and it is already here, so it is brought inside the region rather
              than duplicated into an aria-label that could drift from it.
              Nothing about the visible row changes. */}
          <div
            className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5"
            role="status"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Escrow Balance
            </p>
            <p className="text-right font-mono text-xs text-foreground">
              {balanceText}
              {escrowIsEmpty && (
                <span className="mt-0.5 block font-sans text-muted-foreground">
                  No spendable balance.
                </span>
              )}
            </p>
          </div>
        </div>
      )}

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
            Required for regtest. Point to your local mempool instance.
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
            Export Your Signing File Instead
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            Export your signing file to a wallet app like Sparrow or Specter.
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
