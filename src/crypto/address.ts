import { BIP32Factory } from 'bip32'
import { ecc, bitcoin } from './bitcoin-lib'
import { Buffer } from 'buffer'
import type { Network } from './recovery-file'
import type { ParsedDescriptor } from './descriptor-parser'
import { getBitcoinNetwork } from './networks'
import { RecoveryError } from './errors'

const bip32 = BIP32Factory(ecc)

export type DerivedAddress = {
  index: number
  chain: number
  address: string
  witnessScript: Buffer
  publicKeys: Buffer[]
}

/**
 * Derive a single P2WSH multisig address from a parsed descriptor at the given index.
 *
 * Each key in the descriptor has the form [fp/origin]xpub/0/*. We derive
 * child /0/<index> from each extended key, sort the resulting public keys
 * lexicographically (sortedmulti), build the m-of-n multisig script, and
 * wrap it in P2WSH.
 */
export function deriveMultisigAddress(
  parsed: ParsedDescriptor,
  index: number,
  network: Network,
  chain: number = 0,
): DerivedAddress {
  const net = getBitcoinNetwork(network)

  // Derive child public key at /chain/index from each key's xpub
  const publicKeys = parsed.keys.map((key) => {
    let node;
    try {
      node = bip32.fromBase58(key.extendedKey, net)
    } catch (err) {
      throw new RecoveryError(
        'ADDRESS_ERROR',
        `Invalid extended key for fingerprint ${key.fingerprint}.`,
        String(err),
      )
    }
    // If the key is private, get the neutered (public) version first
    const pubNode = key.isPrivate ? node.neutered() : node
    return Buffer.from(pubNode.derive(chain).derive(index).publicKey)
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
    throw new RecoveryError(
      'ADDRESS_ERROR',
      'Failed to derive multisig address.',
    )
  }

  return {
    index,
    chain,
    address: p2wsh.address,
    witnessScript: Buffer.from(p2wsh.redeem.output),
    publicKeys: sortedKeys,
  }
}

/**
 * Derive a batch of sequential P2WSH multisig addresses.
 */
export function deriveMultisigAddresses(
  parsed: ParsedDescriptor,
  startIndex: number,
  count: number,
  network: Network,
  chain: number = 0,
): DerivedAddress[] {
  return Array.from({ length: count }, (_, i) =>
    deriveMultisigAddress(parsed, startIndex + i, network, chain),
  )
}
