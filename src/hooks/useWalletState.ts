import { useState, useCallback } from 'react'
import type { ParsedDescriptor } from '@/crypto/descriptor-parser'
import type { Network } from '@/crypto'
import type { Utxo, FeeEstimates } from '@/crypto/blockchain-api'
import type { DerivedAddress } from '@/crypto/address'
import { deriveEscrowAddress } from '@/crypto/address'
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
    expectedAddress: string | null,
  ) => {
    setIsLoading(true)
    setError(null)
    try {
      // An escrow is a single address, so there is one address to query. That
      // is not the same as assuming child index 0: each key's own child
      // derivation is resolved, so a leg pinned to /0/1, by the descriptor or
      // by the file's recorded cosigner positions, contributes its pinned key.
      //
      // `expectedAddress` is required rather than optional on purpose. This is
      // the module that turns a descriptor into an address and then fetches
      // against it, so a caller that skips the check here shows a balance for
      // an address nothing corroborated. The wizard's own guards would have to
      // be the only thing holding, and this is the second of the two places
      // that used to derive with a literal 0.
      const addr = deriveEscrowAddress(parsedDescriptor, network, expectedAddress)
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
      // Cleared, not left standing. A load that succeeded and is then retried
      // into a refusal would otherwise render the previous address, balance and
      // UTXOs beside a message saying this page cannot open the escrow, which
      // is an address a customer can copy and send to.
      setAddresses([])
      setUtxos([])
      setBalance(0)
      setFeeEstimates(null)
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
