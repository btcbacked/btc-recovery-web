import { useState } from 'react'
import { cn } from '@/lib/utils'

type WalletGuideStepProps = {
  onReset: () => void
  onBackToDescriptor?: () => void
}

const tabs = ['Sparrow Wallet', 'Specter Desktop', 'Bitcoin Core'] as const
type Tab = (typeof tabs)[number]

// Stable IDs for aria-controls / aria-labelledby
const tabId = (tab: Tab) => `wallet-tab-${tab.replace(/\s+/g, '-').toLowerCase()}`
const panelId = (tab: Tab) => `wallet-panel-${tab.replace(/\s+/g, '-').toLowerCase()}`

export function WalletGuideStep({ onReset, onBackToDescriptor }: WalletGuideStepProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Sparrow Wallet')

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Import into Wallet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We recommend <strong>Sparrow Wallet</strong> — it has the best descriptor import
          support. Follow the instructions for your preferred wallet below.
        </p>
      </div>

      {/* Premium underline tab bar — borderless, indicator-only active state */}
      <div
        role="tablist"
        aria-label="Wallet software"
        className="flex border-b border-border"
      >
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
              activeTab === tab
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="rounded-[var(--radius-surface)] border border-border bg-card p-5">
        <div
          id={panelId('Sparrow Wallet')}
          role="tabpanel"
          aria-labelledby={tabId('Sparrow Wallet')}
          hidden={activeTab !== 'Sparrow Wallet'}
        >
          <ol className="step-list space-y-3">
            <li className="step-list-item text-sm text-foreground">Open Sparrow Wallet and go to <strong>File &rarr; New Wallet</strong></li>
            <li className="step-list-item text-sm text-foreground">Name the wallet (e.g., "BTCBacked Recovery")</li>
            <li className="step-list-item text-sm text-foreground">Select <strong>Multi Signature</strong> policy type</li>
            <li className="step-list-item text-sm text-foreground">Click on the <strong>Keystores</strong> tab</li>
            <li className="step-list-item text-sm text-foreground">For your keystore, click <strong>xPub / Watch Only Wallet</strong></li>
            <li className="step-list-item text-sm text-foreground">Paste the full descriptor in the <strong>Output Descriptor</strong> field</li>
            <li className="step-list-item text-sm text-foreground">Sparrow will parse the descriptor and populate all keystores</li>
            <li className="step-list-item text-sm text-foreground">Click <strong>Apply</strong> to finalize the wallet</li>
            <li className="step-list-item text-sm text-foreground">Navigate to the <strong>Transactions</strong> tab to see your UTXOs</li>
            <li className="step-list-item text-sm text-foreground">Use <strong>Send</strong> to create a transaction &mdash; sign with your key when prompted</li>
          </ol>
        </div>

        <div
          id={panelId('Specter Desktop')}
          role="tabpanel"
          aria-labelledby={tabId('Specter Desktop')}
          hidden={activeTab !== 'Specter Desktop'}
        >
          <ol className="step-list space-y-3">
            <li className="step-list-item text-sm text-foreground">Open Specter Desktop and click <strong>Add new wallet</strong></li>
            <li className="step-list-item text-sm text-foreground">Select <strong>Import from descriptor</strong></li>
            <li className="step-list-item text-sm text-foreground">Paste the full descriptor including the checksum</li>
            <li className="step-list-item text-sm text-foreground">Click <strong>Import</strong></li>
            <li className="step-list-item text-sm text-foreground">Specter will detect the multisig configuration automatically</li>
            <li className="step-list-item text-sm text-foreground">Review the imported wallet details and confirm</li>
            <li className="step-list-item text-sm text-foreground">Your balance and transaction history will load</li>
            <li className="step-list-item text-sm text-foreground">Use the <strong>Send</strong> tab to create and sign transactions</li>
          </ol>
        </div>

        <div
          id={panelId('Bitcoin Core')}
          role="tabpanel"
          aria-labelledby={tabId('Bitcoin Core')}
          hidden={activeTab !== 'Bitcoin Core'}
        >
          <div className="mb-4 rounded-[var(--radius-base)] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <strong>Advanced users only.</strong> Bitcoin Core requires running a full node
            and comfort with the RPC console. If you are not familiar with these steps,
            use Sparrow Wallet instead.
          </div>
          <ol className="step-list space-y-3">
            <li className="step-list-item text-sm text-foreground">Open the Bitcoin Core console (<strong>Window &rarr; Console</strong>)</li>
            <li className="step-list-item text-sm text-foreground">Create a new wallet:
              <code className="ml-1 rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
                createwallet "recovery" true true
              </code>
            </li>
            <li className="step-list-item text-sm text-foreground">Import the descriptor:
              <code className="ml-1 mt-1 block break-all rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
                importdescriptors '[{"{"}\"desc\": \"YOUR_DESCRIPTOR_HERE\", \"timestamp\": 0{"}"}]'
              </code>
            </li>
            <li className="step-list-item text-sm text-foreground">Replace <code className="rounded bg-accent px-1 text-xs font-mono">YOUR_DESCRIPTOR_HERE</code> with your full descriptor</li>
            <li className="step-list-item text-sm text-foreground">Wait for the wallet to rescan the blockchain</li>
            <li className="step-list-item text-sm text-foreground">Use <code className="rounded bg-accent px-1 text-xs font-mono">getbalance</code> to check your balance</li>
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
