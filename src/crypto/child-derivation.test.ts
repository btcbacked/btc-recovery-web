// @vitest-environment node
/**
 * The per key child derivation, and the escrow shape that exposed it.
 *
 * In the LEGACY escrow shape the per contract branch sits in the child suffix
 * rather than the origin bracket, so a leg reads `[fp/48h/1h/0h/2h]tpub.../0/N`
 * and the whole path is 6 levels. That shape is live, and two funded production
 * escrows are in it with their borrower legs pinned at `/0/1` and `/0/2`.
 *
 * The tool used to derive `/0/<index>` for every key regardless of what the
 * descriptor said, so for those escrows it showed an address holding nothing,
 * reported a zero balance, and would have built a PSBT naming a public key that
 * is not in the witness script.
 *
 * There was no fixture with a fixed suffix anywhere in this repo, which is why
 * that survived. These tests are that fixture.
 */
import { describe, it, expect } from 'vitest'
import { Buffer } from 'buffer'
import { childIndices, childPathSuffix, deriveChildNode } from './child-derivation'
import { parseDescriptor, usesStandardChildDerivation } from './descriptor-parser'
import { deriveMultisigAddress } from './address'
import { buildPsbt } from './psbt-builder'
import { signPsbtWithXprv } from './psbt-signer'
import { psbtToBase64, psbtFromBase64 } from './psbt-codec'
import { RecoveryError, ESCROW_UNSUPPORTED } from './errors'
import { bitcoin } from './bitcoin-lib'
import type { Utxo } from './blockchain-api'
import {
  MISMATCHED_CHILD_DESCRIPTOR,
  PINNED_AND_RANGED_DESCRIPTOR,
  RANGED_EQUIVALENT_DESCRIPTOR,
  ACCOUNT_ORIGIN_PATH,
  BORROWER_XPRV,
  BORROWER_FINGERPRINT,
  LENDER_XPRV,
  LENDER_FINGERPRINT,
  LEGS,
  withChild,
  legChildPubkey,
  legFullPath,
} from './__fixtures__/fixed-child'

const NET = bitcoin.networks.testnet
const DESTINATION_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'

// ---------------------------------------------------------------------------
// childIndices: the resolver every derivation site now shares
// ---------------------------------------------------------------------------

describe('childIndices', () => {
  it('fills the wildcard with the address index', () => {
    expect(childIndices('0/*', 7)).toEqual([0, 7])
  })

  it('ignores the address index when the child is pinned', () => {
    // The defect in one line: for these escrows the index means nothing.
    expect(childIndices('0/1', 0)).toEqual([0, 1])
    expect(childIndices('0/1', 7)).toEqual([0, 1])
    expect(childIndices('0/1', 99)).toEqual([0, 1])
  })

  it('reads the branch from the suffix, not from a default of zero', () => {
    expect(childIndices('1/*', 4)).toEqual([1, 4])
    expect(childIndices('1/9', 4)).toEqual([1, 9])
  })

  it('rejects a hardened component instead of unhardening it silently', () => {
    // parseInt("1'") is 1, so a tolerant parser derives a DIFFERENT key here
    // and produces a valid looking address for a wallet nobody controls.
    for (const suffix of ["0/1'", '0/1h', '0/1H', "0'/1"]) {
      expect(() => childIndices(suffix, 0)).toThrow(RecoveryError)
    }
  })

  it('rejects a suffix that is not exactly two components', () => {
    // psbt-signer.ts locates a key by the last two path components, so any
    // other length would derive one key for the address and sign with another.
    for (const suffix of ['', '0', '0/0/1', '0/*/1']) {
      expect(() => childIndices(suffix, 0)).toThrow(RecoveryError)
    }
  })

  it('rejects a non numeric component', () => {
    expect(() => childIndices('0/abc', 0)).toThrow(RecoveryError)
  })

  /**
   * What the refusal SAYS, not just that it happened.
   *
   * `useWalletState` renders a `RecoveryError`'s `userMessage` straight onto
   * the screen, so this string is customer facing copy and it was approved as
   * such. This module used to carry its own byte for byte duplicate of it,
   * which nothing asserted, so the two were free to drift and only the copy in
   * `errors.ts` would have been reviewed.
   */
  it('refuses in the approved words, with the technical reason kept off screen', () => {
    for (const suffix of ['0/0/1', "0/1'", '*/*', '0/abc']) {
      let thrown: unknown
      try {
        childIndices(suffix, 0)
      } catch (err) {
        thrown = err
      }

      expect(thrown).toBeInstanceOf(RecoveryError)
      const error = thrown as RecoveryError
      expect(error.userMessage).toBe(ESCROW_UNSUPPORTED)

      // The wording a developer needs belongs in `detail`, which no screen
      // renders. A customer must never be shown a descriptor suffix.
      expect(error.userMessage).not.toMatch(/child derivation/i)
      expect(error.detail).toContain(suffix)
    }
  })

  it('rejects an address index a public parent cannot derive', () => {
    expect(() => childIndices('0/*', 0x80000000)).toThrow(RecoveryError)
    expect(() => childIndices('0/*', -1)).toThrow(RecoveryError)
  })

  it('rejects an unusable address index even when no wildcard would consume it', () => {
    // Validating only inside the wildcard branch let a pinned suffix answer a
    // nonsense request with a real looking address, which is the shape of every
    // bug in this file: a wrong question quietly given a plausible answer.
    for (const index of [-1, 1.5, NaN, 0x80000000]) {
      expect(() => childIndices('0/1', index)).toThrow(RecoveryError)
    }
  })

  it('rejects a wildcard that is not the last step', () => {
    // BIP-380 allows `*` only as the final step. Resolved componentwise, `*/*`
    // at index 0 returns [0, 0]: the exact address the old code produced for
    // every escrow, which must not come back wearing a notice saying it is
    // trustworthy.
    expect(() => childIndices('*/*', 0)).toThrow(RecoveryError)
    expect(() => childIndices('*/0', 0)).toThrow(RecoveryError)
    expect(() => childIndices('*/1', 7)).toThrow(RecoveryError)
  })

  it('rejects it at the two sites that resolve a suffix, not only in the resolver', () => {
    // The placement check earns its keep at the callers, which is where a
    // resolved wildcard would turn into a key and a path. Pinned here as well
    // as in the resolver so that deleting the check breaks more than the one
    // test that names it.
    const misplaced = { childDerivation: '*/0' }
    expect(() => deriveChildNode(LEGS[0]!.node.neutered(), misplaced, 0)).toThrow(RecoveryError)
    expect(() => childPathSuffix(misplaced, 0)).toThrow(RecoveryError)
  })

  it('refuses an address for an escrow whose wildcard is not last', () => {
    // What the customer meets. `*/0` at index 0 resolves componentwise to
    // [0, 0], so without the check this descriptor hands back a real looking
    // address for a wallet holding nothing, on a screen that says it is right.
    const parsed = parseDescriptor(withChild(0, '*/0'))
    expect(() => deriveMultisigAddress(parsed, 0, 'testnet')).toThrow(RecoveryError)
  })

  it('reports DESCRIPTOR_ERROR and never leaks the reason into the user message', () => {
    try {
      childIndices("0/1'", 0)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RecoveryError)
      const recoveryError = err as RecoveryError
      expect(recoveryError.code).toBe('DESCRIPTOR_ERROR')
      expect(recoveryError.userMessage).not.toContain("0/1'")
    }
  })
})

describe('childPathSuffix', () => {
  it('names the child that deriveChildNode actually returned', () => {
    for (const leg of LEGS) {
      const suffix = childPathSuffix(leg, 0)
      expect(suffix).toBe(`/${leg.childDerivation}`)
      const node = deriveChildNode(leg.node.neutered(), leg, 0)
      expect(Buffer.compare(Buffer.from(node.publicKey), legChildPubkey(leg))).toBe(0)
    }
  })

  it('appends the address index only for a ranged key', () => {
    expect(childPathSuffix({ childDerivation: '0/*' }, 6)).toBe('/0/6')
    expect(childPathSuffix({ childDerivation: '0/1' }, 6)).toBe('/0/1')
  })
})

// ---------------------------------------------------------------------------
// The mismatched escrow, end to end
// ---------------------------------------------------------------------------

describe('an escrow whose three legs sit at three different child suffixes', () => {
  const parsed = parseDescriptor(MISMATCHED_CHILD_DESCRIPTOR)
  const ranged = parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR)

  /** The address built straight from the fixture nodes, not from the descriptor. */
  const expectedAddress = (() => {
    const pubkeys = LEGS.map(legChildPubkey).sort(Buffer.compare)
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network: NET })
    return bitcoin.payments.p2wsh({ redeem: p2ms, network: NET }).address!
  })()

  it('the fixture really is the LEGACY 6 level shape, branch in the child', () => {
    // Guards the test itself. If the branch ever migrates into the origin
    // bracket, this fixture stops describing the escrows that are actually
    // funded, and every assertion below stops meaning anything.
    for (const key of parsed.keys) {
      expect(key.originPath.split('/')).toHaveLength(4)
      expect(`m/${key.originPath}/${key.childDerivation}`.split('/')).toHaveLength(7) // 'm' + 6
    }
    expect(parsed.keys.some((k) => k.originPath === ACCOUNT_ORIGIN_PATH.replace(/'/g, 'h'))).toBe(true)
  })

  it('the fixture really does carry three different, mostly non zero suffixes', () => {
    // Guards the test itself. If the fixture ever flattens to one suffix, or to
    // all zeros, everything below stops proving anything.
    const suffixes = parsed.keys.map((k) => k.childDerivation)
    expect(new Set(suffixes).size).toBe(3)
    expect(suffixes.filter((s) => s !== '0/0').length).toBe(2)
    expect(suffixes).not.toContain('0/*')
  })

  it('derives the address the fixture keys independently produce', () => {
    expect(deriveMultisigAddress(parsed, 0, 'testnet').address).toBe(expectedAddress)
  })

  it('pins that address as a literal, so it cannot drift silently', () => {
    expect(deriveMultisigAddress(parsed, 0, 'testnet').address).toBe(
      'tb1qj796qufvzgynacxu7a65vuk7alm2wrr627v90a0l9auudmtkp20sp6wgpf',
    )
  })

  it('is NOT the address the old index 0 code produced', () => {
    // The regression itself. Before the fix both descriptors derived the same
    // address, because the suffix was ignored and every key took /0/0.
    expect(deriveMultisigAddress(parsed, 0, 'testnet').address).not.toBe(
      deriveMultisigAddress(ranged, 0, 'testnet').address,
    )
  })

  it('gives the same address whatever address index is asked for', () => {
    // Every leg is pinned, so this escrow has exactly one address. A wallet
    // scan would find the same thing at every index.
    const first = deriveMultisigAddress(parsed, 0, 'testnet').address
    for (const index of [1, 2, 7, 50]) {
      expect(deriveMultisigAddress(parsed, index, 'testnet').address).toBe(first)
    }
  })

  it('puts each leg\'s own pinned public key in the witness script', () => {
    const derived = deriveMultisigAddress(parsed, 0, 'testnet')
    for (const leg of LEGS) {
      const expected = legChildPubkey(leg)
      expect(
        derived.publicKeys.some((k) => Buffer.compare(k, expected) === 0),
      ).toBe(true)
    }
  })

  it('is flagged as a layout other wallet software may disagree with', () => {
    expect(usesStandardChildDerivation(parsed)).toBe(false)
    expect(usesStandardChildDerivation(ranged)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pinned and ranged legs in one sortedmulti
//
// The closest match to the two funded escrows: the user legs carry their
// contract branch, the platform leg still ranges. No single global chain and
// index can express this, which is why the per key resolver is the fix.
// ---------------------------------------------------------------------------

describe('an escrow mixing a pinned leg with a ranged leg', () => {
  const parsed = parseDescriptor(PINNED_AND_RANGED_DESCRIPTOR)

  it('carries both shapes at once', () => {
    const suffixes = parsed.keys.map((k) => k.childDerivation).sort()
    expect(suffixes).toEqual(['0/*', '0/1', '0/2'])
  })

  it('moves only the ranged leg when the address index changes', () => {
    const at0 = deriveMultisigAddress(parsed, 0, 'testnet')
    const at5 = deriveMultisigAddress(parsed, 5, 'testnet')
    expect(at0.address).not.toBe(at5.address)

    // The two pinned legs contribute the SAME key at both indices.
    for (const leg of LEGS.filter((l) => l.childDerivation !== '0/0')) {
      const pinned = legChildPubkey(leg)
      expect(at0.publicKeys.some((k) => Buffer.compare(k, pinned) === 0)).toBe(true)
      expect(at5.publicKeys.some((k) => Buffer.compare(k, pinned) === 0)).toBe(true)
    }
  })

  it('records the pinned paths and the ranged path in the same input', () => {
    const addressInfo = deriveMultisigAddress(parsed, 5, 'testnet')
    const psbt = buildPsbt({
      utxos: [
        {
          utxo: { txid: 'c'.repeat(64), vout: 0, value: 500_000, status: { confirmed: true } } as Utxo,
          addressInfo,
        },
      ],
      outputs: [{ address: DESTINATION_ADDRESS, value: 400_000 }],
      changeAddress: null,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor: parsed,
    })
    const decoded = psbtFromBase64(psbtToBase64(psbt), 'testnet')
    const paths = (decoded.data.inputs[0]!.bip32Derivation ?? []).map((d) => d.path).sort()

    // Two legs ignore the index; one follows it.
    expect(paths.filter((p) => p.endsWith('/0/1'))).toHaveLength(1)
    expect(paths.filter((p) => p.endsWith('/0/2'))).toHaveLength(1)
    expect(paths.filter((p) => p.endsWith('/0/5'))).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The PSBT: this is the file that actually signs
// ---------------------------------------------------------------------------

describe('a PSBT built for the mismatched escrow', () => {
  const parsed = parseDescriptor(MISMATCHED_CHILD_DESCRIPTOR)

  function makeUtxo(txid: string, vout: number, value: number): Utxo {
    return { txid, vout, value, status: { confirmed: true } } as Utxo
  }

  function build(addressIndex = 0): bitcoin.Psbt {
    const addressInfo = deriveMultisigAddress(parsed, addressIndex, 'testnet')
    return buildPsbt({
      utxos: [{ utxo: makeUtxo('b'.repeat(64), 0, 500_000), addressInfo }],
      outputs: [{ address: DESTINATION_ADDRESS, value: 400_000 }],
      changeAddress: null,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor: parsed,
    })
  }

  /** The derivation entries as they come back out of a serialized PSBT. */
  function roundTrip(psbt: bitcoin.Psbt) {
    const decoded = psbtFromBase64(psbtToBase64(psbt), 'testnet')
    return decoded.data.inputs[0]!.bip32Derivation ?? []
  }

  it('records the pinned path per leg, not /0/<index> for all three', () => {
    const paths = roundTrip(build()).map((d) => d.path).sort()
    expect(paths).toEqual(LEGS.map(legFullPath).sort())
  })

  it('pairs every path with the public key that path derives', () => {
    // The pubkey and the path have to describe the same child. If they drift,
    // a signer follows the path, produces a key the script does not contain,
    // and the signature is worthless.
    const entries = roundTrip(build())
    for (const leg of LEGS) {
      const entry = entries.find((d) => d.path === legFullPath(leg))
      expect(entry).toBeDefined()
      expect(Buffer.compare(Buffer.from(entry!.pubkey), legChildPubkey(leg))).toBe(0)
    }
  })

  it('every declared pubkey is actually in the witness script', () => {
    const addressInfo = deriveMultisigAddress(parsed, 0, 'testnet')
    const script = addressInfo.witnessScript
    for (const entry of roundTrip(build())) {
      expect(script.includes(Buffer.from(entry.pubkey))).toBe(true)
    }
  })

  it('records the same paths whatever address index the caller asked for', () => {
    expect(roundTrip(build(0)).map((d) => d.path).sort()).toEqual(
      roundTrip(build(9)).map((d) => d.path).sort(),
    )
  })

  it('signs with two of three and finalizes at these suffixes', () => {
    // The end of the line: if the pinned child were wrong anywhere above, the
    // signature would not verify against the witness script and finalize fails.
    const psbt = build()

    const borrower = signPsbtWithXprv(psbt, BORROWER_XPRV, BORROWER_FINGERPRINT, 'testnet')
    expect(borrower.signedCount).toBe(1)
    expect(
      Buffer.compare(psbt.data.inputs[0]!.partialSig![0]!.pubkey, legChildPubkey(LEGS[0]!)),
    ).toBe(0)

    const lender = signPsbtWithXprv(psbt, LENDER_XPRV, LENDER_FINGERPRINT, 'testnet')
    expect(lender.signedCount).toBe(1)

    expect(() => psbt.finalizeAllInputs()).not.toThrow()
    expect(psbt.extractTransaction().toHex().length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// The shapes that must fail closed rather than show a plausible wrong address
// ---------------------------------------------------------------------------

describe('a descriptor this tool will not reproduce', () => {
  const withBorrowerChild = (childDerivation: string) => withChild(0, childDerivation)

  it('refuses a hardened child rather than deriving an unhardened one', () => {
    expect(() =>
      deriveMultisigAddress(parseDescriptor(withBorrowerChild("0/1'")), 0, 'testnet'),
    ).toThrow(RecoveryError)
  })

  it('refuses a key carrying no child derivation at all', () => {
    const parsed = parseDescriptor(withBorrowerChild(''))
    expect(parsed.keys.some((k) => k.childDerivation === '')).toBe(true)
    expect(() => deriveMultisigAddress(parsed, 0, 'testnet')).toThrow(RecoveryError)
  })

  it('refuses a three level child suffix, which the signer could not follow', () => {
    expect(() =>
      deriveMultisigAddress(parseDescriptor(withBorrowerChild('0/0/1')), 0, 'testnet'),
    ).toThrow(RecoveryError)
  })
})
