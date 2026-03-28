// @vitest-environment node
import { isValidFingerprint, isValidHex, isValidDerivationPath, validate } from './validation'
import { RecoveryError } from './errors'
import type { RecoveryFile } from './recovery-file'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidPasswordFile(overrides: Record<string, unknown> = {}): RecoveryFile {
  return {
    version: 1,
    network: 'testnet',
    outputDescriptor: 'wsh(sortedmulti(2,[ABCD1234/48h/1h/0h/2h]tpubABC/0/*,[5678EF90/48h/1h/0h/2h]tpubDEF/0/*))',
    context: {
      contractId: 'test-contract-123',
      role: 'lender',
      threshold: 2,
      totalKeys: 3,
    },
    userKey: {
      keySource: 'PASSWORD',
      derivationProfile: 'pbkdf2-v1',
      salt: 'a1b2c3d4e5f60718',
      derivationPath: "48'/1'/0'/2'",
      xpub: 'tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C',
      fingerprint: 'ABCD1234',
    },
    ...overrides,
  } as RecoveryFile
}

function makeValidColdCardFile(overrides: Record<string, unknown> = {}): RecoveryFile {
  return {
    version: 1,
    network: 'testnet',
    outputDescriptor: 'wsh(sortedmulti(2,[ABCD1234/48h/1h/0h/2h]tpubABC/0/*,[5678EF90/48h/1h/0h/2h]tpubDEF/0/*))',
    context: {
      contractId: 'test-contract-456',
      role: 'borrower',
      threshold: 2,
      totalKeys: 2,
    },
    userKey: {
      keySource: 'COLD_CARD',
      derivationPath: "48'/1'/0'/2'",
      xpub: 'tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C',
      fingerprint: '5678EF90',
    },
    ...overrides,
  } as RecoveryFile
}

// ---------------------------------------------------------------------------
// isValidFingerprint — ported from Rust validation.rs tests
// ---------------------------------------------------------------------------

describe('isValidFingerprint', () => {
  // Valid cases (ported from Rust)
  it('accepts "ABCD1234" (standard valid fingerprint)', () => {
    expect(isValidFingerprint('ABCD1234')).toBe(true)
  })

  it('accepts "00000000" (all zeros)', () => {
    expect(isValidFingerprint('00000000')).toBe(true)
  })

  it('accepts "FFFFFFFF" (all Fs)', () => {
    expect(isValidFingerprint('FFFFFFFF')).toBe(true)
  })

  // Lowercase is accepted (Bitcoin Core outputs lowercase fingerprints)
  it('accepts "abcd1234" (lowercase hex)', () => {
    expect(isValidFingerprint('abcd1234')).toBe(true)
  })

  it('rejects "ABCD123" (7 characters — too short)', () => {
    expect(isValidFingerprint('ABCD123')).toBe(false)
  })

  it('rejects "ABCD12345" (9 characters — too long)', () => {
    expect(isValidFingerprint('ABCD12345')).toBe(false)
  })

  it('rejects "GHIJ1234" (invalid hex characters G-J)', () => {
    expect(isValidFingerprint('GHIJ1234')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidFingerprint('')).toBe(false)
  })

  // Additional edge cases
  it('rejects "5678EF90" with mixed case letters — all-uppercase is valid', () => {
    // '5678EF90' is uppercase, so should be valid
    expect(isValidFingerprint('5678EF90')).toBe(true)
  })

  it('accepts "5678ef90" (lowercase letters)', () => {
    expect(isValidFingerprint('5678ef90')).toBe(true)
  })

  it('rejects fingerprint with spaces', () => {
    expect(isValidFingerprint('ABCD 234')).toBe(false)
  })

  it('rejects fingerprint with special characters', () => {
    expect(isValidFingerprint('ABCD123!')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidHex — ported from Rust validation.rs tests
// ---------------------------------------------------------------------------

describe('isValidHex', () => {
  // Valid cases (ported from Rust)
  it('accepts "a1b2c3" (lowercase hex, even length)', () => {
    expect(isValidHex('a1b2c3')).toBe(true)
  })

  it('accepts "A1B2C3" (uppercase hex, even length)', () => {
    expect(isValidHex('A1B2C3')).toBe(true)
  })

  it('accepts "00" (minimum valid hex)', () => {
    expect(isValidHex('00')).toBe(true)
  })

  // Invalid cases (ported from Rust)
  it('rejects "" (empty string)', () => {
    expect(isValidHex('')).toBe(false)
  })

  it('rejects "abc" (odd length)', () => {
    expect(isValidHex('abc')).toBe(false)
  })

  it('rejects "ghij" (invalid hex characters)', () => {
    expect(isValidHex('ghij')).toBe(false)
  })

  // Additional edge cases
  it('accepts a long even-length hex string', () => {
    expect(isValidHex('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe(true)
  })

  it('rejects a single character (odd length)', () => {
    expect(isValidHex('a')).toBe(false)
  })

  it('rejects hex with spaces', () => {
    expect(isValidHex('a1 b2')).toBe(false)
  })

  it('rejects "0" (odd length)', () => {
    expect(isValidHex('0')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidDerivationPath — ported from Rust validation.rs tests
// ---------------------------------------------------------------------------

describe('isValidDerivationPath', () => {
  // Apostrophe format (ported from Rust)
  it('accepts "48\'/0\'/0\'/2\'" (hardened with apostrophe)', () => {
    expect(isValidDerivationPath("48'/0'/0'/2'")).toBe(true)
  })

  it('accepts "m/48\'/0\'/0\'/2\'" (with m/ prefix)', () => {
    expect(isValidDerivationPath("m/48'/0'/0'/2'")).toBe(true)
  })

  it('accepts "44\'/0\'/0\'/0/0" (mixed hardened and non-hardened)', () => {
    expect(isValidDerivationPath("44'/0'/0'/0/0")).toBe(true)
  })

  // h format (ported from Rust)
  it('accepts "48h/0h/0h/2h" (hardened with h suffix)', () => {
    // TypeScript implementation only strips ' and h, but parseInt handles the numeric part
    // The TS implementation strips h via: component.replace(/[h']$/, '')
    expect(isValidDerivationPath('48h/0h/0h/2h')).toBe(true)
  })

  it('accepts "m/48h/1h/0h/2h" (m/ prefix with h format)', () => {
    expect(isValidDerivationPath('m/48h/1h/0h/2h')).toBe(true)
  })

  // Invalid cases (ported from Rust)
  it('rejects "" (empty string)', () => {
    expect(isValidDerivationPath('')).toBe(false)
  })

  it('rejects "m/" (only prefix, no segments)', () => {
    expect(isValidDerivationPath('m/')).toBe(false)
  })

  it('rejects "invalid" (non-numeric component)', () => {
    expect(isValidDerivationPath('invalid')).toBe(false)
  })

  // Additional edge cases
  it('accepts single-segment path "0"', () => {
    expect(isValidDerivationPath('0')).toBe(true)
  })

  it('accepts "m/0"', () => {
    expect(isValidDerivationPath('m/0')).toBe(true)
  })

  it('rejects negative numbers "-1/0"', () => {
    expect(isValidDerivationPath('-1/0')).toBe(false)
  })

  it('rejects negative numbers in middle "0/-1/0"', () => {
    expect(isValidDerivationPath('0/-1/0')).toBe(false)
  })

  it('rejects BIP32 index >= 2^31 (hardened range overlap)', () => {
    // 2147483648 is 2^31, which is used as hardened flag
    expect(isValidDerivationPath('2147483648/0')).toBe(false)
  })

  it('accepts index just below the limit (2^31 - 1)', () => {
    expect(isValidDerivationPath('2147483647')).toBe(true)
  })

  it('rejects path with letters in component "m/44a/0"', () => {
    expect(isValidDerivationPath("m/44a/0")).toBe(false)
  })

  it('accepts fixture derivation path "48\'/1\'/0\'/2\'"', () => {
    expect(isValidDerivationPath("48'/1'/0'/2'")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validate() — full file validation
// ---------------------------------------------------------------------------

describe('validate', () => {
  describe('version validation', () => {
    it('accepts version 1', () => {
      expect(() => validate(makeValidPasswordFile())).not.toThrow()
    })

    it('rejects version 0 with UNSUPPORTED_VERSION', () => {
      const file = makeValidPasswordFile({ version: 0 })
      expect(() => validate(file)).toThrow(RecoveryError)
      try {
        validate(file)
      } catch (e) {
        expect((e as RecoveryError).code).toBe('UNSUPPORTED_VERSION')
      }
    })

    it('rejects version 2 with UNSUPPORTED_VERSION', () => {
      const file = makeValidPasswordFile({ version: 2 })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('UNSUPPORTED_VERSION')
      }
    })

    it('UNSUPPORTED_VERSION error message includes the version number', () => {
      const file = makeValidPasswordFile({ version: 99 })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).userMessage).toContain('99')
      }
    })
  })

  describe('context validation', () => {
    it('rejects empty contractId with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        context: { contractId: '', role: 'lender', threshold: 2, totalKeys: 3 },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects threshold of 0 with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        context: { contractId: 'c-1', role: 'lender', threshold: 0, totalKeys: 3 },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects negative threshold with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        context: { contractId: 'c-1', role: 'lender', threshold: -1, totalKeys: 3 },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects fractional threshold with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        context: { contractId: 'c-1', role: 'lender', threshold: 1.5, totalKeys: 3 },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects totalKeys less than threshold with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        context: { contractId: 'c-1', role: 'lender', threshold: 3, totalKeys: 2 },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('accepts totalKeys equal to threshold (threshold == totalKeys is valid)', () => {
      const file = makeValidPasswordFile({
        context: { contractId: 'c-1', role: 'lender', threshold: 2, totalKeys: 2 },
      })
      expect(() => validate(file)).not.toThrow()
    })
  })

  describe('userKey validation', () => {
    it('rejects invalid fingerprint with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'pbkdf2-v1',
          salt: 'a1b2c3d4',
          derivationPath: "48'/1'/0'/2'",
          xpub: 'tpubABC',
          fingerprint: 'GHIJ1234', // non-hex chars — invalid
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects invalid derivation path with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'pbkdf2-v1',
          salt: 'a1b2c3d4',
          derivationPath: 'invalid-path',
          xpub: 'tpubABC',
          fingerprint: 'ABCD1234',
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects empty xpub with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'pbkdf2-v1',
          salt: 'a1b2c3d4',
          derivationPath: "48'/1'/0'/2'",
          xpub: '',
          fingerprint: 'ABCD1234',
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })
  })

  describe('PASSWORD-specific validation', () => {
    it('rejects missing derivationProfile for PASSWORD key with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          // no derivationProfile
          salt: 'a1b2c3d4',
          derivationPath: "48'/1'/0'/2'",
          xpub: 'tpubABC',
          fingerprint: 'ABCD1234',
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects unsupported derivationProfile with UNSUPPORTED_PROFILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'argon2id-v1',
          salt: 'a1b2c3d4',
          derivationPath: "48'/1'/0'/2'",
          xpub: 'tpubABC',
          fingerprint: 'ABCD1234',
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('UNSUPPORTED_PROFILE')
      }
    })

    it('rejects missing salt for PASSWORD key with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'pbkdf2-v1',
          // no salt
          derivationPath: "48'/1'/0'/2'",
          xpub: 'tpubABC',
          fingerprint: 'ABCD1234',
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects invalid (odd-length) hex salt for PASSWORD key with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'pbkdf2-v1',
          salt: 'abc', // odd length
          derivationPath: "48'/1'/0'/2'",
          xpub: 'tpubABC',
          fingerprint: 'ABCD1234',
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('rejects non-hex salt for PASSWORD key with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'pbkdf2-v1',
          salt: 'zzzzzzzz',
          derivationPath: "48'/1'/0'/2'",
          xpub: 'tpubABC',
          fingerprint: 'ABCD1234',
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })

    it('accepts a valid PASSWORD file with all correct fields', () => {
      expect(() => validate(makeValidPasswordFile())).not.toThrow()
    })
  })

  describe('COLD_CARD validation', () => {
    it('accepts COLD_CARD file without derivationProfile or salt', () => {
      expect(() => validate(makeValidColdCardFile())).not.toThrow()
    })

    it('COLD_CARD file still validates fingerprint', () => {
      const file = makeValidColdCardFile({
        userKey: {
          keySource: 'COLD_CARD',
          derivationPath: "48'/1'/0'/2'",
          xpub: 'tpubABC',
          fingerprint: 'lowercase', // too long + lowercase
        },
      })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })
  })

  describe('outputDescriptor validation', () => {
    it('rejects empty outputDescriptor with MALFORMED_FILE', () => {
      const file = makeValidPasswordFile({ outputDescriptor: '' })
      try {
        validate(file)
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })
  })
})
