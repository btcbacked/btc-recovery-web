import { bitcoin } from './bitcoin-lib'
import { getBitcoinNetwork } from './networks'
import type { Network } from './recovery-file'
import { RecoveryError } from './errors'
import { Buffer } from 'buffer'

export function psbtToBase64(psbt: bitcoin.Psbt): string {
  return psbt.toBase64()
}

export function psbtFromBase64(
  base64: string,
  network: Network,
): bitcoin.Psbt {
  try {
    return bitcoin.Psbt.fromBase64(base64, {
      network: getBitcoinNetwork(network),
    })
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
    return bitcoin.Psbt.fromBuffer(buffer, {
      network: getBitcoinNetwork(network),
    })
  } catch (err) {
    throw new RecoveryError(
      'PSBT_ERROR',
      'Invalid PSBT file. Please check the file format.',
      String(err),
    )
  }
}
