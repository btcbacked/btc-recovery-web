import { bitcoin } from './bitcoin-lib'
import { getBitcoinNetwork } from './networks'
import type { Network } from './recovery-file'
import { RecoveryError } from './errors'
import { Buffer } from 'buffer'

export type PsbtOutput = {
  address: string
  value: number
  isChange: boolean
}

export type PsbtAnalysis = {
  inputCount: number
  outputCount: number
  totalInputValue: number
  totalOutputValue: number
  fee: number
  /** Fee rate in sat/vB, or null if the transaction size is unavailable. */
  feeRate: number | null
  outputs: PsbtOutput[]
  signatureCount: number[]
  isFullySigned: boolean
  requiredSignatures: number
}

/**
 * Inspect a PSBT and return a summary of its inputs, outputs, fees, and
 * signature status.
 *
 * @param escrowAddress - If provided, any output paying to this address
 *   will be flagged as change.
 */
export function analyzePsbt(
  psbt: bitcoin.Psbt,
  network: Network,
  escrowAddress?: string,
): PsbtAnalysis {
  const net = getBitcoinNetwork(network)
  const inputCount = psbt.data.inputs.length
  const txOutputs = psbt.txOutputs

  let totalInputBigInt = 0n
  const signatureCount: number[] = []

  for (let i = 0; i < inputCount; i++) {
    const input = psbt.data.inputs[i]
    if (input?.witnessUtxo) {
      totalInputBigInt += BigInt(input.witnessUtxo.value)
    }
    // Count partial signatures. Also check for finalScriptWitness which
    // indicates the input is already finalized (signatures are embedded).
    if (input?.finalScriptWitness) {
      // Already finalized — treat as fully signed. We cannot count individual
      // sigs from the witness stack easily, so use a sentinel value of Infinity
      // which will always pass the >= requiredSignatures check.
      signatureCount.push(Infinity)
    } else {
      const sigs = input?.partialSig?.length ?? 0
      signatureCount.push(sigs)
    }
  }

  const outputs: PsbtOutput[] = txOutputs.map((out) => {
    let address = ''
    try {
      address = bitcoin.address.fromOutputScript(out.script, net)
    } catch {
      address = 'Unknown'
    }
    return {
      address,
      value: Number(out.value),
      isChange: escrowAddress ? address === escrowAddress : false,
    }
  })

  const totalOutputBigInt = txOutputs.reduce(
    (sum, o) => sum + BigInt(o.value),
    0n,
  )
  const feeBigInt = totalInputBigInt - totalOutputBigInt

  // Convert to number for the return type (safe for values < 2^53)
  const totalInputValue = Number(totalInputBigInt)
  const totalOutputValue = Number(totalOutputBigInt)
  const fee = Number(feeBigInt)

  // Estimate fee rate from the unsigned transaction's virtual byte size.
  // The unsigned tx is smaller than the final signed tx, but it gives a
  // reasonable lower-bound approximation when the signed tx is not yet available.
  let feeRate: number | null = null
  try {
    const unsignedTx = psbt.data.globalMap.unsignedTx
    if (unsignedTx) {
      // Use the PSBT's underlying transaction to get byte length.
      // psbt.txOutputs / psbt.data.inputs give us enough for an estimate.
      // We access the tx buffer via the psbt internal property if available.
      const txBuf: Buffer | undefined = (unsignedTx as unknown as { toBuffer?: () => Buffer }).toBuffer?.()
      if (txBuf && txBuf.length > 0 && fee > 0) {
        // For segwit txs, vbytes ≈ (base_size * 3 + total_size) / 4
        // The unsigned tx lacks witnesses so its size underestimates; use it directly
        // as a best-effort display value.
        feeRate = Math.round((fee / txBuf.length) * 10) / 10
      }
    }
  } catch {
    // feeRate remains null — non-critical
  }

  // Determine required signatures from witnessScript (first byte is OP_N)
  const firstInput = psbt.data.inputs[0]
  let requiredSignatures = 2 // default for 2-of-3
  if (firstInput?.witnessScript) {
    const firstByte = firstInput.witnessScript[0]
    if (
      firstByte !== undefined &&
      firstByte >= 0x51 &&
      firstByte <= 0x60
    ) {
      requiredSignatures = firstByte - 0x50
    }
  }

  const isFullySigned = signatureCount.every((c) => c >= requiredSignatures)

  return {
    inputCount,
    outputCount: outputs.length,
    totalInputValue,
    totalOutputValue,
    fee,
    feeRate,
    outputs,
    signatureCount,
    isFullySigned,
    requiredSignatures,
  }
}

/**
 * Finalize all inputs in a PSBT. Every input must have enough partial
 * signatures to satisfy the multisig script.
 */
export function finalizePsbt(psbt: bitcoin.Psbt): bitcoin.Psbt {
  try {
    psbt.finalizeAllInputs()
    return psbt
  } catch (err) {
    throw new RecoveryError(
      'PSBT_ERROR',
      'Failed to finalize the transaction. Not all required signatures may be present.',
      String(err),
    )
  }
}

/**
 * Extract the fully signed raw transaction hex from a finalized PSBT.
 */
export function extractRawTransaction(psbt: bitcoin.Psbt): string {
  try {
    return psbt.extractTransaction().toHex()
  } catch (err) {
    throw new RecoveryError(
      'PSBT_ERROR',
      'Failed to extract the raw transaction. The PSBT may not be finalized.',
      String(err),
    )
  }
}
