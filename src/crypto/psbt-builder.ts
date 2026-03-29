import { bitcoin } from './bitcoin-lib'
import { BIP32Factory } from 'bip32'
import { ecc } from './bitcoin-lib'
import { Buffer } from 'buffer'
import type { Network } from './recovery-file'
import type { ParsedDescriptor } from './descriptor-parser'
import type { Utxo } from './blockchain-api'
import type { DerivedAddress } from './address'
import { getBitcoinNetwork } from './networks'
import { RecoveryError } from './errors'

const bip32 = BIP32Factory(ecc)

export type TxOutput = {
  address: string
  value: number // satoshis
}

// Estimated vsize constants for P2WSH multisig
// INPUT_VSIZE is approximated per-threshold below; these are for overhead/output.
const OUTPUT_VSIZE = 43 // P2WSH or P2WPKH output
const OVERHEAD_VSIZE = 11 // transaction overhead

/**
 * Estimate the witness vsize of a single P2WSH m-of-n multisig input.
 * Formula: ~(41 + (73 * m) + (34 * n) + scriptOverhead) / 4 + nonWitness
 * Simplified per common configurations:
 *   2-of-3 ~= 104, 3-of-5 ~= 149, etc.
 */
function inputVsizeForThreshold(m: number, n: number): number {
  // Non-witness: 41 bytes (prevout 36 + sequence 4 + scriptSig len 1)
  // Witness: 1 (items count) + 1 (OP_0 push) + m*(1+72) + n*(1+33) + (3 + n*34 + overhead)
  const witnessBytes = 1 + 1 + m * 73 + (3 + n * 34 + 3)
  const nonWitnessBytes = 41
  return nonWitnessBytes + Math.ceil(witnessBytes / 4)
}

export function estimateTxVsize(
  inputCount: number,
  outputCount: number,
  threshold?: number,
  keyCount?: number,
): number {
  const inputVsize = inputVsizeForThreshold(threshold ?? 2, keyCount ?? 3)
  return OVERHEAD_VSIZE + inputCount * inputVsize + outputCount * OUTPUT_VSIZE
}

export function estimateFee(
  inputCount: number,
  outputCount: number,
  feeRate: number,
  threshold?: number,
  keyCount?: number,
): number {
  return Math.ceil(
    estimateTxVsize(inputCount, outputCount, threshold, keyCount) * feeRate,
  )
}

/**
 * Build a PSBT spending the given UTXOs to the specified outputs.
 *
 * Each UTXO must be paired with its DerivedAddress (which carries the
 * witnessScript and sorted public keys). BIP32 derivation metadata is
 * attached to every input so that hardware and software signers can
 * locate the correct key.
 */
export function buildPsbt(params: {
  utxos: Array<{ utxo: Utxo; addressInfo: DerivedAddress }>
  outputs: TxOutput[]
  changeAddress: DerivedAddress | null
  feeRate: number
  network: Network
  parsedDescriptor: ParsedDescriptor
}): bitcoin.Psbt {
  const { utxos, outputs, changeAddress, feeRate, network, parsedDescriptor } =
    params
  const net = getBitcoinNetwork(network)

  if (utxos.length === 0) {
    throw new RecoveryError(
      'TRANSACTION_ERROR',
      'No UTXOs available to spend.',
    )
  }

  const totalInput = utxos.reduce((sum, u) => sum + u.utxo.value, 0)
  const totalOutput = outputs.reduce((sum, o) => sum + o.value, 0)

  // Estimate fee (with change output if needed)
  const hasChange = changeAddress !== null
  const outputCount = outputs.length + (hasChange ? 1 : 0)
  const fee = estimateFee(
    utxos.length,
    outputCount,
    feeRate,
    parsedDescriptor.threshold,
    parsedDescriptor.keys.length,
  )

  const changeValue = totalInput - totalOutput - fee
  if (changeValue < 0) {
    throw new RecoveryError(
      'TRANSACTION_ERROR',
      `Insufficient funds. Available: ${totalInput} sats, needed: ${totalOutput + fee} sats (including ${fee} sats fee).`,
    )
  }

  const psbt = new bitcoin.Psbt({ network: net })

  // Add inputs
  for (const { utxo, addressInfo } of utxos) {
    const p2wshOutput = bitcoin.payments.p2wsh({
      redeem: { output: addressInfo.witnessScript },
      network: net,
    })

    if (!p2wshOutput.output) {
      throw new RecoveryError(
        'ADDRESS_ERROR',
        `Failed to compute P2WSH output script for address index ${addressInfo.index}.`,
      )
    }

    const chain = addressInfo.chain ?? 0

    const bip32Derivation = parsedDescriptor.keys.map((key) => {
      let xpub: string
      try {
        xpub = key.isPrivate
          ? bip32.fromBase58(key.extendedKey, net).neutered().toBase58()
          : key.extendedKey
      } catch (err) {
        throw new RecoveryError(
          'ADDRESS_ERROR',
          `Invalid extended key for fingerprint ${key.fingerprint}.`,
          String(err),
        )
      }

      let node;
      try {
        node = bip32.fromBase58(xpub, net)
      } catch (err) {
        throw new RecoveryError(
          'ADDRESS_ERROR',
          `Invalid xpub for fingerprint ${key.fingerprint}.`,
          String(err),
        )
      }

      const childPub = node.derive(chain).derive(addressInfo.index)
      const fpBuf = Buffer.from(key.fingerprint, 'hex')

      // Normalize path: convert h to '
      const normalizedPath = key.originPath.replace(/h\b/g, "'")

      return {
        masterFingerprint: fpBuf,
        pubkey: Buffer.from(childPub.publicKey),
        path: `m/${normalizedPath}/${chain}/${addressInfo.index}`,
      }
    })

    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: Buffer.from(p2wshOutput.output),
        value: BigInt(utxo.value),
      },
      witnessScript: addressInfo.witnessScript,
      bip32Derivation,
    })
  }

  // Add destination outputs
  for (const output of outputs) {
    psbt.addOutput({ address: output.address, value: BigInt(output.value) })
  }

  // Add change output if there is dust-safe change remaining
  // 330 = dust limit for P2WSH outputs
  if (hasChange && changeValue >= 330) {
    psbt.addOutput({
      address: changeAddress!.address,
      value: BigInt(changeValue),
    })
  }

  return psbt
}
