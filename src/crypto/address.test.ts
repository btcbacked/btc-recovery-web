// @vitest-environment node
/**
 * Tests for address.ts
 *
 * Uses a self-consistent descriptor built from deterministic BIP32 xpubs
 * so that bip32.fromBase58() succeeds and real P2WSH addresses are derived.
 */
import { describe, it, expect } from 'vitest'
import { deriveMultisigAddress, deriveMultisigAddresses } from './address'
import { parseDescriptor } from './descriptor-parser'
import { RecoveryError } from './errors'
import { bitcoin, ecc } from './bitcoin-lib'
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

// ---------------------------------------------------------------------------
// Build a real 2-of-3 testnet descriptor from deterministic BIP32 xpubs
// ---------------------------------------------------------------------------

const TEST_SEED = Buffer.alloc(32, 0x00)
const masterNode = bip32.fromSeed(TEST_SEED, NET)

const nodeA = masterNode.derive(0)
const nodeB = masterNode.derive(1)
const nodeC = masterNode.derive(2)

const xpubA = nodeA.neutered().toBase58()
const xpubB = nodeB.neutered().toBase58()
const xpubC = nodeC.neutered().toBase58()

// Fingerprints used in the descriptor string (8-char hex)
const fpA = Buffer.from(masterNode.fingerprint).toString('hex')
const fpB = Buffer.from(masterNode.derive(1).fingerprint).toString('hex')
const fpC = Buffer.from(masterNode.derive(2).fingerprint).toString('hex')

const REAL_DESCRIPTOR =
  `wsh(sortedmulti(2,[${fpA}/48'/1'/0'/2']${xpubA}/0/*,[${fpB}/48'/1'/0'/2']${xpubB}/0/*,[${fpC}/48'/1'/0'/2']${xpubC}/0/*))`

const parsed = parseDescriptor(REAL_DESCRIPTOR)

// ---------------------------------------------------------------------------
// deriveMultisigAddress – single index
// ---------------------------------------------------------------------------

describe('deriveMultisigAddress', () => {
  it('returns a valid bech32 testnet address at index 0', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet')
    // P2WSH testnet addresses start with "tb1q"
    expect(derived.address).toMatch(/^tb1q/)
    expect(derived.address.length).toBeGreaterThan(40)
  })

  it('returns a different address at index 1', () => {
    const addr0 = deriveMultisigAddress(parsed, 0, 'testnet').address
    const addr1 = deriveMultisigAddress(parsed, 1, 'testnet').address
    expect(addr1).not.toBe(addr0)
  })

  it('returns the index that was requested', () => {
    const derived = deriveMultisigAddress(parsed, 5, 'testnet')
    expect(derived.index).toBe(5)
  })

  it('returns the chain that was passed', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet', 1)
    expect(derived.chain).toBe(1)
  })

  it('returns 3 publicKeys (one per descriptor key)', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet')
    expect(derived.publicKeys).toHaveLength(3)
  })

  it('returns publicKeys sorted lexicographically (sortedmulti requirement)', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet')
    const keys = derived.publicKeys
    for (let i = 1; i < keys.length; i++) {
      expect(Buffer.compare(keys[i - 1]!, keys[i]!)).toBeLessThanOrEqual(0)
    }
  })

  it('returns a non-empty witnessScript Buffer', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet')
    expect(Buffer.isBuffer(derived.witnessScript)).toBe(true)
    expect(derived.witnessScript.length).toBeGreaterThan(0)
  })

  it('witnessScript starts with OP_2 (0x52) for a 2-of-3 multisig', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet')
    // OP_2 = 0x52 encodes the threshold
    expect(derived.witnessScript[0]).toBe(0x52)
  })

  it('address is deterministic across calls', () => {
    const a1 = deriveMultisigAddress(parsed, 0, 'testnet').address
    const a2 = deriveMultisigAddress(parsed, 0, 'testnet').address
    expect(a1).toBe(a2)
  })

  it('uses the chain parameter: chain=1 yields a different address than chain=0', () => {
    const external = deriveMultisigAddress(parsed, 0, 'testnet', 0)
    const internal = deriveMultisigAddress(parsed, 0, 'testnet', 1)
    expect(external.address).not.toBe(internal.address)
  })

  it('throws ADDRESS_ERROR for an invalid extended key', () => {
    const badParsed = {
      ...parsed,
      keys: [
        { ...parsed.keys[0]!, extendedKey: 'not_a_valid_xpub' },
        ...parsed.keys.slice(1),
      ],
    }
    expect(() => deriveMultisigAddress(badParsed, 0, 'testnet')).toThrow(
      RecoveryError,
    )
    try {
      deriveMultisigAddress(badParsed, 0, 'testnet')
    } catch (err) {
      expect((err as RecoveryError).code).toBe('ADDRESS_ERROR')
    }
  })

  it('returned publicKeys are compressed 33-byte keys', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet')
    for (const pk of derived.publicKeys) {
      // Compressed public keys are 33 bytes (0x02 or 0x03 prefix)
      expect(pk.length).toBe(33)
      expect([0x02, 0x03]).toContain(pk[0])
    }
  })
})

// ---------------------------------------------------------------------------
// deriveMultisigAddresses – batch derivation
// ---------------------------------------------------------------------------

describe('deriveMultisigAddresses', () => {
  it('returns the requested number of addresses', () => {
    const addresses = deriveMultisigAddresses(parsed, 0, 5, 'testnet')
    expect(addresses).toHaveLength(5)
  })

  it('starts at startIndex and increments sequentially', () => {
    const addresses = deriveMultisigAddresses(parsed, 10, 3, 'testnet')
    expect(addresses[0]!.index).toBe(10)
    expect(addresses[1]!.index).toBe(11)
    expect(addresses[2]!.index).toBe(12)
  })

  it('returns all unique addresses', () => {
    const addresses = deriveMultisigAddresses(parsed, 0, 5, 'testnet')
    const unique = new Set(addresses.map((a) => a.address))
    expect(unique.size).toBe(5)
  })

  it('returns an empty array when count is 0', () => {
    const addresses = deriveMultisigAddresses(parsed, 0, 0, 'testnet')
    expect(addresses).toHaveLength(0)
  })

  it('matches the corresponding single-derivation at each index', () => {
    const batch = deriveMultisigAddresses(parsed, 0, 3, 'testnet')
    for (let i = 0; i < 3; i++) {
      const single = deriveMultisigAddress(parsed, i, 'testnet')
      expect(batch[i]!.address).toBe(single.address)
    }
  })
})

// ---------------------------------------------------------------------------
// Address derivation from xprv matches neutered xpub
// ---------------------------------------------------------------------------

describe('xprv/xpub equivalence', () => {
  it('address derived from xprv matches address derived from its neutered xpub', () => {
    // Build 1-of-1 descriptors using tprv and its neutered tpub
    const xprvA = nodeA.toBase58()
    const xpubA_ = nodeA.neutered().toBase58()
    const fp = fpA

    const makeDesc = (key: string) =>
      `wsh(sortedmulti(1,[${fp}/48'/1'/0'/2']${key}/0/*))`

    const xprvParsed = parseDescriptor(makeDesc(xprvA))
    const xpubParsed = parseDescriptor(makeDesc(xpubA_))

    const addrFromXprv = deriveMultisigAddress(xprvParsed, 0, 'testnet').address
    const addrFromXpub = deriveMultisigAddress(xpubParsed, 0, 'testnet').address

    expect(addrFromXprv).toBe(addrFromXpub)
  })

  it('isPrivate = true for xprv key yields valid address', () => {
    const xprvA = nodeA.toBase58()
    const desc = `wsh(sortedmulti(1,[${fpA}/48'/1'/0'/2']${xprvA}/0/*))`
    const p = parseDescriptor(desc)
    expect(p.keys[0]!.isPrivate).toBe(true)
    const derived = deriveMultisigAddress(p, 0, 'testnet')
    expect(derived.address).toMatch(/^tb1q/)
  })
})
