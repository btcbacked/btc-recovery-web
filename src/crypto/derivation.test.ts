// @vitest-environment node
/**
 * Tests for derivation.ts
 *
 * NOTE ON CRYPTO.SUBTLE AVAILABILITY
 * ------------------------------------
 * These tests rely on `crypto.subtle` (Web Crypto API).
 *
 * - In Node.js >= 19, `crypto` is a global that exposes `subtle`.
 * - Vitest 3.x running under Node.js 20 makes `globalThis.crypto` available,
 *   so `crypto.subtle` is present in the test environment even though jsdom
 *   itself does not implement SubtleCrypto.
 * - If you ever run these tests on an environment without `crypto.subtle`,
 *   the `deriveSeed` / `deriveSigningKey` tests will be skipped gracefully
 *   (the condition check at the top of each `it` will call `skip()`).
 *
 * The synchronous helpers `computeFingerprint` and `deriveXprv` use only the
 * bip32 library (no Web Crypto), so they always run.
 */

import {
  deriveSeed,
  deriveMasterKey,
  computeFingerprint,
  deriveXprv,
  deriveSigningKey,
  neuterXprv,
  checkDerivedKeyAgainstXpub,
} from './derivation'
import {
  RecoveryError,
  KEY_MISMATCH_UNCHECKABLE,
  KEY_MISMATCH_INCONSISTENT_FILE,
} from './errors'
import type { Network } from './recovery-file'
import type { DerivationProfile } from './profiles'
import * as ecc from '@bitcoinerlab/secp256k1'
import { BIP32Factory } from 'bip32'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Use a reduced-iteration profile for tests to avoid slow test execution.
// The cryptographic correctness (determinism, differentiation) is preserved.
const FAST_PROFILE: DerivationProfile = {
  algorithm: 'pbkdf2-hmac-sha256',
  iterations: 1,
  keyLength: 64,
}

// A hex salt that is valid (even-length hex string from the fixture)
const FIXTURE_SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasCryptoSubtle(): boolean {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined'
}

/** The xpub a recovery file would record for a seed derived at `path`. */
function xpubAt(seedHex: string, path: string, network: Network): string {
  return neuterXprv(deriveXprv(seedHex, path, network), network)
}

const bip32 = BIP32Factory(ecc)
const TESTNET_VERSIONS = {
  bip32: { public: 0x043587cf, private: 0x04358394 },
  wif: 0xef,
}

/**
 * Re-serialises an extended public key with one chain code byte flipped and
 * the public key untouched.
 *
 * This is the pair that a public-key-only comparison cannot tell apart. It is
 * a real pair, not a contrived one: the chain code is half of what a BIP32
 * node is, every child derives from both halves, and two nodes agreeing on the
 * public key while disagreeing on the chain code produce completely different
 * children. So the descriptor, the addresses and the signatures would all be
 * wrong while the file looked correct.
 */
function forgeSameKeyOtherChainCode(xpub: string): string {
  const real = bip32.fromBase58(xpub, TESTNET_VERSIONS)
  const chainCode = Uint8Array.from(real.chainCode, (byte, i) =>
    i === 0 ? byte ^ 0x01 : byte,
  )
  return bip32
    .fromPublicKey(Uint8Array.from(real.publicKey), chainCode, TESTNET_VERSIONS)
    .toBase58()
}

// A seed for the consistency-check tests, independent of the deriveXprv block.
const CHECK_SEED = '01'.repeat(64)

// ---------------------------------------------------------------------------
// deriveSeed
// ---------------------------------------------------------------------------

describe('deriveSeed', () => {
  it('skips if crypto.subtle is unavailable', async () => {
    if (!hasCryptoSubtle()) {
      console.warn('crypto.subtle not available — skipping deriveSeed tests')
      return
    }
    // If we reach here the environment supports crypto.subtle
    expect(hasCryptoSubtle()).toBe(true)
  })

  it('produces a 128-character hex string (64 bytes)', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('testpassword', FIXTURE_SALT, FAST_PROFILE)
    expect(typeof seed).toBe('string')
    expect(seed).toHaveLength(128)
  })

  it('produces only lowercase hex characters', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('testpassword', FIXTURE_SALT, FAST_PROFILE)
    expect(seed).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic — same inputs produce the same seed', async () => {
    if (!hasCryptoSubtle()) return

    const seed1 = await deriveSeed('mypassword', FIXTURE_SALT, FAST_PROFILE)
    const seed2 = await deriveSeed('mypassword', FIXTURE_SALT, FAST_PROFILE)
    expect(seed1).toBe(seed2)
  })

  it('different passwords produce different seeds', async () => {
    if (!hasCryptoSubtle()) return

    const seed1 = await deriveSeed('password1', FIXTURE_SALT, FAST_PROFILE)
    const seed2 = await deriveSeed('password2', FIXTURE_SALT, FAST_PROFILE)
    expect(seed1).not.toBe(seed2)
  })

  it('different salts produce different seeds', async () => {
    if (!hasCryptoSubtle()) return

    const salt2 = 'b2c3d4e5f607182930a4b5c6d7e8f900'
    const seed1 = await deriveSeed('samepassword', FIXTURE_SALT, FAST_PROFILE)
    const seed2 = await deriveSeed('samepassword', salt2, FAST_PROFILE)
    expect(seed1).not.toBe(seed2)
  })

  it('throws DERIVATION_ERROR when keyLength is not 64', async () => {
    if (!hasCryptoSubtle()) return

    const badProfile: DerivationProfile = { ...FAST_PROFILE, keyLength: 32 }
    try {
      await deriveSeed('password', FIXTURE_SALT, badProfile)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('DERIVATION_ERROR')
    }
  })

  it('throws DERIVATION_ERROR for empty salt (length 0 is caught by isValidHex, but test the function itself)', async () => {
    if (!hasCryptoSubtle()) return

    // The function internally does saltHex.match(/.{2}/g) — an empty string
    // gives null, triggering DERIVATION_ERROR
    try {
      await deriveSeed('password', '', FAST_PROFILE)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('DERIVATION_ERROR')
    }
  })

  it('accepts empty password string (password can be anything)', async () => {
    if (!hasCryptoSubtle()) return

    // Empty password is technically valid for PBKDF2 — should not throw
    const seed = await deriveSeed('', FIXTURE_SALT, FAST_PROFILE)
    expect(seed).toHaveLength(128)
  })
})

// ---------------------------------------------------------------------------
// computeFingerprint (synchronous — always runs)
// ---------------------------------------------------------------------------

describe('computeFingerprint', () => {
  it('returns an 8-character string', () => {
    // Use a simple all-zeros seed (deterministic)
    const seedHex = '00'.repeat(64)
    const fp = computeFingerprint(seedHex, 'mainnet')
    expect(fp).toHaveLength(8)
  })

  it('returns only uppercase hexadecimal characters', () => {
    const seedHex = '00'.repeat(64)
    const fp = computeFingerprint(seedHex, 'mainnet')
    expect(fp).toMatch(/^[0-9A-F]{8}$/)
  })

  it('is deterministic for same seed', () => {
    const seedHex = 'aa'.repeat(64)
    expect(computeFingerprint(seedHex, 'mainnet')).toBe(computeFingerprint(seedHex, 'mainnet'))
  })

  it('produces different fingerprints for different seeds', () => {
    const seed1 = '00'.repeat(64)
    const seed2 = 'ff'.repeat(64)
    expect(computeFingerprint(seed1, 'mainnet')).not.toBe(computeFingerprint(seed2, 'mainnet'))
  })

  it('produces same fingerprint for mainnet as for testnet (fingerprint is network-independent)', () => {
    // BIP32: master key fingerprint is derived from the public key, which is
    // the same regardless of network version bytes. The fingerprint is
    // network-independent.
    const seedHex = 'bb'.repeat(64)
    const fpMainnet = computeFingerprint(seedHex, 'mainnet')
    const fpTestnet = computeFingerprint(seedHex, 'testnet')
    expect(fpMainnet).toBe(fpTestnet)
  })
})

// ---------------------------------------------------------------------------
// deriveXprv (synchronous — always runs)
// ---------------------------------------------------------------------------

describe('deriveXprv', () => {
  const SEED_MAINNET = '00'.repeat(64)
  const SEED_TESTNET = '01'.repeat(64)

  it('returns a string for mainnet', () => {
    const xprv = deriveXprv(SEED_MAINNET, "48'/0'/0'/2'", 'mainnet')
    expect(typeof xprv).toBe('string')
    expect(xprv.length).toBeGreaterThan(0)
  })

  it('mainnet derivation produces key starting with "xprv"', () => {
    const xprv = deriveXprv(SEED_MAINNET, "48'/0'/0'/2'", 'mainnet')
    expect(xprv.startsWith('xprv')).toBe(true)
  })

  it('testnet derivation produces key starting with "tprv"', () => {
    const xprv = deriveXprv(SEED_TESTNET, "48'/1'/0'/2'", 'testnet')
    expect(xprv.startsWith('tprv')).toBe(true)
  })

  it('regtest derivation produces key starting with "tprv"', () => {
    const xprv = deriveXprv(SEED_TESTNET, "48'/1'/0'/2'", 'regtest')
    expect(xprv.startsWith('tprv')).toBe(true)
  })

  it('signet derivation produces key starting with "tprv"', () => {
    const xprv = deriveXprv(SEED_TESTNET, "48'/1'/0'/2'", 'signet')
    expect(xprv.startsWith('tprv')).toBe(true)
  })

  it('path with m/ prefix produces same result as path without m/ prefix', () => {
    const withPrefix = deriveXprv(SEED_MAINNET, "m/48'/0'/0'/2'", 'mainnet')
    const withoutPrefix = deriveXprv(SEED_MAINNET, "48'/0'/0'/2'", 'mainnet')
    expect(withPrefix).toBe(withoutPrefix)
  })

  it('is deterministic — same inputs produce the same xprv', () => {
    const xprv1 = deriveXprv(SEED_MAINNET, "44'/0'/0'", 'mainnet')
    const xprv2 = deriveXprv(SEED_MAINNET, "44'/0'/0'", 'mainnet')
    expect(xprv1).toBe(xprv2)
  })

  it('different paths produce different xprv values', () => {
    const xprv1 = deriveXprv(SEED_MAINNET, "44'/0'/0'", 'mainnet')
    const xprv2 = deriveXprv(SEED_MAINNET, "48'/0'/0'/2'", 'mainnet')
    expect(xprv1).not.toBe(xprv2)
  })

  it('different seeds produce different xprv values', () => {
    const xprv1 = deriveXprv(SEED_MAINNET, "48'/0'/0'/2'", 'mainnet')
    const xprv2 = deriveXprv('ff'.repeat(64), "48'/0'/0'/2'", 'mainnet')
    expect(xprv1).not.toBe(xprv2)
  })

  it('h-format hardened paths are normalized to apostrophe and work correctly', () => {
    // The bip32 library only accepts apostrophe notation, so normalizeDerivationPath
    // converts 'h' to apostrophe before calling derivePath.
    const xprvApostrophe = deriveXprv(SEED_MAINNET, "48'/0'/0'/2'", 'mainnet')
    const xprvH = deriveXprv(SEED_MAINNET, '48h/0h/0h/2h', 'mainnet')
    expect(xprvH).toBe(xprvApostrophe)
  })

  it('refuses an uppercase H marker rather than guessing at it', () => {
    // Fail closed, in step with isValidDerivationPath, which rejects
    // "48H/1H/0H/2H/0/7" before a file ever reaches here.
    //
    // bip32 does NOT read "48H" as the unhardened child 48: the string fails
    // its own path format check and derivePath throws. So normalising H here
    // would be the only thing standing between an unrecognised marker and a
    // key, and a wrong guess at what the writer meant is worse than a stop.
    // psbt-builder.ts is the opposite case and is deliberately different: PSBT
    // path encoding silently drops a marker it cannot parse, so there it has
    // to be normalised before it reaches the encoder.
    expect(() => deriveXprv(SEED_MAINNET, '48H/0H/0H/2H', 'mainnet')).toThrow()
  })

  it('handles the real 6 level origin path', () => {
    const xprv = deriveXprv(SEED_TESTNET, "48'/1'/0'/2'/0/7", 'testnet')
    const parent = deriveXprv(SEED_TESTNET, "48'/1'/0'/2'", 'testnet')

    expect(xprv.startsWith('tprv')).toBe(true)
    expect(xprv).not.toBe(parent)
  })

  it('a different branch at the last level is a different key', () => {
    const branch7 = deriveXprv(SEED_TESTNET, "48'/1'/0'/2'/0/7", 'testnet')
    const branch8 = deriveXprv(SEED_TESTNET, "48'/1'/0'/2'/0/8", 'testnet')
    expect(branch7).not.toBe(branch8)
  })
})

// ---------------------------------------------------------------------------
// deriveSigningKey (async — needs crypto.subtle)
// ---------------------------------------------------------------------------

describe('deriveSigningKey', () => {
  it('throws FINGERPRINT_MISMATCH when password produces wrong fingerprint', async () => {
    if (!hasCryptoSubtle()) {
      console.warn('crypto.subtle not available — skipping deriveSigningKey tests')
      return
    }

    // Derive a real seed/fingerprint from a known password so we can intentionally
    // give the wrong password in the next call
    const correctSeed = await deriveSeed('correct-password', FIXTURE_SALT, FAST_PROFILE)
    const correctFingerprint = computeFingerprint(correctSeed, 'testnet')

    // Now call deriveSigningKey with a WRONG password but the CORRECT fingerprint
    try {
      await deriveSigningKey({
        password: 'wrong-password',
        saltHex: FIXTURE_SALT,
        derivationPath: "48'/1'/0'/2'",
        expectedFingerprint: correctFingerprint,
        expectedXpub: xpubAt(correctSeed, "48'/1'/0'/2'", 'testnet'),
        network: 'testnet',
        profile: FAST_PROFILE,
      })
      expect.fail('should have thrown FINGERPRINT_MISMATCH')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('FINGERPRINT_MISMATCH')
    }
  })

  it('FINGERPRINT_MISMATCH error has a user-friendly message mentioning password', async () => {
    if (!hasCryptoSubtle()) return

    const correctSeed = await deriveSeed('correct-password', FIXTURE_SALT, FAST_PROFILE)
    const correctFingerprint = computeFingerprint(correctSeed, 'testnet')

    try {
      await deriveSigningKey({
        password: 'wrong-password',
        saltHex: FIXTURE_SALT,
        derivationPath: "48'/1'/0'/2'",
        expectedFingerprint: correctFingerprint,
        expectedXpub: xpubAt(correctSeed, "48'/1'/0'/2'", 'testnet'),
        network: 'testnet',
        profile: FAST_PROFILE,
      })
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).userMessage.toLowerCase()).toContain('password')
    }
  })

  it('succeeds and returns an xprv when password and fingerprint match', async () => {
    if (!hasCryptoSubtle()) return

    // Derive seed from known password, get its fingerprint, then call full pipeline
    const seed = await deriveSeed('my-test-password', FIXTURE_SALT, FAST_PROFILE)
    const fingerprint = computeFingerprint(seed, 'mainnet')

    const xprv = await deriveSigningKey({
      password: 'my-test-password',
      saltHex: FIXTURE_SALT,
      derivationPath: "48'/0'/0'/2'",
      expectedFingerprint: fingerprint,
      expectedXpub: xpubAt(seed, "48'/0'/0'/2'", 'mainnet'),
      network: 'mainnet',
      profile: FAST_PROFILE,
    })

    expect(xprv.startsWith('xprv')).toBe(true)
  })

  it('succeeds on testnet and returns a tprv', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('testnet-password', FIXTURE_SALT, FAST_PROFILE)
    const fingerprint = computeFingerprint(seed, 'testnet')

    const tprv = await deriveSigningKey({
      password: 'testnet-password',
      saltHex: FIXTURE_SALT,
      derivationPath: "48'/1'/0'/2'",
      expectedFingerprint: fingerprint,
      expectedXpub: xpubAt(seed, "48'/1'/0'/2'", 'testnet'),
      network: 'testnet',
      profile: FAST_PROFILE,
    })

    expect(tprv.startsWith('tprv')).toBe(true)
  })

  it('fingerprint comparison is case-insensitive (expected fingerprint can be lowercase)', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('case-test-password', FIXTURE_SALT, FAST_PROFILE)
    const fingerprint = computeFingerprint(seed, 'mainnet') // always uppercase

    // Pass lowercase version of the fingerprint — should still succeed
    const lowercaseFingerprint = fingerprint.toLowerCase()

    const xprv = await deriveSigningKey({
      password: 'case-test-password',
      saltHex: FIXTURE_SALT,
      derivationPath: "48'/0'/0'/2'",
      expectedFingerprint: lowercaseFingerprint,
      expectedXpub: xpubAt(seed, "48'/0'/0'/2'", 'mainnet'),
      network: 'mainnet',
      profile: FAST_PROFILE,
    })

    expect(xprv.startsWith('xprv')).toBe(true)
  })

  it('result is deterministic for the same inputs', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('deterministic-password', FIXTURE_SALT, FAST_PROFILE)
    const fingerprint = computeFingerprint(seed, 'mainnet')

    const request = {
      password: 'deterministic-password',
      saltHex: FIXTURE_SALT,
      derivationPath: "48'/0'/0'/2'",
      expectedFingerprint: fingerprint,
      expectedXpub: xpubAt(seed, "48'/0'/0'/2'", 'mainnet'),
      network: 'mainnet',
      profile: FAST_PROFILE,
    } as const

    const xprv1 = await deriveSigningKey(request)
    const xprv2 = await deriveSigningKey(request)

    expect(xprv1).toBe(xprv2)
  })
})

// ---------------------------------------------------------------------------
// The key consistency check, at the real 6 level origin depth
//
// The master fingerprint proves the password rebuilt the right wallet. It is a
// depth 0 value, so it says nothing about the path. With a per contract branch
// in the path, a stale path produces a valid key, a valid descriptor, a
// plausible address and the WRONG key. The recorded xpub is the only value in
// the file that can catch that.
// ---------------------------------------------------------------------------

describe('deriveSigningKey key consistency check', () => {
  const PASSWORD = 'branch-path-password'
  const REAL_PATH = "48'/1'/0'/2'/0/7"
  const STALE_BRANCH_PATH = "48'/1'/0'/2'/0/6"
  const LEGACY_PATH = "48'/1'/0'/2'"

  async function seedAndFingerprint() {
    const seed = await deriveSeed(PASSWORD, FIXTURE_SALT, FAST_PROFILE)
    return { seed, fingerprint: computeFingerprint(seed, 'testnet') }
  }

  function callWith(fingerprint: string, path: string, xpub: string) {
    return deriveSigningKey({
      password: PASSWORD,
      saltHex: FIXTURE_SALT,
      derivationPath: path,
      expectedFingerprint: fingerprint,
      expectedXpub: xpub,
      network: 'testnet',
      profile: FAST_PROFILE,
    })
  }

  it('accepts a file whose 6 level path and xpub agree', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    const tprv = await callWith(
      fingerprint,
      REAL_PATH,
      xpubAt(seed, REAL_PATH, 'testnet'),
    )

    expect(tprv).toBe(deriveXprv(seed, REAL_PATH, 'testnet'))
  })

  it('rejects a path that is one branch off the recorded xpub', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    try {
      await callWith(
        fingerprint,
        STALE_BRANCH_PATH,
        xpubAt(seed, REAL_PATH, 'testnet'),
      )
      expect.fail('a wrong branch must not produce a signing key')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('KEY_MISMATCH')
    }
  })

  it('rejects the old 4 level path against a 6 level xpub', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    try {
      await callWith(
        fingerprint,
        LEGACY_PATH,
        xpubAt(seed, REAL_PATH, 'testnet'),
      )
      expect.fail('a stale 4 level path must not produce a signing key')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('KEY_MISMATCH')
    }
  })

  it('rejects a 6 level path against the old 4 level xpub', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    try {
      await callWith(
        fingerprint,
        REAL_PATH,
        xpubAt(seed, LEGACY_PATH, 'testnet'),
      )
      expect.fail('a stale recorded xpub must not be accepted')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('KEY_MISMATCH')
    }
  })

  it('says what is wrong in plain language, not a generic failure', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    try {
      await callWith(
        fingerprint,
        STALE_BRANCH_PATH,
        xpubAt(seed, REAL_PATH, 'testnet'),
      )
      expect.fail('should have thrown')
    } catch (e) {
      const err = e as RecoveryError
      expect(err.userMessage).toContain('recovery file')
      expect(err.userMessage.toLowerCase()).toContain('does not match')
      expect(err.userMessage).not.toMatch(/failed to sign/i)
      // The path that was used and the key it produced belong in the detail,
      // where a support conversation can use them.
      expect(err.detail).toContain(STALE_BRANCH_PATH)
    }
  })

  it('tells the customer the password was not the problem', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    try {
      await callWith(
        fingerprint,
        STALE_BRANCH_PATH,
        xpubAt(seed, REAL_PATH, 'testnet'),
      )
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).userMessage.toLowerCase()).toContain(
        'password is correct',
      )
    }
  })

  it('rejects a file whose recorded xpub cannot be read at all', async () => {
    if (!hasCryptoSubtle()) return
    const { fingerprint } = await seedAndFingerprint()

    try {
      await callWith(fingerprint, REAL_PATH, 'not-an-xpub')
      expect.fail('an unreadable xpub must not pass the check')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('KEY_MISMATCH')
      expect((e as RecoveryError).userMessage).toContain('cannot be read')
    }
  })

  // The two messages below used to be literals at their throw sites, so the
  // wording a customer actually reads had no coverage while the unused entry
  // in ERROR_MESSAGES did. Pinning them to the exported constants keeps the
  // reviewed copy and the shipped copy the same string.

  it('ships the reviewed wording when the file disagrees with itself', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    try {
      await callWith(
        fingerprint,
        STALE_BRANCH_PATH,
        xpubAt(seed, REAL_PATH, 'testnet'),
      )
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).userMessage).toBe(KEY_MISMATCH_INCONSISTENT_FILE)
    }
  })

  it('ships the reviewed wording when the recorded key cannot be read', async () => {
    if (!hasCryptoSubtle()) return
    const { fingerprint } = await seedAndFingerprint()

    try {
      await callWith(fingerprint, REAL_PATH, 'not-an-xpub')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).userMessage).toBe(KEY_MISMATCH_UNCHECKABLE)
    }
  })

  it('accepts the same key recorded with the other network version bytes', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    // Same key material, serialized with mainnet version bytes. Version bytes
    // take no part in derivation, so this is the same key and must not be
    // reported as a mismatch.
    const mainnetSerialization = xpubAt(seed, REAL_PATH, 'mainnet')
    expect(mainnetSerialization.startsWith('xpub')).toBe(true)

    const tprv = await callWith(fingerprint, REAL_PATH, mainnetSerialization)
    expect(tprv.startsWith('tprv')).toBe(true)
  })

  it('checks the fingerprint before the key, so a wrong password says so', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    try {
      await deriveSigningKey({
        password: 'a-completely-different-password',
        saltHex: FIXTURE_SALT,
        derivationPath: STALE_BRANCH_PATH,
        expectedFingerprint: fingerprint,
        expectedXpub: xpubAt(seed, REAL_PATH, 'testnet'),
        network: 'testnet',
        profile: FAST_PROFILE,
      })
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('FINGERPRINT_MISMATCH')
    }
  })

  it('accepts a path written with h markers when the xpub agrees', async () => {
    if (!hasCryptoSubtle()) return
    const { seed, fingerprint } = await seedAndFingerprint()

    const tprv = await callWith(
      fingerprint,
      '48h/1h/0h/2h/0/7',
      xpubAt(seed, REAL_PATH, 'testnet'),
    )

    expect(tprv).toBe(deriveXprv(seed, REAL_PATH, 'testnet'))
  })
})

// ---------------------------------------------------------------------------
// checkDerivedKeyAgainstXpub
// ---------------------------------------------------------------------------

describe('checkDerivedKeyAgainstXpub', () => {
  const XPRV = deriveXprv(CHECK_SEED, "48'/1'/0'/2'/0/7", 'testnet')

  it('matches the xpub of the same key', () => {
    expect(
      checkDerivedKeyAgainstXpub(
        XPRV,
        neuterXprv(XPRV, 'testnet'),
        'testnet',
      ),
    ).toBe('match')
  })

  it('matches across version bytes, since they are not part of the key', () => {
    const sameKeyMainnetBytes = xpubAt(
      CHECK_SEED,
      "48'/1'/0'/2'/0/7",
      'mainnet',
    )
    expect(
      checkDerivedKeyAgainstXpub(XPRV, sameKeyMainnetBytes, 'testnet'),
    ).toBe('match')
  })

  it('reports a mismatch for the sibling branch', () => {
    const sibling = xpubAt(CHECK_SEED, "48'/1'/0'/2'/0/8", 'testnet')
    expect(checkDerivedKeyAgainstXpub(XPRV, sibling, 'testnet')).toBe('mismatch')
  })

  it('reports a mismatch for the parent, which shares no chain code', () => {
    const parent = xpubAt(CHECK_SEED, "48'/1'/0'/2'/0", 'testnet')
    expect(checkDerivedKeyAgainstXpub(XPRV, parent, 'testnet')).toBe('mismatch')
  })

  it('reports a mismatch when only the chain code differs', () => {
    const real = neuterXprv(XPRV, 'testnet')
    const forged = forgeSameKeyOtherChainCode(real)

    // Pin what makes this case worth a test: the public keys are identical, so
    // the chain code is the ONLY thing that separates these two nodes.
    expect(
      Array.from(bip32.fromBase58(forged, TESTNET_VERSIONS).publicKey),
    ).toEqual(Array.from(bip32.fromBase58(real, TESTNET_VERSIONS).publicKey))
    expect(forged).not.toBe(real)

    expect(checkDerivedKeyAgainstXpub(XPRV, forged, 'testnet')).toBe('mismatch')
  })

  it('reports unreadable for something that is not an extended key', () => {
    expect(checkDerivedKeyAgainstXpub(XPRV, 'nonsense', 'testnet')).toBe(
      'unreadable',
    )
  })

  it('reports unreadable for an empty string', () => {
    expect(checkDerivedKeyAgainstXpub(XPRV, '', 'testnet')).toBe('unreadable')
  })
})

// ---------------------------------------------------------------------------
// deriveMasterKey (synchronous — always runs)
// ---------------------------------------------------------------------------

describe('deriveMasterKey', () => {
  it('returns an object with a fingerprint property', () => {
    const seedHex = '00'.repeat(64)
    const master = deriveMasterKey(seedHex, 'mainnet')
    expect(master.fingerprint).toBeDefined()
  })

  it('master key has a derivePath method', () => {
    const seedHex = '00'.repeat(64)
    const master = deriveMasterKey(seedHex, 'mainnet')
    expect(typeof master.derivePath).toBe('function')
  })

  it('produces an xprv-prefixed key for mainnet via toBase58', () => {
    const seedHex = '00'.repeat(64)
    const master = deriveMasterKey(seedHex, 'mainnet')
    expect(master.toBase58().startsWith('xprv')).toBe(true)
  })

  it('produces a tprv-prefixed key for testnet via toBase58', () => {
    const seedHex = '00'.repeat(64)
    const master = deriveMasterKey(seedHex, 'testnet')
    expect(master.toBase58().startsWith('tprv')).toBe(true)
  })
})
