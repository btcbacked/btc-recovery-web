import { BIP32Factory } from 'bip32'
import { bitcoin, ECPair, ecc } from './bitcoin-lib'
import { Buffer } from 'buffer'
import type { Network } from './recovery-file'
import { getBitcoinNetwork } from './networks'
import { RecoveryError } from './errors'

const bip32 = BIP32Factory(ecc)

/**
 * Sign every input in a PSBT that belongs to the given user fingerprint.
 *
 * The xprv is assumed to be the extended private key at the descriptor's
 * origin path (e.g. m/48'/1'/0'/2'). For each input, the function reads
 * the bip32Derivation entries, finds the one matching our fingerprint,
 * derives the child key at /change/index, and signs.
 *
 * Returns the number of inputs that were signed so callers can detect
 * a no-op (e.g. wrong fingerprint or already fully signed).
 */
export function signPsbtWithXprv(
  psbt: bitcoin.Psbt,
  xprv: string,
  userFingerprint: string,
  network: Network,
): { psbt: bitcoin.Psbt; signedCount: number } {
  const net = getBitcoinNetwork(network)

  let masterNode;
  try {
    masterNode = bip32.fromBase58(xprv, net)
  } catch (err) {
    throw new RecoveryError(
      'PSBT_ERROR',
      'Invalid extended private key. Unable to parse xprv.',
      String(err),
    )
  }

  if (masterNode.isNeutered()) {
    throw new RecoveryError(
      'PSBT_ERROR',
      'An extended public key (xpub) was provided, but signing requires an extended private key (xprv).',
    )
  }

  let signedCount = 0

  try {
    // Sign each input
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const input = psbt.data.inputs[i]
      if (!input?.bip32Derivation) continue

      // Find our key's derivation info
      for (const deriv of input.bip32Derivation) {
        if (!deriv) continue
        const fp = Buffer.from(deriv.masterFingerprint).toString('hex').toLowerCase()
        if (fp === userFingerprint.toLowerCase()) {
          // Parse the derivation path to extract the child indices after the origin path.
          // The full path is like m/48'/1'/0'/2'/0/0, but our xprv is already at 48'/1'/0'/2'.
          // So we need to derive just /change/index from it.
          const pathParts = deriv.path.split('/')
          // Get the last two non-hardened components (change and index)
          const changePart = pathParts[pathParts.length - 2]
          const indexPart = pathParts[pathParts.length - 1]

          if (changePart === undefined || indexPart === undefined) continue

          // Reject hardening markers in the child components — these should be
          // unhardened chain/index values only.
          if (/['h]/.test(changePart) || /['h]/.test(indexPart)) {
            throw new RecoveryError(
              'PSBT_ERROR',
              `Unexpected hardened derivation in child path component: ${changePart}/${indexPart}. ` +
                'The change and index path segments must be unhardened.',
            )
          }

          const change = parseInt(changePart, 10)
          const index = parseInt(indexPart, 10)

          if (isNaN(change) || isNaN(index)) continue

          const childNode = masterNode.derive(change).derive(index)

          if (!childNode.privateKey) {
            throw new RecoveryError(
              'PSBT_ERROR',
              `Derived child node at /${change}/${index} does not have a private key.`,
            )
          }

          const keyPair = ECPair.fromPrivateKey(
            Buffer.from(childNode.privateKey),
            { network: net },
          )

          // bitcoinjs-lib v7 needs the signer to have a sign method returning Buffer
          psbt.signInput(i, {
            publicKey: Buffer.from(keyPair.publicKey),
            sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
          })
          signedCount++
          break
        }
      }
    }

    return { psbt, signedCount }
  } catch (err) {
    if (err instanceof RecoveryError) throw err
    throw new RecoveryError(
      'PSBT_ERROR',
      'Failed to sign the transaction.',
      String(err),
    )
  }
}
