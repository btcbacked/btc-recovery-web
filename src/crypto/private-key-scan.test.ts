/**
 * The gate the "keep this secret" warning hangs on.
 *
 * Every case here is written as a string, never as a parsed descriptor, because
 * the bug being locked out was a check that read parsed output. The strings
 * that matter most are the ones no parser will accept.
 */
import { describe, it, expect } from 'vitest'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { provablyPublicOnly } from './private-key-scan'
import { bitcoin, ecc } from './bitcoin-lib'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const bip32 = BIP32Factory(ecc)
const mainnetNode = bip32.fromSeed(Buffer.alloc(32, 0x11), bitcoin.networks.bitcoin)
const testnetNode = bip32.fromSeed(Buffer.alloc(32, 0x11), bitcoin.networks.testnet)

const XPRV = mainnetNode.toBase58()
const TPRV = testnetNode.toBase58()
const XPUB = mainnetNode.neutered().toBase58()
const TPUB = testnetNode.neutered().toBase58()

/**
 * The predicate the silence hangs on.
 *
 * Every case here is written from the other side of the question: not "did we
 * spot a key" but "can we prove there is not one". A shape nobody anticipated
 * has to land in the warning, not in the silence.
 */
describe('provablyPublicOnly', () => {
  const PUBLIC_ONLY =
    `wsh(sortedmulti(2,[aaaaaaaa/48'/0'/0'/2']${XPUB}/0/*,` +
    `[bbbbbbbb/48'/0'/0'/2']${XPUB}/0/*))#checksum`

  it('proves a descriptor of extended public keys carries no key material', () => {
    expect(provablyPublicOnly(PUBLIC_ONLY)).toBe(true)
    expect(provablyPublicOnly(`wsh(sortedmulti(2,${TPUB}/0/*))`)).toBe(true)
    // Leg count is not evidence of anything. Accounting for every token must
    // not drift into warning on any descriptor that simply has several.
    expect(
      provablyPublicOnly(`wsh(sortedmulti(3,${XPUB}/0/*,${XPUB}/0/*,${XPUB}/0/*,${XPUB}/0/*))`),
    ).toBe(true)
  })

  it('refuses to prove anything about a string holding an extended private key', () => {
    expect(provablyPublicOnly(`wsh(multi(2,[aaaaaaaa/48'/1'/0'/2']${TPRV}/0/1))`)).toBe(false)
  })

  /**
   * Every long token has to be accounted for, not just the first one found.
   *
   * A real escrow leg carries the customer's key wherever `sortedmulti` put it,
   * and origin brackets are all short, so the first long run in a descriptor is
   * whichever key was written first. If only that one were examined the answer
   * would flip on key ORDER, which is the one thing nobody would think to
   * check: the same customer, the same file, silent on one contract and warned
   * on the next. The public key in front is deliberate. It is a run that
   * genuinely passes, so a check that stops at the first success certifies the
   * private key it never looked at.
   */
  it('refuses to prove anything when the private key is not the first long token', () => {
    expect(
      provablyPublicOnly(
        `wsh(sortedmulti(2,[aaaaaaaa/48'/1'/0'/2']${TPUB}/0/*,[bbbbbbbb/48'/1'/0'/2']${TPRV}/0/*))`,
      ),
    ).toBe(false)
  })

  /**
   * The same failure with more room to hide in: four legs, and the private key
   * is the third. Two legs can only distinguish "first" from "not first"; this
   * one also rules out a check that looks at the ends and skips the middle.
   */
  it('refuses to prove anything when the private key is buried mid descriptor', () => {
    const leg = (fp: string, key: string) => `[${fp}/48'/1'/0'/2']${key}/0/*`
    expect(
      provablyPublicOnly(
        `wsh(sortedmulti(3,${leg('aaaaaaaa', TPUB)},${leg('bbbbbbbb', TPUB)},` +
          `${leg('cccccccc', TPRV)},${leg('dddddddd', TPUB)}))#checksum`,
      ),
    ).toBe(false)
  })

  /**
   * The whole reason this is proof and not a detector. Each of these is key
   * material an extended key pattern does not describe, so negating such a
   * pattern would call every one of them safe and take the warning off screen.
   */
  it('refuses to prove anything about key shapes the detector cannot see', () => {
    // A WIF key, which no extended key pattern would match.
    expect(provablyPublicOnly('L1aW4aubDFB7yfras2S1mN3bqg9no1s2GBGjkYqZKKKKKKKKKKKK')).toBe(false)
    // A raw hex private key.
    expect(provablyPublicOnly(`priv ${'a1b2c3d4'.repeat(8)}`)).toBe(false)
    // A private prefix from a wallet nobody has told this module about yet.
    expect(provablyPublicOnly(`wsh(Mprv${XPRV.slice(4)})`)).toBe(false)
  })

  it('refuses to prove anything about a public key with something spliced onto it', () => {
    // Anchoring at both ends is what makes this proof rather than a hint: a
    // token that merely starts with a key it recognises is not accounted for.
    expect(provablyPublicOnly(`${XPUB}TRAILINGGARBAGE`)).toBe(false)
    expect(provablyPublicOnly(`GARBAGE${XPUB}`)).toBe(false)
  })

  /**
   * The leading anchor on its own, because what it rules out is not garbage.
   *
   * Unanchored at the start, the pattern matches a public key found ANYWHERE
   * inside a token and reports the whole run as public. So an `xprv` running
   * straight into an `xpub`, which is what a line wrap eaten by a copy or a
   * concatenated pair renders as, would read as proof of safety while the
   * private key sits in the same token. The warning would come off the screen
   * that is showing the key.
   */
  it('refuses to prove a token public because a public key appears later inside it', () => {
    expect(provablyPublicOnly(`${XPRV}${XPUB}`)).toBe(false)
  })

  /**
   * Recorded so that the loose trailing length is a decision rather than an
   * accident. A shortened extended PUBLIC key is still public material, and
   * nothing spendable hides behind a prefix that says `pub`. Truncation only
   * has to break the proof when it could be hiding key material, which is the
   * `prv` case, and that one fails the anchored match anyway.
   */
  it('still proves a shortened public key safe, because it is still public', () => {
    expect(provablyPublicOnly(XPUB.slice(0, 60))).toBe(true)
    expect(provablyPublicOnly(XPRV.slice(0, 60))).toBe(false)
  })

  it('proves nothing about a string with no keys in it at all', () => {
    // No key to point at is not the same as proof that none is present, and on
    // spendable funds those two have to be told apart. An empty string is the
    // degenerate case of exactly that.
    expect(provablyPublicOnly('')).toBe(false)
    expect(provablyPublicOnly('Paste your key here.')).toBe(false)
  })

  /**
   * A seed phrase is the case that most clearly separates proof from detection.
   * No pattern for extended keys describes it, so any detector reports clean
   * and a silence gated on one would print it bare. Here it simply fails to be
   * proof, like everything else nobody thought of.
   */
  it('proves nothing about a seed phrase, which no key pattern would describe', () => {
    expect(provablyPublicOnly(`${'abandon '.repeat(11)}about`)).toBe(false)
  })

  /**
   * The prefix set, asserted in the direction that fails quietly. A private
   * prefix left out of a detector shows a warning it should not have skipped,
   * which is loud. A PUBLIC prefix left out here makes an ordinary device path
   * descriptor unprovable, and every one of those customers is told a key is on
   * screen when none is. That is the failure nobody would report as a bug.
   */
  it('proves the SLIP-132 public prefixes other wallets emit', () => {
    for (const prefix of ['ypub', 'zpub', 'upub', 'vpub', 'Ypub', 'Zpub', 'Upub', 'Vpub']) {
      expect(provablyPublicOnly(`wsh(${prefix}${XPUB.slice(4)}/0/*)`)).toBe(true)
    }
  })
})
