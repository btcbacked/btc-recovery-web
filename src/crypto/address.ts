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

/**
 * The only address index an escrow has.
 *
 * An escrow is a single address, not a range, so this is the index every
 * caller wants. It is not an assumption about where the money is: after
 * `resolveCosignerPositions` a leg that sits elsewhere is pinned to its own
 * child and ignores this index entirely, and a leg still ranged is one the file
 * says nothing about.
 */
const ESCROW_ADDRESS_INDEX = 0

/**
 * The escrow's address, checked against the address the file records for it.
 *
 * This is the safety net for everything `resolveCosignerPositions` could not
 * settle. A leg whose position is unknown keeps its wildcard and is derived at
 * index 0, which is a guess; without this check that guess reaches the customer
 * as a fact, with an address, a zero balance and no warning. That is the exact
 * shape of the failure on the two funded escrows.
 *
 * `expectedAddress` of null REMOVES THE CHECK and is not a pass. The file
 * either predates the field or the platform could not state the address, and in
 * both cases the address returned here is uncorroborated rather than verified.
 *
 * A mismatch throws `ESCROW_UNSUPPORTED`, which is the fourth cause to land on
 * that one approved refusal and is true of this one too: an escrow this page
 * cannot reproduce is an escrow this page does not handle. The wizard turns the
 * throw into a null address, which is what makes the refusal visible and the
 * signing buttons dead. Returning the address with a caveat was the other
 * option and is worse: the customer came here to move money, and an address
 * they can copy is one they will send to.
 */
export function deriveEscrowAddress(
  parsed: ParsedDescriptor,
  network: Network,
  expectedAddress: string | null,
): DerivedAddress {
  const derived = deriveMultisigAddress(parsed, ESCROW_ADDRESS_INDEX, network)

  // Compared case insensitively. Every address this can derive is bech32,
  // because `parseDescriptor` accepts only `wsh`, and BIP-173 makes the
  // uppercase form of a bech32 address the same address. Comparing the bytes
  // would refuse a file whose recorded address is written in the uppercase
  // form, which kills the sign button over a difference that is not one.
  if (
    expectedAddress !== null &&
    derived.address.toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    // Both values are public addresses, so naming them in `detail` leaks
    // nothing. `detail` is never rendered; `userMessage` is what reaches the
    // screen and it is the approved wording, unchanged.
    throw new RecoveryError(
      'ADDRESS_ERROR',
      ESCROW_UNSUPPORTED,
      `Derived ${derived.address}, but the recovery file records ${expectedAddress}`,
    )
  }

  return derived
}
