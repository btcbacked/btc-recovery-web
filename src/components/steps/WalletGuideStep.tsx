import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { EscrowSummary } from '@/components/EscrowSummary'
import { cn } from '@/lib/utils'

type WalletGuideStepProps = {
  /** The wallet configuration the user pastes into other software. */
  descriptor: string
  /** True when the configuration carries the user's signing key in the clear. */
  descriptorHasPrivateKey: boolean
  escrowAddress: string
  balance: number
  depositCount: number
  isLoadingBalance: boolean
  balanceError: string | null
  isStandardDerivation: boolean
  onLoadBalance: () => void
  onReset: () => void
  onBackToDescriptor?: () => void
}

const tabs = ['Sparrow', 'Specter', 'Bitcoin Core'] as const
type Tab = (typeof tabs)[number]

// Stable IDs for aria-controls / aria-labelledby
const tabId = (tab: Tab) => `wallet-tab-${tab.replace(/\s+/g, '-').toLowerCase()}`
const panelId = (tab: Tab) => `wallet-panel-${tab.replace(/\s+/g, '-').toLowerCase()}`

export function WalletGuideStep({
  descriptor,
  descriptorHasPrivateKey,
  escrowAddress,
  balance,
  depositCount,
  isLoadingBalance,
  balanceError,
  isStandardDerivation,
  onLoadBalance,
  onReset,
  onBackToDescriptor,
}: WalletGuideStepProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Sparrow')

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Open Your Wallet in Other Software
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Below is the address and balance your wallet must show. Follow the steps for the
          software you have, then check that the numbers match before you move anything.
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

      {/* The configuration itself, so the user does not have to leave this page */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Wallet Configuration
        </p>
        <div className="code-block">
          <pre>{descriptor}</pre>
        </div>
        <div className="mt-2 flex justify-center">
          <CopyButton text={descriptor} label="Copy Configuration" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Copy all of it, including the hash sign near the end and the eight characters after
          it. Wallets reject it or build the wrong wallet if any part is missing.
        </p>
      </div>

      {descriptorHasPrivateKey && (
        <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-warning/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-xs text-warning-text">
            <strong>Keep this secret.</strong> This configuration contains your signing key in
            plain text. Anyone who gets it can spend your Bitcoin.
          </p>
        </div>
      )}

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
              Paste the configuration into the <strong>Descriptor</strong> box and choose{' '}
              <strong>Apply</strong>.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Sparrow fills in each signer for you. Check that it says the same number of
              signatures as your contract, and that your fingerprint is listed.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Open the <strong>Transactions</strong> tab and wait for it to finish loading.
            </li>
            <li className="step-list-item font-medium text-sm text-foreground">
              Check it worked. The balance must match the balance shown above. Then open the{' '}
              <strong>Addresses</strong> tab and confirm the first receive address is the
              escrow address shown above. Sparrow can accept a configuration and quietly build
              a different wallet, and it will not warn you. If either differs, stop and contact
              BTCBacked support.
            </li>
            <li className="step-list-item text-sm text-foreground">
              To move funds, use the <strong>Send</strong> tab.{' '}
              {descriptorHasPrivateKey
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
              Choose the option to import from a descriptor, paste the configuration, and
              choose <strong>Import</strong>.
            </li>
            <li className="step-list-item text-sm text-foreground">
              If Specter refuses it with a message about the derivation not being supported,
              it cannot open this wallet. Use Sparrow or Bitcoin Core instead. Nothing is
              wrong with your funds.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Check the signers it lists and confirm.
            </li>
            <li className="step-list-item text-sm text-foreground">
              Wait for Specter to scan the blockchain. This can take a while.
            </li>
            <li className="step-list-item font-medium text-sm text-foreground">
              Check it worked. The balance must match the balance shown above, and the escrow
              address must appear in the wallet's address list. If either differs, stop and
              contact BTCBacked support.
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
            only one of these that always honours the configuration exactly as written.
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
              Load the configuration, replacing PASTE_HERE with the text you copied above:
              <code className="mt-1 block break-all rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
                {'importdescriptors \'[{"desc":"PASTE_HERE","timestamp":0,"range":[0,100]}]\''}
              </code>
            </li>
            <li className="step-list-item text-sm text-foreground">
              Wait for the scan to finish. Run{' '}
              <code className="rounded bg-accent px-1 text-xs font-mono">getwalletinfo</code> and
              wait until scanning shows as false.
            </li>
            <li className="step-list-item font-medium text-sm text-foreground">
              Check it worked. This must print the same address as the one shown above:
              <code className="mt-1 block break-all rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
                {'deriveaddresses "PASTE_HERE" [0,0]'}
              </code>
              Then run{' '}
              <code className="rounded bg-accent px-1 text-xs font-mono">getbalance</code> and
              check it matches the balance above. If either differs, stop and contact
              BTCBacked support.
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
            Back to Descriptor
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
