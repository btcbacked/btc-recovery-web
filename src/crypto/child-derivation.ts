import type { BIP32Interface } from 'bip32'
import { RecoveryError, ESCROW_UNSUPPORTED } from './errors'
import type { ParsedDescriptor, ParsedKeyEntry } from './descriptor-parser'
import type { RecoveryFileCosigner } from './recovery-file'

/**
 * The child derivation a descriptor names for ONE key, resolved to indices.
 *
 * A descriptor key is written `[fp/origin]xpub/<child derivation>`. The child
 * derivation is per key, not per descriptor: `sortedmulti` is free to pin each
 * cosigner to a different suffix.
 *
 * That is not hypothetical. In the LEGACY escrow shape the per contract branch
 * sits in the child suffix rather than the origin bracket, so a leg reads
 * `[fp/48h/1h/0h/2h]tpub.../0/N` and the whole path is 6 levels. Two funded
 * production escrows are in that shape, with their borrower legs pinned at
 * `/0/1` and `/0/2` while the platform leg still ranges. (The folded 8 level
 * shape, which puts the branch in the origin bracket and keeps `/0/*` as the
 * suffix, has never shipped. Nothing here depends on it either way.)
 *
 * Every place that turns a descriptor key into a public key has to resolve the
 * suffix the same way, or the address, the PSBT and the signature disagree.
 * That is what this module is for: one resolver, used by address derivation and
 * by the PSBT builder, so a fix cannot land in one and miss the other.
 */

/** The plain ranged suffix an ordinary escrow uses. */
export const RANGED_CHILD_DERIVATION = '0/*'

/**
 * Exactly two components, because that is the shape the whole pipeline agrees
 * on. `psbt-signer.ts` locates a key by taking the last two components of the
 * BIP32 path in the PSBT, so a suffix of any other length would derive one key
 * for the address and sign with another. Rejecting here fails closed and loudly
 * instead, at the point where the address is derived, rather than producing a
 * signature against the wrong key.
 *
 * The refusal is what makes that safe, not the address it withholds. Nothing
 * downstream compares a PSBT against the escrow address to decide whether the
 * PSBT belongs to this escrow. Downstream of derivation NO CONSUMER CHECKS it:
 * `psbt-builder.ts` spends to it as the change output and `psbt-finalizer.ts`
 * labels an output as change with it, and neither compares it against anything,
 * so an address handed back after a refusal would be checked by nobody. What
 * actually stops the wrong signature is that the wizard's signing guards are
 * then left with no address to run with.
 *
 * `deriveEscrowAddress` checks a derived address against the one the recovery
 * file records, but that is a check ON the address, not a consumer of it, and
 * it never runs on a refusal: there is no address to compare.
 */
const REQUIRED_COMPONENT_COUNT = 2

/**
 * What the customer reads when this module refuses.
 *
 * `ESCROW_UNSUPPORTED` and not a copy of it. `UnsupportedEscrowNotice` renders
 * the same constant and is on screen at the same time on several steps, so two
 * accounts of one fact cannot appear: they are one string. This module used to
 * hold its own byte for byte duplicate, which is exactly the drift the constant
 * exists to prevent.
 */
function reject(childDerivation: string, reason: string): never {
  throw new RecoveryError(
    'DESCRIPTOR_ERROR',
    ESCROW_UNSUPPORTED,
    `Unsupported child derivation "${childDerivation}": ${reason}`,
  )
}

/**
 * The child indices to derive below one descriptor key for an address index.
 *
 * `*` takes the address index. A number is a fixed child and ignores the
 * address index entirely, which is the case this tool used to get wrong.
 */
export function childIndices(
  childDerivation: string,
  addressIndex: number,
): number[] {
  const components = childDerivation.split('/')

  if (components.length !== REQUIRED_COMPONENT_COUNT) {
    reject(
      childDerivation,
      `expected ${REQUIRED_COMPONENT_COUNT} components, found ${childDerivation === '' ? 0 : components.length}`,
    )
  }

  // Checked whether or not a wildcard is present. A caller that asks for an
  // index this tool cannot derive is wrong about the whole request, and a
  // pinned suffix quietly returning a valid address for it would hide that.
  if (!Number.isInteger(addressIndex) || addressIndex < 0) {
    reject(childDerivation, `address index ${addressIndex} is not a non-negative integer`)
  }
  if (addressIndex >= 0x80000000) {
    reject(childDerivation, `address index ${addressIndex} is in the hardened range`)
  }

  // BIP-380 allows a wildcard only as the final step. Anywhere else it is not a
  // range, and filling it in would invent a key: `*/*` resolved componentwise
  // gives `[0, 0]` at index 0, which is the exact address the old code produced
  // for every escrow. Refusing keeps that address from coming back wearing a
  // notice that says it can be trusted.
  const wildcardPosition = components.indexOf('*')
  if (wildcardPosition !== -1 && wildcardPosition !== components.length - 1) {
    reject(childDerivation, 'a wildcard is only allowed as the last component')
  }

  return components.map((component) => {
    if (component === '*') return addressIndex

    // A hardened child cannot be derived from an extended PUBLIC key, and a
    // descriptor carries public keys for every cosigner but the user's own.
    // Catch the marker explicitly: parseInt("0'") returns 0 and would silently
    // derive a different, unhardened key.
    if (/['hH]/.test(component)) {
      reject(childDerivation, `component "${component}" is hardened`)
    }

    if (!/^\d+$/.test(component)) {
      reject(childDerivation, `component "${component}" is neither a number nor a wildcard`)
    }

    const value = Number(component)
    if (value >= 0x80000000) {
      reject(childDerivation, `component "${component}" is in the hardened range`)
    }
    return value
  })
}

/**
 * Fill in each ranged key's wildcard from the positions the file records.
 *
 * The descriptor is left alone and a resolved copy is returned, because a
 * position that a wallet cannot be trusted with is exactly why the platform
 * stopped writing it into the descriptor: a descriptor with fixed child
 * positions was bench tested against Sparrow, which imported it, flattened it
 * to raw pubkeys, derived every leg at index 0 anyway and showed a confidently
 * wrong address. So the positions travel beside the descriptor and only a
 * reader that opts in, here, applies them.
 *
 * The output is an ordinary `ParsedDescriptor` whose ranged legs have become
 * pinned ones, which is a shape every consumer downstream already handles:
 * `deriveChildNode` derives it, `childPathSuffix` writes it into a PSBT, and
 * the signer finds the key by the same two components. Nothing else has to
 * learn about `cosigners` at all.
 *
 * THE SIX RULES, stated here because this is the only place they are written
 * down that ships. Spec section 3.6 has them too, but that spec lives in
 * another repo on an unmerged branch and has never been released, so it is a
 * reference and not an authority. The `// Rule N.` markers below say which line
 * implements which.
 *
 *  1. A leg the descriptor already pins to a fixed child keeps it: the
 *     descriptor wins over any `keyIndex` that disagrees with it.
 *  2. Only the ranged `0/*` suffix is a wildcard for a position to fill in.
 *  3. A raw pubkey leg takes no `keyIndex`. Holds by construction here, because
 *     `ParsedKeyEntry` can only carry an extended key, so such a leg never
 *     reaches this function. It is DROPPED at parse time instead, which is the
 *     hazard written down in `cosigner-positions.test.ts`.
 *  4. `keyIndex: null` means unknown, and unknown is never 0, so the leg keeps
 *     its wildcard. NOT IMPLEMENTED: the rule also offers a scanning fallback,
 *     trying child indices until one reproduces the escrow address. This reader
 *     does not scan. An unknown leg is derived at index 0 and the
 *     `escrowAddress` check in `address.ts` is the only thing that catches it.
 *  5. No array, an empty array, and a leg the array does not mention all mean
 *     the same as unknown.
 *  6. Legs and entries are joined by fingerprint, folded to lowercase on both
 *     sides. A fingerprint naming more than one leg, or claimed by more than one
 *     entry, collapses to unknown rather than letting the first or the last one
 *     win. NOT IMPLEMENTED: the rule breaks that tie by also joining on `role`,
 *     which is the two legs sharing a fingerprint case the backend documents at
 *     `recovery-package-response.dto.ts:63-67`. This reader fails closed and
 *     leaves both legs ranged. The rule also warns against comparing
 *     `userKey.fingerprint` with `cosigners[].fingerprint`; nothing here reads
 *     `userKey` at all, so that half cannot be got wrong.
 */
export function resolveCosignerPositions(
  parsed: ParsedDescriptor,
  cosigners: readonly RecoveryFileCosigner[] | null | undefined,
): ParsedDescriptor {
  // Rule 5.
  if (!cosigners || cosigners.length === 0) return parsed

  // Rule 6, from the descriptor's side.
  const legsPerFingerprint = new Map<string, number>()
  for (const key of parsed.keys) {
    const fingerprint = key.fingerprint.toLowerCase()
    legsPerFingerprint.set(fingerprint, (legsPerFingerprint.get(fingerprint) ?? 0) + 1)
  }

  // Rule 6, from the array's side. Two entries naming one fingerprint is the
  // same ambiguity read from the other end, so it collapses to unknown rather
  // than letting whichever entry came last decide.
  const positions = new Map<string, number | null>()
  for (const cosigner of cosigners) {
    const fingerprint = cosigner.fingerprint.toLowerCase()
    positions.set(fingerprint, positions.has(fingerprint) ? null : cosigner.keyIndex)
  }

  return {
    ...parsed,
    keys: parsed.keys.map((key) => {
      // Rules 1 and 2.
      if (key.childDerivation !== RANGED_CHILD_DERIVATION) return key

      const fingerprint = key.fingerprint.toLowerCase()
      // Rule 6.
      if (legsPerFingerprint.get(fingerprint) !== 1) return key

      // Rule 4, and rule 5 again for a leg the array does not mention.
      const keyIndex = positions.get(fingerprint)
      if (keyIndex === undefined || keyIndex === null) return key

      return { ...key, childDerivation: `0/${keyIndex}` }
    }),
  }
}

/**
 * The BIP32 node one descriptor key contributes to an address.
 *
 * `node` is the key as the descriptor writes it, at its origin path. The
 * returned node is its child at the suffix the descriptor names for THIS key.
 */
export function deriveChildNode(
  node: BIP32Interface,
  key: Pick<ParsedKeyEntry, 'childDerivation'>,
  addressIndex: number,
): BIP32Interface {
  return childIndices(key.childDerivation, addressIndex).reduce(
    (current, childIndex) => current.derive(childIndex),
    node,
  )
}

/**
 * The suffix to append to a key's origin path to name the child that was
 * derived, e.g. `/0/1`. This is what goes into a PSBT's `bip32Derivation`, and
 * it has to describe the same child `deriveChildNode` returned.
 */
export function childPathSuffix(
  key: Pick<ParsedKeyEntry, 'childDerivation'>,
  addressIndex: number,
): string {
  return childIndices(key.childDerivation, addressIndex)
    .map((childIndex) => `/${childIndex}`)
    .join('')
}
