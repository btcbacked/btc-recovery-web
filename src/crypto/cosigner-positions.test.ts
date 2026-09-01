/**
 * Reading the cosigner positions the platform records beside the descriptor.
 *
 * THE DEFECT. `outputDescriptor` publishes every HD leg as the ranged `/0/*`.
 * Two funded escrows have their legs at different child positions, so no single
 * address index reproduces their address. Both places that derived one passed a
 * literal 0, landed on a different wallet, and showed a zero balance with no
 * warning at all.
 *
 * Everything here is real. Real seeds, real BIP32 derivation, real addresses.
 * Nothing is stubbed, so nothing can pass by agreeing with a stub.
 *
 * The fixture is `__fixtures__/fixed-child.ts`, whose three legs already sit at
 * the production positions: borrower `/0/1`, lender `/0/2`, platform `/0/0`.
 */
import { describe, it, expect } from 'vitest'
import { Buffer } from 'buffer'
import { parseDescriptor } from './descriptor-parser'
import { resolveCosignerPositions } from './child-derivation'
import { deriveMultisigAddress, deriveEscrowAddress } from './address'
import { parseRecoveryFile } from './recovery-file'
import type { RecoveryFileCosigner } from './recovery-file'
import { RecoveryError } from './errors'
import { buildPsbt } from './psbt-builder'
import {
  BORROWER_FINGERPRINT,
  LENDER_FINGERPRINT,
  PLATFORM_FINGERPRINT,
  LEGS,
  descriptorFrom,
  MISMATCHED_CHILD_DESCRIPTOR,
  RANGED_EQUIVALENT_DESCRIPTOR,
  legChildPubkey,
} from './__fixtures__/fixed-child'

// bitcoinjs-lib and bip32 expect a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

/**
 * The address the two funded escrows are actually at.
 *
 * Derived from the descriptor that states every position explicitly, so it is
 * ground truth computed independently of anything the resolver does.
 */
const ESCROW_ADDRESS = deriveMultisigAddress(
  parseDescriptor(MISMATCHED_CHILD_DESCRIPTOR),
  0,
  'testnet',
).address

/** The positions as the platform now records them, one per leg. */
const POSITIONS: RecoveryFileCosigner[] = [
  { role: 'borrower', fingerprint: BORROWER_FINGERPRINT, keyIndex: 1 },
  { role: 'lender', fingerprint: LENDER_FINGERPRINT, keyIndex: 2 },
  { role: 'platform', fingerprint: PLATFORM_FINGERPRINT, keyIndex: 0 },
]

/** The same three legs with nothing known about any of them. */
const ALL_UNKNOWN: RecoveryFileCosigner[] = POSITIONS.map((cosigner) => ({
  ...cosigner,
  keyIndex: null,
}))

function suffixFor(
  parsed: ReturnType<typeof parseDescriptor>,
  fingerprint: string,
): string | undefined {
  return parsed.keys.find(
    (key) => key.fingerprint.toLowerCase() === fingerprint.toLowerCase(),
  )?.childDerivation
}

// ---------------------------------------------------------------------------
// The acceptance test: the two funded escrows
// ---------------------------------------------------------------------------

describe('an escrow whose legs sit at different positions', () => {
  it('is the case a single address index cannot express', () => {
    // Guards the fixture. If the three positions ever collapsed onto one value
    // every test below would still pass while proving nothing.
    expect(POSITIONS.map((cosigner) => cosigner.keyIndex)).toEqual([1, 2, 0])
    expect(new Set(POSITIONS.map((cosigner) => cosigner.keyIndex)).size).toBe(3)
  })

  it('reproduces its escrow address from a ranged descriptor and the positions', () => {
    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      POSITIONS,
    )

    expect(deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('is the file the tool used to get wrong, so the ranged reading misses it', () => {
    // This is the assertion that fails on the code before this change: the
    // ranged descriptor at index 0 is a different wallet entirely.
    const unresolved = parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR)

    expect(deriveMultisigAddress(unresolved, 0, 'testnet').address).not.toBe(
      ESCROW_ADDRESS,
    )
  })

  it('refuses the ranged reading rather than showing its address', () => {
    const unresolved = parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR)

    expect(() => deriveEscrowAddress(unresolved, 'testnet', ESCROW_ADDRESS)).toThrow(
      RecoveryError,
    )
  })

  it('turns each ranged leg into its own pinned child, not one shared index', () => {
    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      POSITIONS,
    )

    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/1')
    expect(suffixFor(resolved, LENDER_FINGERPRINT)).toBe('0/2')
    expect(suffixFor(resolved, PLATFORM_FINGERPRINT)).toBe('0/0')
  })

  it('carries the resolved position into the PSBT, so the signature matches the script', () => {
    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      POSITIONS,
    )
    const addressInfo = deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS)

    const psbt = buildPsbt({
      utxos: [
        {
          utxo: { txid: 'a'.repeat(64), vout: 0, value: 200_000, status: { confirmed: true } },
          addressInfo,
        },
      ],
      outputs: [{ address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', value: 100_000 }],
      changeAddress: null,
      feeRate: 2,
      network: 'testnet',
      parsedDescriptor: resolved,
    })

    const derivations = psbt.data.inputs[0]!.bip32Derivation!
    const borrowerLeg = LEGS.find((leg) => leg.fingerprint === BORROWER_FINGERPRINT)!
    const borrower = derivations.find(
      (entry) => Buffer.from(entry.masterFingerprint).toString('hex') === BORROWER_FINGERPRINT,
    )!
    const borrowerPubkey = Buffer.from(borrower.pubkey)

    // The path names the child the position places the key at, and the pubkey
    // at that path is the one the witness script holds.
    expect(borrower.path.endsWith('/0/1')).toBe(true)
    expect(borrowerPubkey.equals(legChildPubkey(borrowerLeg))).toBe(true)
    expect(addressInfo.publicKeys.some((key) => key.equals(borrowerPubkey))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rule 1 and 2: a non-wildcard suffix in the descriptor wins
// ---------------------------------------------------------------------------

describe('a descriptor that already states a position', () => {
  it('keeps working, which is what customers with older files hold', () => {
    const parsed = parseDescriptor(MISMATCHED_CHILD_DESCRIPTOR)

    expect(deriveEscrowAddress(parsed, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('wins over a keyIndex that disagrees with it', () => {
    const conflicting: RecoveryFileCosigner[] = POSITIONS.map((cosigner) => ({
      ...cosigner,
      keyIndex: 7,
    }))

    const resolved = resolveCosignerPositions(
      parseDescriptor(MISMATCHED_CHILD_DESCRIPTOR),
      conflicting,
    )

    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/1')
    expect(suffixFor(resolved, LENDER_FINGERPRINT)).toBe('0/2')
    expect(suffixFor(resolved, PLATFORM_FINGERPRINT)).toBe('0/0')
    expect(deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('applies a keyIndex to the ranged legs of a descriptor that mixes both', () => {
    // Borrower pinned by the descriptor, the other two ranged and placed by the
    // positions. One escrow, both mechanisms, and they have to agree.
    const mixed = descriptorFrom(
      LEGS.map((leg) =>
        leg.fingerprint === BORROWER_FINGERPRINT ? leg : { ...leg, childDerivation: '0/*' },
      ),
    )

    const resolved = resolveCosignerPositions(parseDescriptor(mixed), POSITIONS)

    expect(deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })
})

// ---------------------------------------------------------------------------
// Rule 4 and 5: unknown is never zero
// ---------------------------------------------------------------------------

describe('a position the file does not state', () => {
  it('keeps the wildcard rather than pinning the leg to 0', () => {
    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      ALL_UNKNOWN,
    )

    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/*')
    expect(suffixFor(resolved, LENDER_FINGERPRINT)).toBe('0/*')
    expect(suffixFor(resolved, PLATFORM_FINGERPRINT)).toBe('0/*')
  })

  it('leaves the leg ranging, which a leg pinned to 0 would not do', () => {
    // The difference between "unknown" and "0" is only visible at another
    // address index: a wildcard moves with it and a pinned 0 does not.
    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      ALL_UNKNOWN,
    )

    expect(deriveMultisigAddress(resolved, 3, 'testnet').address).not.toBe(
      deriveMultisigAddress(resolved, 0, 'testnet').address,
    )
  })

  it('is refused rather than shown when the file records the escrow address', () => {
    // One leg unknown is enough. The tool derives that leg at index 0, which is
    // a guess, and the recorded address is the only thing that can catch it.
    const oneUnknown = POSITIONS.map((cosigner) =>
      cosigner.fingerprint === BORROWER_FINGERPRINT
        ? { ...cosigner, keyIndex: null }
        : cosigner,
    )

    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      oneUnknown,
    )

    expect(() => deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS)).toThrow(
      RecoveryError,
    )
  })

  it('behaves identically whether the array is missing or every index is null', () => {
    const parsed = parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR)

    expect(resolveCosignerPositions(parsed, null)).toEqual(
      resolveCosignerPositions(parsed, ALL_UNKNOWN),
    )
    expect(resolveCosignerPositions(parsed, undefined)).toEqual(
      resolveCosignerPositions(parsed, ALL_UNKNOWN),
    )
    expect(resolveCosignerPositions(parsed, [])).toEqual(
      resolveCosignerPositions(parsed, ALL_UNKNOWN),
    )
  })

  it('leaves a leg the array does not mention alone', () => {
    const withoutLender = POSITIONS.filter(
      (cosigner) => cosigner.fingerprint !== LENDER_FINGERPRINT,
    )

    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      withoutLender,
    )

    expect(suffixFor(resolved, LENDER_FINGERPRINT)).toBe('0/*')
    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/1')
  })
})

// ---------------------------------------------------------------------------
// Rule 6: the join, and where it has to give up
// ---------------------------------------------------------------------------

describe('matching a position to a leg', () => {
  it('matches whatever case either side is written in', () => {
    const upperDescriptor = descriptorFrom(
      LEGS.map((leg) => ({
        ...leg,
        childDerivation: '0/*',
        fingerprint: leg.fingerprint.toUpperCase(),
      })),
    )

    const resolved = resolveCosignerPositions(parseDescriptor(upperDescriptor), POSITIONS)

    expect(deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('matches a position written in uppercase against a lowercase descriptor leg', () => {
    // The other side of the same fold, and it had no test: the case above
    // uppercases the DESCRIPTOR only, so the cosigner side could stop folding
    // and nothing would fail. `readCosigners` takes any non-empty string, so an
    // uppercase fingerprint passes the reader, joins nothing, leaves every leg
    // ranged and derives index 0. On a file with no `escrowAddress`, which is
    // every file a customer holds today, that is the original bug back with no
    // warning at all.
    const upperPositions = POSITIONS.map((cosigner) => ({
      ...cosigner,
      fingerprint: cosigner.fingerprint.toUpperCase(),
    }))

    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      upperPositions,
    )

    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/1')
    expect(deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('resolves nothing for a fingerprint that names two legs, rather than picking the first', () => {
    // Both user legs carry the borrower fingerprint. The position says 1, and
    // the two legs are at 1 and 2, so guessing has a real wrong answer.
    const duplicated = descriptorFrom(
      LEGS.map((leg) => ({
        ...leg,
        childDerivation: '0/*',
        fingerprint:
          leg.fingerprint === LENDER_FINGERPRINT ? BORROWER_FINGERPRINT : leg.fingerprint,
      })),
    )

    const parsed = parseDescriptor(duplicated)
    const resolved = resolveCosignerPositions(parsed, POSITIONS)

    const ambiguous = resolved.keys.filter(
      (key) => key.fingerprint.toLowerCase() === BORROWER_FINGERPRINT,
    )
    expect(ambiguous).toHaveLength(2)
    expect(ambiguous.map((key) => key.childDerivation)).toEqual(['0/*', '0/*'])
    // The unambiguous leg is still resolved: one bad join does not poison the rest.
    expect(suffixFor(resolved, PLATFORM_FINGERPRINT)).toBe('0/0')
  })

  it('resolves nothing when two entries claim one fingerprint', () => {
    const contradictory: RecoveryFileCosigner[] = [
      { role: 'borrower', fingerprint: BORROWER_FINGERPRINT, keyIndex: 1 },
      { role: 'lender', fingerprint: BORROWER_FINGERPRINT, keyIndex: 2 },
      { role: 'platform', fingerprint: PLATFORM_FINGERPRINT, keyIndex: 0 },
    ]

    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      contradictory,
    )

    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/*')
    expect(suffixFor(resolved, PLATFORM_FINGERPRINT)).toBe('0/0')
  })

  it('ignores a position naming a fingerprint the descriptor does not carry', () => {
    const stray: RecoveryFileCosigner[] = [
      ...POSITIONS,
      { role: 'platform', fingerprint: 'deadbeef', keyIndex: 9 },
    ]

    const resolved = resolveCosignerPositions(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      stray,
    )

    expect(deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })
})

// ---------------------------------------------------------------------------
// Rule 3: a raw pubkey has no child derivation
//
// READ THIS BEFORE READING THE ASSERTIONS. They record what happens today, and
// what happens today is not safe. `parseDescriptor` does not reject a raw
// pubkey leg, it SILENTLY DROPS IT, and only throws when the drop takes the key
// count below the threshold. So a 2-of-3 carrying one raw leg parses as a
// 2-of-2 over the two surviving keys and yields a confidently wrong address
// from a descriptor nothing complained about. The legacy `[fingerprint/0]
// <pubkey>` shape the spec names is still live in the backend.
//
// Nothing below endorses that. What these two pin is the narrower claim rule 3
// actually makes, that no `keyIndex` can ever be attached to such a leg, which
// is true because `ParsedKeyEntry` cannot represent one.
//
// The drop itself is out of scope for this change and wants its own: a
// `parsed.keys.length === context.totalKeys` cross-check at parse time. Until
// then the only thing that catches it is `escrowAddress`, which this change
// added, and only for a file that carries one.
// ---------------------------------------------------------------------------

describe('a raw pubkey leg', () => {
  const RAW_FINGERPRINT = 'deadbeef'
  const rawLegDescriptor = `wsh(sortedmulti(2,[${RAW_FINGERPRINT}/0]02${'ab'.repeat(32)},${
    parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR).raw.replace(/^wsh\(sortedmulti\(2,/, '').replace(/\)\)$/, '')
  }))`

  it('takes no keyIndex, because it carries no extended key to derive from', () => {
    const parsed = parseDescriptor(rawLegDescriptor)
    const resolved = resolveCosignerPositions(parsed, [
      ...POSITIONS,
      { role: 'platform', fingerprint: RAW_FINGERPRINT, keyIndex: 4 },
    ])

    // `ParsedKeyEntry` can only hold an extended key, so the raw leg is not
    // among the keys at all and nothing can attach a child derivation to it.
    expect(
      resolved.keys.some((key) => key.fingerprint.toLowerCase() === RAW_FINGERPRINT),
    ).toBe(false)
    expect(resolved.keys.every((key) => /^(x|t)(pub|prv)/.test(key.extendedKey))).toBe(true)
  })

  it('is dropped rather than refused, which is the hazard named above', () => {
    // Not a property to preserve. It is here so the drop is written down as a
    // fact with a test on it, rather than being something the block above
    // merely asserts in prose. A file in this shape derives an address from
    // fewer keys than the escrow has, and says nothing.
    const parsed = parseDescriptor(rawLegDescriptor)

    expect(parsed.keys).toHaveLength(3)
    // The descriptor names four legs. One of them is gone.
    expect(rawLegDescriptor.match(/\[[0-9a-f]{8}\//g)).toHaveLength(4)
  })

  it('leaves the extended-key legs of the same descriptor resolvable', () => {
    const parsed = parseDescriptor(rawLegDescriptor)
    const resolved = resolveCosignerPositions(parsed, POSITIONS)

    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/1')
  })
})

// ---------------------------------------------------------------------------
// The escrow address as a check, and what a null one means
// ---------------------------------------------------------------------------

describe('checking a derived address against the one the file records', () => {
  const resolved = resolveCosignerPositions(
    parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
    POSITIONS,
  )

  it('returns the address when the two agree', () => {
    expect(deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('refuses with the approved wording when they disagree', () => {
    const wrong = deriveMultisigAddress(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      0,
      'testnet',
    ).address

    try {
      deriveEscrowAddress(resolved, 'testnet', wrong)
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryError)
      const refusal = error as RecoveryError
      expect(refusal.code).toBe('ADDRESS_ERROR')
      expect(refusal.userMessage).toContain('This page cannot open this escrow.')
      // The technical account stays in `detail`, which is never rendered.
      expect(refusal.detail).toContain(ESCROW_ADDRESS)
      expect(refusal.detail).toContain(wrong)
    }
  })

  it('accepts the uppercase form of the same bech32 address', () => {
    // BIP-173: the uppercase form is the same address. Refusing it would kill
    // the sign button over a difference that is not one.
    expect(
      deriveEscrowAddress(resolved, 'testnet', ESCROW_ADDRESS.toUpperCase()).address,
    ).toBe(ESCROW_ADDRESS)
  })

  it('removes the check when the file records no address, which is not a pass', () => {
    // A file that states nothing cannot refuse anything, so the same wrong
    // derivation that was refused above is handed back here uncorroborated.
    const unresolved = parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR)

    expect(deriveEscrowAddress(unresolved, 'testnet', null).address).toBe(
      deriveMultisigAddress(unresolved, 0, 'testnet').address,
    )
    expect(deriveEscrowAddress(unresolved, 'testnet', null).address).not.toBe(
      ESCROW_ADDRESS,
    )
  })
})

// ---------------------------------------------------------------------------
// Reading the two fields off a real recovery file
// ---------------------------------------------------------------------------

describe('a recovery file carrying positions', () => {
  function fileJson(extra: Record<string, unknown>): string {
    return JSON.stringify({
      version: 1,
      network: 'testnet',
      outputDescriptor: RANGED_EQUIVALENT_DESCRIPTOR,
      context: { contractId: 'c', role: 'borrower', threshold: 2, totalKeys: 3 },
      userKey: {
        keySource: 'COLD_CARD',
        derivationPath: "m/48'/1'/0'/2'",
        xpub: 'tpubignored',
        // Uppercase, as every file the platform writes has it. Nothing may
        // compare this against a cosigner fingerprint.
        fingerprint: BORROWER_FINGERPRINT.toUpperCase(),
      },
      ...extra,
    })
  }

  it('reads the positions and the escrow address through to a right address', () => {
    const file = parseRecoveryFile(
      fileJson({ escrowAddress: ESCROW_ADDRESS, cosigners: POSITIONS }),
    )

    const resolved = resolveCosignerPositions(
      parseDescriptor(file.outputDescriptor),
      file.cosigners,
    )

    expect(deriveEscrowAddress(resolved, file.network, file.escrowAddress ?? null).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('reads a file that states neither field as stating neither', () => {
    const file = parseRecoveryFile(fileJson({}))

    expect(file.escrowAddress).toBeNull()
    expect(file.cosigners).toBeNull()
  })

  it('reads an explicit null the same as an absent field', () => {
    const file = parseRecoveryFile(fileJson({ escrowAddress: null, cosigners: null }))

    expect(file.escrowAddress).toBeNull()
    expect(file.cosigners).toBeNull()
  })

  it('reads an empty escrow address as no address, not as an address to match', () => {
    const file = parseRecoveryFile(fileJson({ escrowAddress: '   ' }))

    expect(file.escrowAddress).toBeNull()
  })

  it('keeps a null keyIndex null', () => {
    const file = parseRecoveryFile(fileJson({ cosigners: ALL_UNKNOWN }))

    expect(file.cosigners?.map((cosigner) => cosigner.keyIndex)).toEqual([null, null, null])
  })

  it('treats a cosigner with no keyIndex at all as unknown', () => {
    const file = parseRecoveryFile(
      fileJson({ cosigners: [{ role: 'borrower', fingerprint: BORROWER_FINGERPRINT }] }),
    )

    expect(file.cosigners?.[0]?.keyIndex).toBeNull()
  })

  it('stores the trimmed fingerprint it validated, so the join still matches', () => {
    // Checking a trimmed value and keeping the untrimmed one passes validation
    // and then fails the join in silence: the leg simply keeps its wildcard and
    // the address is derived at index 0.
    const padded = POSITIONS.map((cosigner) => ({
      ...cosigner,
      fingerprint: `  ${cosigner.fingerprint}  `,
      role: `  ${cosigner.role}  `,
    }))
    const file = parseRecoveryFile(
      fileJson({ escrowAddress: ESCROW_ADDRESS, cosigners: padded }),
    )

    expect(file.cosigners?.[0]?.fingerprint).toBe(BORROWER_FINGERPRINT)
    expect(file.cosigners?.[0]?.role).toBe('borrower')

    const resolved = resolveCosignerPositions(
      parseDescriptor(file.outputDescriptor),
      file.cosigners,
    )
    expect(deriveEscrowAddress(resolved, file.network, file.escrowAddress ?? null).address).toBe(
      ESCROW_ADDRESS,
    )
  })

  it('keeps an unrecognised role verbatim rather than refusing the file', () => {
    const file = parseRecoveryFile(
      fileJson({
        cosigners: [{ role: 'arbiter', fingerprint: BORROWER_FINGERPRINT, keyIndex: 1 }],
      }),
    )

    expect(file.cosigners?.[0]?.role).toBe('arbiter')
  })

  // -------------------------------------------------------------------------
  // What an unreadable optional field does
  //
  // `cosigners` and `escrowAddress` are both optional, so refusing the whole
  // document over one of them turns a file whose descriptor and key are intact
  // into a dead end: no descriptor, no key, no address, nothing to import by
  // hand. On a descriptor that already pins every leg the array is ignored
  // entirely, so the refusal withheld an escrow that was fully reproducible.
  //
  // The line is whether the bad value STATES A POSITION that dropping it would
  // throw away. A value that states none can be dropped for nothing, which is
  // the state rules 4 and 5 already define as unknown.
  //
  // A value that does state one still refuses, because dropping it leaves that
  // leg ranged and derived at index 0, which is where the file has just said it
  // is not: a confidently wrong address on any file carrying no `escrowAddress`,
  // and that is every file a customer holds today. Two shapes are in that class,
  // a `keyIndex` this reader cannot derive and a `keyIndex` on an entry with no
  // fingerprint to join it to. `escrowAddress` refuses for the mirror reason: it
  // is the only check that catches such an address, nothing on screen tells a
  // checked address from an unchecked one, and nulling it deletes the check in
  // silence.
  // -------------------------------------------------------------------------

  it.each([
    ['a cosigners field that is not an array', { cosigners: 'borrower' }],
    ['an entry that is not an object', { cosigners: ['borrower'] }],
    [
      'an entry that states no position at all',
      { cosigners: [{ role: 'borrower' }] },
    ],
  ])('reads %s as stating no position, rather than refusing the file', (_name, extra) => {
    const file = parseRecoveryFile(fileJson(extra))

    // The rest of the document survives, which a throw at parse time does not
    // allow: `UploadStep` only shows the message and the wizard goes nowhere.
    expect(file.outputDescriptor).toBe(RANGED_EQUIVALENT_DESCRIPTOR)

    const resolved = resolveCosignerPositions(
      parseDescriptor(file.outputDescriptor),
      file.cosigners,
    )
    expect(resolved.keys.map((key) => key.childDerivation)).toEqual(['0/*', '0/*', '0/*'])
  })

  it('keeps an entry with no role, and still places its leg', () => {
    // Nothing is lost by keeping it: `resolveCosignerPositions` reads only
    // `fingerprint` and `keyIndex`, so this entry is as usable as a complete
    // one and refusing it withheld a position the file successfully stated.
    const file = parseRecoveryFile(
      fileJson({ cosigners: [{ fingerprint: BORROWER_FINGERPRINT, keyIndex: 1 }] }),
    )

    expect(file.cosigners).toEqual([
      { role: '', fingerprint: BORROWER_FINGERPRINT, keyIndex: 1 },
    ])

    const resolved = resolveCosignerPositions(
      parseDescriptor(file.outputDescriptor),
      file.cosigners,
    )
    expect(suffixFor(resolved, BORROWER_FINGERPRINT)).toBe('0/1')
  })

  it.each([
    [
      'an entry stating a position with no fingerprint to attach it to',
      { cosigners: [{ role: 'borrower', keyIndex: 1 }] },
    ],
    [
      'a keyIndex that is not a number',
      { cosigners: [{ role: 'borrower', fingerprint: 'aaaaaaaa', keyIndex: '1' }] },
    ],
    [
      'a fractional keyIndex',
      { cosigners: [{ role: 'borrower', fingerprint: 'aaaaaaaa', keyIndex: 1.5 }] },
    ],
    [
      'a negative keyIndex',
      { cosigners: [{ role: 'borrower', fingerprint: 'aaaaaaaa', keyIndex: -1 }] },
    ],
    [
      'a hardened keyIndex, which an extended public key cannot derive',
      { cosigners: [{ role: 'borrower', fingerprint: 'aaaaaaaa', keyIndex: 0x80000000 }] },
    ],
    ['an escrow address that is not a string', { escrowAddress: 42 }],
  ])('refuses %s', (_name, extra) => {
    expect(() => parseRecoveryFile(fileJson(extra))).toThrow(RecoveryError)
  })
})
