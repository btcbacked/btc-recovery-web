import { useState, useCallback } from 'react'
import { bitcoin } from '@/crypto/bitcoin-lib'
import type { Network } from '@/crypto'
import type { ParsedDescriptor } from '@/crypto/descriptor-parser'
import type { Utxo } from '@/crypto/blockchain-api'
import type { DerivedAddress } from '@/crypto/address'
import { buildPsbt, type TxOutput } from '@/crypto/psbt-builder'
import { signPsbtWithXprv } from '@/crypto/psbt-signer'
import { analyzePsbt, finalizePsbt, extractRawTransaction, type PsbtAnalysis } from '@/crypto/psbt-finalizer'
import { psbtToBase64, psbtFromBase64, psbtToBuffer, psbtFromBuffer } from '@/crypto/psbt-codec'
import { broadcastTransaction } from '@/crypto/blockchain-api'
import { RecoveryError } from '@/crypto'
import { Buffer } from 'buffer'

export function usePsbtWorkflow() {
  const [psbt, setPsbt] = useState<bitcoin.Psbt | null>(null)
  const [analysis, setAnalysis] = useState<PsbtAnalysis | null>(null)
  const [txid, setTxid] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const build = useCallback((params: {
    utxos: Array<{ utxo: Utxo; addressInfo: DerivedAddress }>
    outputs: TxOutput[]
    changeAddress: DerivedAddress | null
    feeRate: number
    network: Network
    parsedDescriptor: ParsedDescriptor
  }) => {
    try {
      setError(null)
      const newPsbt = buildPsbt(params)
      setPsbt(newPsbt)
      const a = analyzePsbt(newPsbt, params.network, params.changeAddress?.address)
      setAnalysis(a)
      return newPsbt
    } catch (err) {
      const message = err instanceof RecoveryError ? err.userMessage : 'Failed to build transaction.'
      setError(message)
      return null
    }
  }, [])

  const sign = useCallback((
    currentPsbt: bitcoin.Psbt,
    xprv: string,
    userFingerprint: string,
    network: Network,
    escrowAddress?: string,
  ): number | null => {
    try {
      setError(null)
      setIsProcessing(true)
      const { psbt: signed, signedCount } = signPsbtWithXprv(currentPsbt, xprv, userFingerprint, network)
      setPsbt(signed)
      const a = analyzePsbt(signed, network, escrowAddress)
      setAnalysis(a)
      return signedCount
    } catch (err) {
      const message = err instanceof RecoveryError ? err.userMessage : 'Failed to sign transaction.'
      setError(message)
      return null
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const importPsbt = useCallback((data: string | ArrayBuffer, network: Network, escrowAddress?: string) => {
    try {
      setError(null)
      let imported: bitcoin.Psbt
      if (typeof data === 'string') {
        imported = psbtFromBase64(data, network)
      } else {
        imported = psbtFromBuffer(Buffer.from(data), network)
      }
      setPsbt(imported)
      const a = analyzePsbt(imported, network, escrowAddress)
      setAnalysis(a)
      return imported
    } catch (err) {
      const message = err instanceof RecoveryError ? err.userMessage : 'Failed to import PSBT.'
      setError(message)
      return null
    }
  }, [])

  const finalizeAndBroadcast = useCallback(async (
    currentPsbt: bitcoin.Psbt,
    apiBaseUrl: string,
  ) => {
    try {
      setError(null)
      setIsProcessing(true)
      const finalized = finalizePsbt(currentPsbt)
      const rawHex = extractRawTransaction(finalized)
      const id = await broadcastTransaction(apiBaseUrl, rawHex)
      setTxid(id)
      return id
    } catch (err) {
      const message = err instanceof RecoveryError ? err.userMessage : 'Failed to broadcast transaction.'
      setError(message)
      return null
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const getBase64 = useCallback(() => {
    if (!psbt) return null
    return psbtToBase64(psbt)
  }, [psbt])

  const getBuffer = useCallback(() => {
    if (!psbt) return null
    return psbtToBuffer(psbt)
  }, [psbt])

  const reset = useCallback(() => {
    setPsbt(null)
    setAnalysis(null)
    setTxid(null)
    setError(null)
    setIsProcessing(false)
  }, [])

  return {
    psbt, analysis, txid, isProcessing, error,
    build, sign, importPsbt, finalizeAndBroadcast,
    getBase64, getBuffer, setError, reset,
  }
}
