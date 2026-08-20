import { BIP32Factory } from 'bip32'
import { ecc, bitcoin } from './bitcoin-lib'
import { Buffer } from 'buffer'
import type { Network } from './recovery-file'
import type { ParsedDescriptor } from './descriptor-parser'
import { deriveChildNode } from './child-derivation'
import { getBitcoinNetwork } from './networks'
import { RecoveryError, ESCROW_UNSUPPORTED } from './errors'

const bip32 = BIP32Factory(ecc)

export type DerivedAddress = {
  index: number
  address: string
  witnessScript: Buffer
  publicKeys: Buffer[]
}

/**
 * Derive a single P2WSH multisig address from a parsed descriptor at the given index.
 *
 * Each key in the descriptor has the form [fp/origin]xpub/<child derivation>,
 * and the child derivation is per key. A ranged key (`/0/*`) takes `index`; a
 * key pinned to a fixed child (`/0/1`) ignores `index` and always contributes
 * the same public key. Both shapes are live, and they mix inside one
 * `sortedmulti`, so each key is resolved on its own terms.
 *
 * The resulting public keys are sorted lexicographically (sortedmulti), built
 * into the m-of-n multisig script, and wrapped in P2WSH.
 */
export function deriveMultisigAddress(
  parsed: ParsedDescriptor,
  index: number,
  network: Network,
): DerivedAddress {
  const net = getBitcoinNetwork(network)

  // Derive the child public key each key contributes, at ITS OWN child path
  const publicKeys = parsed.keys.map((key) => {
    let node;
    try {
      node = bip32.fromBase58(key.extendedKey, net)
    } catch (err) {
      // The `userMessage` is what `useWalletState` puts on the screen, verbatim.
      // It used to be the line below it, which named a fingerprint at a
      // customer who has lost access to the platform and is trying to move
      // their own Bitcoin. The technical account is still kept, in `detail`,
      // which is for logs and never rendered.
      throw new RecoveryError(
        'ADDRESS_ERROR',
        ESCROW_UNSUPPORTED,
        `Invalid extended key for fingerprint ${key.fingerprint}: ${err}`,
      )
    }
    // If the key is private, get the neutered (public) version first
    const pubNode = key.isPrivate ? node.neutered() : node
    return Buffer.from(deriveChildNode(pubNode, key, index).publicKey)
  })

  // Sort lexicographically (sortedmulti requirement)
  const sortedKeys = [...publicKeys].sort(Buffer.compare)

  // Build multisig witness script
  const p2ms = bitcoin.payments.p2ms({
    m: parsed.threshold,
    pubkeys: sortedKeys,
    network: net,
  })

  // Wrap in P2WSH
  const p2wsh = bitcoin.payments.p2wsh({
    redeem: p2ms,
    network: net,
  })

  if (!p2wsh.address || !p2wsh.redeem?.output) {
    // A type narrowing guard: `p2wsh` above always fills both fields for a
    // valid `p2ms` redeem, so nothing reaches this today. It still carries the
    // approved refusal rather than its own wording, because `useWalletState`
    // renders `userMessage` verbatim and a future change that makes this
    // reachable must not be the thing that puts developer text on a screen.
    // The technical sentence moves to `detail`, where it stays for debugging.
    throw new RecoveryError(
      'ADDRESS_ERROR',
      ESCROW_UNSUPPORTED,
      'Failed to derive multisig address.',
    )
  }

  return {
    index,
    address: p2wsh.address,
    witnessScript: Buffer.from(p2wsh.redeem.output),
    publicKeys: sortedKeys,
  }
}
