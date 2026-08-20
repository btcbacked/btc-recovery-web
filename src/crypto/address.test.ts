// @vitest-environment node
/**
 * Tests for address.ts
 *
 * Uses a self-consistent descriptor built from deterministic BIP32 xpubs
 * so that bip32.fromBase58() succeeds and real P2WSH addresses are derived.
 */
import { describe, it, expect } from 'vitest'
import { deriveMultisigAddress } from './address'
import { parseDescriptor } from './descriptor-parser'
import { RecoveryError, ESCROW_UNSUPPORTED } from './errors'
import { bitcoin, ecc } from './bitcoin-lib'
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'
import {
  MIXED_DEPTH_DESCRIPTOR,
  USER_ORIGIN_NODE,
  USER_ORIGIN_PATH,
  USER_MASTER,
  USER_XPUB,
  COSIGNER_ORIGIN_NODE,
  PLATFORM_ORIGIN_NODE,
  userChildPubkey,
} from './__fixtures__/deep-paths'

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

/**
 * The same three keys, with a child derivation chosen per key.
 *
 * The suffix is per key in a descriptor, so the tests need to vary them
 * independently rather than pass a chain alongside the descriptor.
 */
function descriptorWith(sufA: string, sufB: string, sufC: string): string {
  return (
    `wsh(sortedmulti(2,` +
    `[${fpA}/48'/1'/0'/2']${xpubA}/${sufA},` +
    `[${fpB}/48'/1'/0'/2']${xpubB}/${sufB},` +
    `[${fpC}/48'/1'/0'/2']${xpubC}/${sufC}))`
  )
}

const REAL_DESCRIPTOR = descriptorWith('0/*', '0/*', '0/*')

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

  it('takes the branch from the descriptor, not from a caller supplied chain', () => {
    // There is no chain parameter any more: the branch is whatever each key's
    // own child derivation names, which is the only thing that can be right
    // when the keys disagree.
    const external = deriveMultisigAddress(parsed, 0, 'testnet').address
    const internal = deriveMultisigAddress(
      parseDescriptor(descriptorWith('1/*', '1/*', '1/*')),
      0,
      'testnet',
    ).address
    expect(external).not.toBe(internal)
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

  it('a key on the change branch changes the address', () => {
    const oneKeyInternal = parseDescriptor(descriptorWith('1/*', '0/*', '0/*'))
    expect(deriveMultisigAddress(oneKeyInternal, 0, 'testnet').address).not.toBe(
      deriveMultisigAddress(parsed, 0, 'testnet').address,
    )
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

  it('says nothing technical to the customer when it cannot read an extended key', () => {
    // `useWalletState` renders a `RecoveryError`'s `userMessage` verbatim, so
    // whatever is written at this throw site is what a customer reads. It used
    // to be `Invalid extended key for fingerprint BBBBBBBB.`, handed to someone
    // who has lost access to the platform and is trying to move their own
    // Bitcoin.
    const badParsed = {
      ...parsed,
      keys: [
        { ...parsed.keys[0]!, extendedKey: 'not_a_valid_xpub' },
        ...parsed.keys.slice(1),
      ],
    }

    let thrown: RecoveryError | null = null
    try {
      deriveMultisigAddress(badParsed, 0, 'testnet')
    } catch (err) {
      thrown = err as RecoveryError
    }
    if (thrown === null) throw new Error('the invalid key was accepted, so nothing was asserted')

    expect(thrown.userMessage).toBe(ESCROW_UNSUPPORTED)
    expect(thrown.userMessage).not.toMatch(/fingerprint/i)
    expect(thrown.userMessage).not.toMatch(/extended key/i)
    expect(thrown.userMessage).not.toMatch(/invalid/i)

    // No dashes on screen, and nothing that hands the customer's key or their
    // funds to anyone else.
    expect(thrown.userMessage).not.toMatch(/[\u2013\u2014]/)
    expect(thrown.userMessage).toMatch(/your key is still yours/i)

    // The technical account is not lost, it is just not on screen.
    expect(thrown.detail).toMatch(/fingerprint/i)
    expect(thrown.detail).toContain(parsed.keys[0]!.fingerprint)
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

// ---------------------------------------------------------------------------
// Address derivation at the depth production uses
//
// The descriptor mixes a 6 level user origin with a 4 level platform origin,
// so the addresses come from an 8 level and a 6 level total path in the same
// script. deriveMultisigAddress must not care about either depth.
// ---------------------------------------------------------------------------

describe('deriveMultisigAddress at production depth', () => {
  const mixed = parseDescriptor(MIXED_DEPTH_DESCRIPTOR)

  /** The address computed straight from the fixture nodes, not from the descriptor. */
  function expectedAddress(chain: number, index: number): string {
    const pubkeys = [
      USER_ORIGIN_NODE,
      COSIGNER_ORIGIN_NODE,
      PLATFORM_ORIGIN_NODE,
    ]
      .map((node) => Buffer.from(node.derive(chain).derive(index).publicKey))
      .sort(Buffer.compare)
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network: NET })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })
    return p2wsh.address!
  }

  it('derives the address the fixture keys independently produce', () => {
    expect(deriveMultisigAddress(mixed, 0, 'testnet').address).toBe(
      expectedAddress(0, 0),
    )
  })

  it('derives a later receive index correctly', () => {
    expect(deriveMultisigAddress(mixed, 9, 'testnet').address).toBe(
      expectedAddress(0, 9),
    )
  })

  it('derives the change branch correctly', () => {
    const onChange = parseDescriptor(
      MIXED_DEPTH_DESCRIPTOR.replaceAll('/0/*', '/1/*'),
    )
    expect(deriveMultisigAddress(onChange, 3, 'testnet').address).toBe(
      expectedAddress(1, 3),
    )
  })

  it('includes the user key in the witness script at 8 total levels', () => {
    const derived = deriveMultisigAddress(mixed, 4, 'testnet')
    const userPub = userChildPubkey(0, 4)
    expect(
      derived.publicKeys.some((k) => Buffer.compare(k, userPub) === 0),
    ).toBe(true)
  })

  it('a sibling branch of the user key produces a different address', () => {
    // The whole point of the per contract branch: one level off is a
    // different wallet, and it still looks perfectly valid.
    const otherBranch = MIXED_DEPTH_DESCRIPTOR.replace(
      `${USER_ORIGIN_PATH.replace(/'/g, 'h')}]${USER_XPUB}`,
      `${USER_ORIGIN_PATH.replace(/'/g, 'h')}]${USER_MASTER.derivePath(
        "m/48'/1'/0'/2'/0/8",
      )
        .neutered()
        .toBase58()}`,
    )
    expect(otherBranch).not.toBe(MIXED_DEPTH_DESCRIPTOR)
    expect(
      deriveMultisigAddress(parseDescriptor(otherBranch), 0, 'testnet').address,
    ).not.toBe(expectedAddress(0, 0))
  })
})
