import { useState } from 'react'
import { getMempoolApiBase } from '@/crypto/networks'
import type { Network } from '@/crypto'

export function useNetworkConfig(network: Network) {
  const [customEndpoint, setCustomEndpoint] = useState<string>('')

  const apiBaseUrl = customEndpoint || getMempoolApiBase(network)
  const needsCustomEndpoint = network === 'regtest'

  return { apiBaseUrl, customEndpoint, setCustomEndpoint, needsCustomEndpoint }
}
