import { bitcoin } from './bitcoin-lib'
import { getBitcoinNetwork } from './networks'
import type { Network } from './recovery-file'
import { RecoveryError } from './errors'
import { Buffer } from 'buffer'

export function psbtToBase64(psbt: bitcoin.Psbt): string {
  return psbt.toBase64()
}

/**
 * Refuse a PSBT whose amounts on screen could differ from the amounts signed.
 *
 * The review screens add up each input's `witnessUtxo`. A signer that also
 * finds `nonWitnessUtxo` on an input signs over that transaction's output
 * instead (GHSA-4mfv-5394-26c7), and an input carrying only `nonWitnessUtxo`
 * is shown as Unknown, left out of the fee and still signed in full. So every
 * input must carry `witnessUtxo`, and a `nonWitnessUtxo` next to it must be
 * the transaction the input spends, with that same output at the input's
 * index. Then the total and fee shown are the ones the signature commits to.
 *
 * Throws a plain Error naming the input; both decoders below turn it into
 * their usual refusal, so the reason stays off screen.
 */
function requireMatchingUtxos(psbt: bitcoin.Psbt): bitcoin.Psbt {
  const txInputs = psbt.txInputs
  psbt.data.inputs.forEach((input, i) => {
    const witness = input.witnessUtxo
    if (!witness) throw new Error(`Input ${i} has no witnessUtxo`)
    if (!input.nonWitnessUtxo) return

    const { hash, index } = txInputs[i]!
    const prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo)
    if (!Buffer.from(prevTx.getHash()).equals(Buffer.from(hash))) {
      throw new Error(`Input ${i} nonWitnessUtxo is not the transaction it spends`)
    }
    const out = prevTx.outs[index]
    if (
      out?.value !== witness.value ||
      !Buffer.from(out.script).equals(Buffer.from(witness.script))
    ) {
      throw new Error(`Input ${i} witnessUtxo does not match output ${index} of nonWitnessUtxo`)
    }
  })
  return psbt
}

export function psbtFromBase64(
  base64: string,
  network: Network,
): bitcoin.Psbt {
  try {
    return requireMatchingUtxos(
      bitcoin.Psbt.fromBase64(base64, { network: getBitcoinNetwork(network) }),
    )
  } catch (err) {
    throw new RecoveryError(
      'PSBT_ERROR',
      'Invalid PSBT data. Please check the input.',
      String(err),
    )
  }
}

export function psbtToBuffer(psbt: bitcoin.Psbt): Buffer {
  return Buffer.from(psbt.toBuffer())
}

export function psbtFromBuffer(
  buffer: Buffer,
  network: Network,
): bitcoin.Psbt {
  try {
    return requireMatchingUtxos(
      bitcoin.Psbt.fromBuffer(buffer, { network: getBitcoinNetwork(network) }),
    )
  } catch (err) {
    throw new RecoveryError(
      'PSBT_ERROR',
      'Invalid PSBT file. Please check the file format.',
      String(err),
    )
  }
}
