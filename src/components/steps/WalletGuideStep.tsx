import { useState } from 'react'
import { CopyButton } from '@/components/CopyButton'
import { EscrowSummary } from '@/components/EscrowSummary'
import {
  PrivateKeyWarning,
  privateKeyWarningDescribedBy,
} from '@/components/PrivateKeyWarning'
import { isPasswordKeySource } from '@/crypto'
import { cn } from '@/lib/utils'

/** Names the key block for assistive technology. Reuses the visible label. */
const LABEL_ID = 'wallet-guide-file-label'

type WalletGuideStepProps = {
  /** The signing or escrow file the user pastes into other software. */
  descriptor: string
  /**
   * `userKey.keySource` straight off the recovery file, unread and
   * uninterpreted. This is the fact that decides what the string on this screen
   * IS, and it is the same field the wizard routes the customer on, so the name
   * this screen prints cannot disagree with the path they walked to reach it.
   */
  keySource: string
  escrowAddress: string
  balance: number
  depositCount: number
  isLoadingBalance: boolean
  balanceError: string | null
  isStandardDerivation: boolean
  /**
   * True when no escrow address could be worked out from the recovery file.
   *
   * Separate from `isStandardDerivation`, which stays true on a refusal because
   * nothing was read to make it false. Without this the screen contradicts
   * itself: the wizard's own notice says this page cannot open the escrow and
   * will not show an address, and the line below it says to come back here and
   * move the Bitcoin.
   */
  cannotDeriveEscrow: boolean
  onLoadBalance: () => void
  onReset: () => void
  onBackToDescriptor?: () => void
}

const tabs = ['Sparrow', 'Specter', 'Bitcoin Core'] as const
type Tab = (typeof tabs)[number]

/*
 * The last child index the Bitcoin Core steps scan and print. One fact, not
 * two: `importdescriptors` decides how far the node scans and `deriveaddresses`
 * decides what the customer compares against, so the two must not drift apart.
 *
 * A bound above 0 is the whole point. The descriptor handed out is ranged on
 * every leg, and each loan sits at its own child index under one shared
 * account, so a customer's second loan is at index 1 and their third at index
 * 2. Printing index 0 alone told every customer past their first loan that
 * their address did not match, on a screen that says a mismatch means stop and
 * move no Bitcoin.
 */
const ADDRESS_SCAN_END = 100

// Stable IDs for aria-controls / aria-labelledby
const tabId = (tab: Tab) => `wallet-tab-${tab.replace(/\s+/g, '-').toLowerCase()}`
const panelId = (tab: Tab) => `wallet-panel-${tab.replace(/\s+/g, '-').toLowerCase()}`

export function WalletGuideStep({
  descriptor,
  keySource,
  escrowAddress,
  balance,
  depositCount,
  isLoadingBalance,
  balanceError,
  isStandardDerivation,
  cannotDeriveEscrow,
  onLoadBalance,
  onReset,
  onBackToDescriptor,
}: WalletGuideStepProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Sparrow')

  /*
   * What this screen CLAIMS comes from the recovery file. What this screen
   * WARNS about comes from reading the string. Those are different questions
   * and they need different sources of truth.
   *
   * A claim is a statement of fact to the customer: what the thing they are
   * holding is called, and whether their wallet can sign with it. Being wrong
   * costs trust and, on the device path, contradicts the one promise that
   * matters most to them, which is that their key never left the device. So a
   * claim is only made from something known: `keySource` is recorded in the
   * file, is the same field the wizard routed them on, and cannot be null,
   * truncated or coincidental.
   *
   * A warning is a guess that has to be safe when wrong, so it reads the string
   * itself and errs toward showing. That work lives in `PrivateKeyWarning` and
   * deliberately does not appear here.
   *
   * The two can disagree, and neither is broken when they do. A pattern that
   * fires on a device path descriptor shows a warning nobody needed while this
   * screen still correctly says "escrow file", because the file says the key is
   * on a device and no string ever outvotes that.
   *
   * This also replaces the original defect properly. Both claims were computed
   * from `parsedDescriptor`, which is null exactly when the descriptor failed
   * to parse, so on the one screen a frightened customer reaches they were told
   * to connect a hardware wallet they have never owned. `keySource` is present
   * whether or not anything parsed.
   */
  const isPasswordPath = isPasswordKeySource(keySource)

  /*
   * One screen, two objects, and until now one name covering both.
   *
   * A password customer's string carries their private key in plain text: that
   * is a signing file. A hardware customer's string carries public keys only:
   * that is an escrow file. Calling both of them "the wallet configuration"
   * collapsed the one distinction that decides whether the text on this page
   * can spend their Bitcoin, and it did so on the only screen that prints that
   * text in full.
   *
   * This reads the same fact the Sparrow signing step reads, so the name of the
   * object and the instructions for using it cannot drift apart: a screen
   * cannot say "escrow file" and then tell them their wallet will sign.
   *
   * Third party labels are deliberately not renamed below. Sparrow's Descriptor
   * box, Specter's "import from a descriptor" and Bitcoin Core's
   * `importdescriptors` are what those apps put on screen, and a customer
   * hunting for a control has to be told the word they will actually see.
   */
  const fileName = isPasswordPath ? 'signing file' : 'escrow file'
  /* `fileName` starts with a vowel on one branch and a consonant on the other,
   * so any sentence that puts an indefinite article in front of it has to pick
   * the article from the same condition. Hard coding "a" rendered "a escrow
   * file" for every hardware customer. Every sentence below now says "the",
   * which is why no article helper survives here. Bring one back with the
   * sentence that needs it, never without it. */
  const fileNameTitle = isPasswordPath ? 'Signing File' : 'Escrow File'

  /*
   * What to do when the imported wallet disagrees with the address or balance
   * above. Three cases, not two, and getting it wrong is not a detail.
   *
   * Ordinary escrow: a difference means something is wrong, so say so.
   *
   * Pinned escrow: the notice on this same screen tells the customer to EXPECT
   * a difference, so telling them in the next breath that a difference means
   * stop and call support contradicts it, and does so while they are already
   * frightened. They need the wording that says nothing is wrong and points
   * them back here.
   *
   * No address at all: there is nothing above to compare against, and pointing
   * them back to a page that has just said it cannot open this escrow is the
   * worst of the three. Say nothing.
   *
   * Emptying this line is not on its own enough, and that was the defect. Every
   * tab's "check it worked" step is written around an address and a balance
   * "shown above", and on a refusal there is neither: the intro on this same
   * screen says so three lines earlier. Each of those steps is therefore
   * three way at its own site too, and sends the customer to what their wallet
   * shows instead of to a comparison they cannot make.
   */
  const mismatchAdvice = (() => {
    if (cannotDeriveEscrow) return ''
    if (isStandardDerivation) return 'If either differs, stop and contact BTCBacked support.'
    return 'If either differs, this wallet cannot open your escrow. Nothing is wrong with your funds. Close it and move your Bitcoin from this page instead.'
  })()

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Open Your Wallet in Other Software
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {cannotDeriveEscrow
            ? 'Follow the steps for the software you have. This page could not work out your escrow address, so there is no address or balance here for you to compare against.'
            : 'Below is the address and balance your wallet must show. Follow the steps for the software you have, then check that the numbers match before you move anything.'}
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

      <PrivateKeyWarning text={descriptor} />

      {/* The file itself, so the user does not have to leave this page */}
      <div>
        <p
          id={LABEL_ID}
          className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {fileNameTitle}
        </p>
        {/* This screen prints either file, so the description resolves only on
            the one that carries the key. Same gate as the warning above. */}
        <div
          role="group"
          aria-labelledby={LABEL_ID}
          aria-describedby={privateKeyWarningDescribedBy(descriptor)}
          className="code-block"
        >
          <pre>{descriptor}</pre>
        </div>
        <div className="mt-2 flex justify-center">
          <CopyButton text={descriptor} label={`Copy ${fileNameTitle}`} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Copy all of it, including the hash sign near the end and the eight characters after
          it. Wallets reject it or build the wrong wallet if any part is missing.
        </p>
      </div>

      {/* Premium underline tab bar — borderless, indicator-only active state */}
      <div role="tablist" aria-label="Wallet software" className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab}
            id={tabId(tab)}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            aria-controls={panelId(tab)}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'wallet-tab-underline flex-1 px-3 py-2.5 text-xs font-medium transition-colors',
              activeTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="rounded-[var(--radius-surface)] border border-border bg-card p-5">
        <div
          id={panelId('Sparrow')}
          role="tabpanel"
          aria-labelledby={tabId('Sparrow')}
          hidden={activeTab !== 'Sparrow'}
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Sparrow is the easiest option for most people. It runs on Windows, macOS and Linux.
            It does not run on a phone, so you need a computer for this. Nunchuk is the usual
            choice on a phone, but it expects a different file format than the one on this
            page, so please use a computer if you possibly can.
          </p>
          <ol className="step-list space-y-3">
            <li className="step-list-item text-sm text-foreground">
              Open Sparrow and choose <strong>File</strong>, then <strong>New Wallet</strong>.
              Give it any name you like.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Open the <strong>Settings</strong> tab.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Set <strong>Policy Type</strong> to <strong>Multi Signature</strong>.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Paste the {fileName} into the box Sparrow labels{' '}
              <strong>Descriptor</strong>, then choose <strong>Apply</strong>.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Sparrow fills in each signer for you. Check that it says the same number of
              signatures as your contract, and that your fingerprint is listed.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Open the <strong>Transactions</strong> tab and wait for it to finish loading.
            </li>
            <li className="step-list-item font-medium text-sm text-foreground">
              {cannotDeriveEscrow ? (
                <>
                  Check what Sparrow shows. This page has no address and no balance for you to
                  compare against, so read both from Sparrow itself. The{' '}
                  <strong>Addresses</strong> tab shows the receive addresses, and the{' '}
                  <strong>Transactions</strong> tab shows the balance.
                </>
              ) : (
                <>
                  Check it worked. The balance must match the balance shown above, and the escrow
                  address shown above must appear in the <strong>Addresses</strong> tab.{' '}
                  {mismatchAdvice}
                </>
              )}
            </li>
            <li className="step-list-item text-sm text-foreground">
              To move funds, use the <strong>Send</strong> tab.{' '}
              {isPasswordPath
                ? 'Sparrow already holds your signing key and will sign for you.'
                : 'Connect your hardware wallet when Sparrow asks for a signature, and approve it on the device.'}
            </li>
          </ol>
        </div>

        <div
          id={panelId('Specter')}
          role="tabpanel"
          aria-labelledby={tabId('Specter')}
          hidden={activeTab !== 'Specter'}
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Specter Desktop needs its own Bitcoin Core node running. If you do not have one,
            use Sparrow instead.
          </p>
          <ol className="step-list space-y-3">
            <li className="step-list-item text-sm text-foreground">
              Open Specter Desktop and choose <strong>Add new wallet</strong>.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Choose the option Specter labels <strong>import from a descriptor</strong>,
              paste the {fileName}, and choose <strong>Import</strong>.
            </li>
            <li className="step-list-item text-sm text-foreground">
              If Specter refuses it with a message saying it cannot handle the way this
              wallet is set up, it cannot open this wallet. Use Sparrow or Bitcoin Core
              instead. Nothing is wrong with your funds.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Check the signers it lists and confirm.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Wait for Specter to scan the blockchain. This can take a while.
            </li>
            <li className="step-list-item font-medium text-sm text-foreground">
              {cannotDeriveEscrow
                ? 'Check what Specter shows. This page has no address and no balance for you to compare against, so read both from Specter itself.'
                : `Check it worked. The balance must match the balance shown above, and the escrow address must appear in the wallet's address list. ${mismatchAdvice}`}
            </li>
          </ol>
        </div>

        <div
          id={panelId('Bitcoin Core')}
          role="tabpanel"
          aria-labelledby={tabId('Bitcoin Core')}
          hidden={activeTab !== 'Bitcoin Core'}
        >
          <div className="mb-4 rounded-[var(--radius-base)] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-text">
            <strong>Advanced users only.</strong> This needs a fully synced Bitcoin Core node
            and the console. If that is not familiar, use Sparrow instead. Bitcoin Core is the
            only one of these that always honours the {fileName} exactly as written.
          </div>
          <ol className="step-list space-y-3">
            <li className="step-list-item text-sm text-foreground">
              Open Bitcoin Core and go to <strong>Window</strong>, then{' '}
              <strong>Console</strong>.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Create an empty wallet:
              <code className="mt-1 block break-all rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
                createwallet "btcbacked-recovery" false true
              </code>
            </li>
            <li className="step-list-item text-sm text-foreground">
              Load the {fileName}, replacing PASTE_HERE with the text you copied above:
              <code className="mt-1 block break-all rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
                {`importdescriptors '[{"desc":"PASTE_HERE","timestamp":0,"range":[0,${ADDRESS_SCAN_END}]}]'`}
              </code>
            </li>
            <li className="step-list-item text-sm text-foreground">
              Wait for the scan to finish. Run{' '}
              <code className="rounded bg-accent px-1 text-xs font-mono">getwalletinfo</code> and
              wait until scanning shows as false.
            </li>
            <li className="step-list-item font-medium text-sm text-foreground">
              {cannotDeriveEscrow
                ? `Check what Bitcoin Core shows. This page has no address and no balance for you to compare against, so read both from Bitcoin Core itself. This prints addresses 0 to ${ADDRESS_SCAN_END}:`
                : `Check it worked. This prints addresses 0 to ${ADDRESS_SCAN_END}, and the escrow address shown above must appear among them:`}
              <code className="mt-1 block break-all rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
                {`deriveaddresses "PASTE_HERE" [0,${ADDRESS_SCAN_END}]`}
              </code>
              Then run{' '}
              <code className="rounded bg-accent px-1 text-xs font-mono">getbalance</code>
              {cannotDeriveEscrow
                ? ' for the balance.'
                : ` and check it matches the balance above. ${mismatchAdvice}`}
            </li>
          </ol>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {onBackToDescriptor && (
          <button
            type="button"
            onClick={onBackToDescriptor}
            className="btn-outline w-full rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            Back to {fileNameTitle}
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="btn-outline w-full rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Start Over
        </button>
      </div>
    </div>
  )
}
