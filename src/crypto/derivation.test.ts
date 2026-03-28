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

import { deriveSeed, deriveMasterKey, computeFingerprint, deriveXprv, deriveSigningKey } from './derivation'
import { RecoveryError } from './errors'
import type { DerivationProfile } from './profiles'

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
      await deriveSigningKey(
        'wrong-password',
        FIXTURE_SALT,
        "48'/1'/0'/2'",
        correctFingerprint,
        'testnet',
        FAST_PROFILE,
      )
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
      await deriveSigningKey(
        'wrong-password',
        FIXTURE_SALT,
        "48'/1'/0'/2'",
        correctFingerprint,
        'testnet',
        FAST_PROFILE,
      )
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

    const xprv = await deriveSigningKey(
      'my-test-password',
      FIXTURE_SALT,
      "48'/0'/0'/2'",
      fingerprint,
      'mainnet',
      FAST_PROFILE,
    )

    expect(xprv.startsWith('xprv')).toBe(true)
  })

  it('succeeds on testnet and returns a tprv', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('testnet-password', FIXTURE_SALT, FAST_PROFILE)
    const fingerprint = computeFingerprint(seed, 'testnet')

    const tprv = await deriveSigningKey(
      'testnet-password',
      FIXTURE_SALT,
      "48'/1'/0'/2'",
      fingerprint,
      'testnet',
      FAST_PROFILE,
    )

    expect(tprv.startsWith('tprv')).toBe(true)
  })

  it('fingerprint comparison is case-insensitive (expected fingerprint can be lowercase)', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('case-test-password', FIXTURE_SALT, FAST_PROFILE)
    const fingerprint = computeFingerprint(seed, 'mainnet') // always uppercase

    // Pass lowercase version of the fingerprint — should still succeed
    const lowercaseFingerprint = fingerprint.toLowerCase()

    const xprv = await deriveSigningKey(
      'case-test-password',
      FIXTURE_SALT,
      "48'/0'/0'/2'",
      lowercaseFingerprint,
      'mainnet',
      FAST_PROFILE,
    )

    expect(xprv.startsWith('xprv')).toBe(true)
  })

  it('result is deterministic for the same inputs', async () => {
    if (!hasCryptoSubtle()) return

    const seed = await deriveSeed('deterministic-password', FIXTURE_SALT, FAST_PROFILE)
    const fingerprint = computeFingerprint(seed, 'mainnet')

    const xprv1 = await deriveSigningKey(
      'deterministic-password',
      FIXTURE_SALT,
      "48'/0'/0'/2'",
      fingerprint,
      'mainnet',
      FAST_PROFILE,
    )

    const xprv2 = await deriveSigningKey(
      'deterministic-password',
      FIXTURE_SALT,
      "48'/0'/0'/2'",
      fingerprint,
      'mainnet',
      FAST_PROFILE,
    )

    expect(xprv1).toBe(xprv2)
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
