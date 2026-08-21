/**
 * Can we prove a rendered string carries no key material?
 *
 * Read the string, not a parse of it. That distinction is why this module
 * exists, because the opposite was shipped: the "keep this secret" warning on
 * the wallet guide was gated on `parsedDescriptor`, which is null exactly when
 * the descriptor failed to parse. So the one screen a customer reaches when
 * something has already gone wrong was the one screen that printed their `xprv`
 * with nothing beside it saying what it was.
 *
 * One function, and it is deliberately not a detector. A `containsPrivateKey`
 * pattern lived here and was deleted once nothing called it: a fuzzy matcher in
 * the crypto barrel is an invitation to reach for it when what is wanted is a
 * fact, which is the defect this module was written to remove. Anything needing
 * to know which path a customer is on reads `keySource` off the recovery file.
 */

/**
 * A whole token that is a recognised extended PUBLIC key and nothing else.
 *
 * Anchored at both ends, and that is what makes it proof rather than a hint. An
 * unanchored match would pass a key with something spliced onto it.
 *
 * The prefix set covers the SLIP-132 variants wallets emit as well as the
 * standard two. Narrowing it does not fail loudly: it makes ordinary device
 * path descriptors unprovable, and every one of those customers gets a warning
 * telling them a key is on screen when none is. Base58's alphabet (no 0, O, I
 * or l) is spelled out rather than approximated with \w.
 */
const EXTENDED_PUBLIC_KEY = /^[xtyzuvYZUV]pub[1-9A-HJ-NP-Za-km-z]{50,}$/

/**
 * Every alphanumeric run long enough to hide key material in.
 *
 * Twenty is chosen against the two populations it has to separate. Descriptor
 * syntax tops out at `sortedmulti` (11) and fingerprints are 8, so nothing
 * structural reaches it. The shortest thing that could be a secret is a WIF key
 * at 51. Greedy `{20,}` takes maximal runs, so a token is never examined as a
 * fragment of itself.
 */
const LONG_RUN = /[0-9A-Za-z]{20,}/g

/**
 * True only on positive proof that the string holds nothing spendable.
 *
 * This is the inverse of the obvious design, and the inversion is the safety
 * property. Gating a silence on a detector means a shape the detector does not
 * know about reads as "no key here", so every gap in the pattern becomes a
 * silent screen. That is failing open, on spendable funds.
 *
 * So the question is asked from the other side: account for everything in the
 * string long enough to be a secret, and require every one of those to be
 * something positively recognised as public. A string qualifies only if it
 * contains at least one extended public key and nothing else of any length that
 * could hold key material.
 *
 * The consequence is that anything unrecognised keeps the warning up: a WIF
 * key, a raw hex key, a truncated or line wrapped extended key, a private
 * prefix nobody has told us about yet, a bare address, a bech32 blob, an empty
 * string with nothing to vouch for. None of those are enumerated here, which is
 * the point. They fail to be proof rather than needing to be predicted.
 */
export function provablyPublicOnly(text: string): boolean {
  const runs = text.match(LONG_RUN)
  if (!runs) return false
  return runs.every((run) => EXTENDED_PUBLIC_KEY.test(run))
}
