import { useState, useCallback, useRef } from 'react'
import type { ParsedDescriptor } from '@/crypto/descriptor-parser'
import type { Network } from '@/crypto'
import type { Utxo, FeeEstimates } from '@/crypto/blockchain-api'
import type { DerivedAddress } from '@/crypto/address'
import { deriveEscrowAddress } from '@/crypto/address'
import { fetchUtxos, fetchFeeEstimates } from '@/crypto/blockchain-api'
import { RecoveryError } from '@/crypto'

/**
 * The identity of a completed balance check: the endpoint it was fetched FROM
 * and the escrow address it was fetched FOR.
 *
 * Both halves carry weight. The endpoint alone used to be the whole key, and
 * every loan on a given network shares one endpoint, so the stamp left behind
 * by one escrow answered "yes, checked" for the next escrow opened in the same
 * tab. That put one loan's balance under another loan's address, which is the
 * worst thing this tool can print.
 *
 * Newline separated because neither a URL nor an address can contain one, so no
 * two different pairs can collide on the same key.
 */
export function balanceCheckKey(apiBaseUrl: string, address: string): string {
  return `${apiBaseUrl}\n${address}`
}

export function useWalletState() {
  const [addresses, setAddresses] = useState<DerivedAddress[]>([])
  const [utxos, setUtxos] = useState<Utxo[]>([])
  const [balance, setBalance] = useState(0)
  const [feeEstimates, setFeeEstimates] = useState<FeeEstimates | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * The endpoint and address a balance was last actually fetched for, or null
   * when no fetch has completed at all. See `balanceCheckKey`.
   *
   * `balance` alone cannot say this. Its initial value is 0, which is the same
   * 0 a genuinely empty escrow produces, so a screen holding only `balance`,
   * `isLoading` and `error` cannot tell "we asked and there is nothing there"
   * from "we have not asked yet" and reports the first. On the screen where
   * somebody finds out whether their money is still there, that is the worst
   * possible lie this tool could tell.
   *
   * The endpoint rather than a boolean, because on regtest the endpoint is a
   * field the customer types into. A balance fetched from the previous URL is
   * not an answer about the one now in the box. The address for the same
   * reason: a balance fetched for the previous loan is not an answer about the
   * escrow now on screen.
   */
  const [balanceCheckedFor, setBalanceCheckedFor] = useState<string | null>(null)

  /*
   * Which load is allowed to write.
   *
   * Every call takes the next number, and only the holder of the current one
   * may touch state. A request nobody is waiting for any more cannot be pulled
   * out of the air, so it is allowed to land and is then discarded. Without
   * this the LAST answer to arrive won rather than the last one asked for, and
   * `reset()` could not cancel anything at all: an abandoned fetch went on to
   * write a balance, a UTXO set and a fresh "checked" stamp over a wizard that
   * had already moved to a different loan.
   */
  const seq = useRef(0)

  const loadWallet = useCallback(async (
    parsedDescriptor: ParsedDescriptor,
    network: Network,
    apiBaseUrl: string,
    expectedAddress: string | null,
  ) => {
    const mine = ++seq.current
    setIsLoading(true)
    setError(null)
    // The address THIS load is about, kept for the stamp in `finally`. Stays
    // empty when the derivation refuses, which is the case where there is no
    // escrow to report a balance for at all.
    let queriedAddress = ''
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
      queriedAddress = addr.address
      setAddresses([addr])

      // Fetch UTXOs and fee estimates in parallel
      const [utxoList, fees] = await Promise.all([
        fetchUtxos(apiBaseUrl, addr.address),
        fetchFeeEstimates(apiBaseUrl),
      ])

      // Superseded while the network was answering. The wizard was reset, or a
      // second file was opened, or a newer load overtook this one. These
      // numbers describe an escrow that is no longer the one on screen.
      if (mine !== seq.current) return

      setUtxos(utxoList)
      const total = utxoList.reduce((sum, u) => sum + u.value, 0)
      setBalance(total)
      setFeeEstimates(fees)
      // Cleared on the way out as well as on the way in. `error` is cleared
      // when a load STARTS, so a success landing while a later failure was on
      // screen left a correct balance sitting inside an error box.
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
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
      // Set on failure too. A fetch that completed and failed is still an
      // answer this screen has, and `error` is what makes it Unknown rather
      // than a zero. Not set at all when this load was superseded: stamping
      // there is what re-armed the gate for an escrow nobody asked about.
      if (mine === seq.current) {
        setBalanceCheckedFor(balanceCheckKey(apiBaseUrl, queriedAddress))
        setIsLoading(false)
      }
    }
  }, [])

  const reset = useCallback(() => {
    // Cancels whatever is in the air. The request itself cannot be recalled, so
    // the ticket is advanced and the answer is thrown away when it lands.
    seq.current += 1
    setAddresses([])
    setUtxos([])
    setBalance(0)
    setFeeEstimates(null)
    setIsLoading(false)
    setError(null)
    setBalanceCheckedFor(null)
  }, [])

  return {
    addresses,
    utxos,
    balance,
    feeEstimates,
    isLoading,
    error,
    balanceCheckedFor,
    loadWallet,
    reset,
  }
}
