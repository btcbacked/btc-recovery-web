import { bitcoin } from './bitcoin-lib'
import type { Network } from './recovery-file'

export function getBitcoinNetwork(network: Network): bitcoin.Network {
  switch (network) {
    case 'mainnet':
      return bitcoin.networks.bitcoin
    case 'testnet':
      return bitcoin.networks.testnet
    case 'regtest':
      return bitcoin.networks.regtest
    case 'signet':
      return bitcoin.networks.testnet // signet uses testnet params
  }
}

export function getMempoolApiBase(
  network: Network,
  customEndpoint?: string,
): string {
  if (customEndpoint) return customEndpoint.replace(/\/$/, '')
  switch (network) {
    case 'mainnet':
      return 'https://mempool.space/api'
    case 'testnet':
      return 'https://mempool.space/testnet/api'
    case 'signet':
      return 'https://mempool.space/signet/api'
    case 'regtest':
      return 'http://localhost:8999/api' // user should configure
  }
}
