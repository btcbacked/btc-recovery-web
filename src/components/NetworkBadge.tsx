import { cn } from '@/lib/utils'
import type { Network } from '@/crypto'

const networkStyles: Record<Network, string> = {
  mainnet: 'bg-success/10 text-success',
  testnet: 'bg-warning/10 text-warning',
  regtest: 'bg-muted text-muted-foreground',
  signet: 'bg-info/10 text-info',
}

const networkLabels: Record<Network, string> = {
  mainnet: 'Mainnet',
  testnet: 'Testnet',
  regtest: 'Regtest',
  signet: 'Signet',
}

export function NetworkBadge({ network }: { network: Network }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        networkStyles[network],
      )}
    >
      {networkLabels[network]}
    </span>
  )
}
