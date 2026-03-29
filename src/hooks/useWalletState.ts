import { useState, useCallback } from 'react'
import type { ParsedDescriptor } from '@/crypto/descriptor-parser'
import type { Network } from '@/crypto'
import type { Utxo, FeeEstimates } from '@/crypto/blockchain-api'
import type { DerivedAddress } from '@/crypto/address'
import { deriveMultisigAddress } from '@/crypto/address'
import { fetchUtxos, fetchFeeEstimates } from '@/crypto/blockchain-api'
import { RecoveryError } from '@/crypto'

export function useWalletState() {
  const [addresses, setAddresses] = useState<DerivedAddress[]>([])
  const [utxos, setUtxos] = useState<Utxo[]>([])
  const [balance, setBalance] = useState(0)
  const [feeEstimates, setFeeEstimates] = useState<FeeEstimates | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadWallet = useCallback(async (
    parsedDescriptor: ParsedDescriptor,
    network: Network,
    apiBaseUrl: string,
  ) => {
    setIsLoading(true)
    setError(null)
    try {
      // Derive address at index 0 (escrow contracts use single address)
      const addr = deriveMultisigAddress(parsedDescriptor, 0, network)
      setAddresses([addr])

      // Fetch UTXOs and fee estimates in parallel
      const [utxoList, fees] = await Promise.all([
        fetchUtxos(apiBaseUrl, addr.address),
        fetchFeeEstimates(apiBaseUrl),
      ])

      setUtxos(utxoList)
      const total = utxoList.reduce((sum, u) => sum + u.value, 0)
      setBalance(total)
      setFeeEstimates(fees)
    } catch (err) {
      const message = err instanceof RecoveryError ? err.userMessage : 'Failed to load wallet data.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setAddresses([])
    setUtxos([])
    setBalance(0)
    setFeeEstimates(null)
    setIsLoading(false)
    setError(null)
  }, [])

  return { addresses, utxos, balance, feeEstimates, isLoading, error, loadWallet, reset }
}
