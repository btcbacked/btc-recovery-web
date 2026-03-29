// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseDescriptor, findUserKey } from './descriptor-parser'
import { RecoveryError } from './errors'

// ---------------------------------------------------------------------------
// Fixture descriptor (taken from valid_password_recovery.json)
// ---------------------------------------------------------------------------

const FIXTURE_DESCRIPTOR =
  "wsh(sortedmulti(2,[ABCD1234/48'/1'/0'/2']tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C/0/*,[5678EF90/48'/1'/0'/2']tpubDDG7ZFcGNJfMcGMk6vBPZs8cXNUfVvxc3nSvRJaU3HxFZqYMrK3Db5ZvhGJDmMvqFR8CDHvGLkL6v5P3gKxL9N5VZces1VwYJDZPVPXNYM/0/*,[FF00FF00/48'/1'/0'/2']tpubDDSNULZRYcSjfS8W1aLFCd2qrPwC9bDxQ8LDvtw7z4DEEfUckqAjHJ6LvKHfLLJLPqSE1oMRNffFk5cpxoXWvUELLxQPjF8gnQLFaJek5Zf/0/*))"

// Descriptor with an appended checksum
const DESCRIPTOR_WITH_CHECKSUM = `${FIXTURE_DESCRIPTOR}#abcd1234`

// ---------------------------------------------------------------------------
// parseDescriptor – valid inputs
// ---------------------------------------------------------------------------

describe('parseDescriptor', () => {
  describe('fixture descriptor parsing', () => {
    it('recognises the wsh/sortedmulti script type', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      expect(parsed.scriptType).toBe('wsh')
      expect(parsed.multisigType).toBe('sortedmulti')
    })

    it('extracts the correct threshold (2)', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      expect(parsed.threshold).toBe(2)
    })

    it('extracts all 3 keys', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      expect(parsed.keys).toHaveLength(3)
    })

    it('extracts fingerprints correctly', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      expect(parsed.keys[0]!.fingerprint).toBe('ABCD1234')
      expect(parsed.keys[1]!.fingerprint).toBe('5678EF90')
      expect(parsed.keys[2]!.fingerprint).toBe('FF00FF00')
    })

    it('extracts origin paths correctly', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      // Leading slash is stripped by the parser
      expect(parsed.keys[0]!.originPath).toBe("48'/1'/0'/2'")
      expect(parsed.keys[1]!.originPath).toBe("48'/1'/0'/2'")
      expect(parsed.keys[2]!.originPath).toBe("48'/1'/0'/2'")
    })

    it('extracts extended keys (tpub…) correctly', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      expect(parsed.keys[0]!.extendedKey).toBe(
        'tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C',
      )
      expect(parsed.keys[1]!.extendedKey).toBe(
        'tpubDDG7ZFcGNJfMcGMk6vBPZs8cXNUfVvxc3nSvRJaU3HxFZqYMrK3Db5ZvhGJDmMvqFR8CDHvGLkL6v5P3gKxL9N5VZces1VwYJDZPVPXNYM',
      )
    })

    it('marks tpub keys as isPrivate = false', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      for (const key of parsed.keys) {
        expect(key.isPrivate).toBe(false)
      }
    })

    it('extracts child derivation paths (0/*)', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      // Leading slash stripped
      expect(parsed.keys[0]!.childDerivation).toBe('0/*')
      expect(parsed.keys[1]!.childDerivation).toBe('0/*')
      expect(parsed.keys[2]!.childDerivation).toBe('0/*')
    })

    it('stores the raw descriptor without checksum', () => {
      const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)
      expect(parsed.raw).toBe(FIXTURE_DESCRIPTOR)
    })
  })

  describe('descriptor with checksum', () => {
    it('strips the checksum and parses successfully', () => {
      const parsed = parseDescriptor(DESCRIPTOR_WITH_CHECKSUM)
      expect(parsed.threshold).toBe(2)
      expect(parsed.keys).toHaveLength(3)
      // raw should not include the checksum
      expect(parsed.raw).not.toContain('#')
    })
  })

  describe('descriptor with xprv key', () => {
    // Build a descriptor that contains a tprv (private) key
    const XPRV_DESCRIPTOR =
      "wsh(sortedmulti(1,[ABCD1234/48'/1'/0'/2']tprvA1RpRA33e1JQ7ifknakTR2e7VuJKfKUn4pVkufmTAMHMRnNXE1oSAbD5TkMxJErZcbSjRMmHsHezD8YrMNvDCBZxZ5eRpuZTZfr5aijPQBEe/0/*))"
    it('marks tprv keys as isPrivate = true', () => {
      const parsed = parseDescriptor(XPRV_DESCRIPTOR)
      expect(parsed.keys[0]!.isPrivate).toBe(true)
      expect(parsed.keys[0]!.fingerprint).toBe('ABCD1234')
    })
  })

  // ---------------------------------------------------------------------------
  // parseDescriptor – error paths
  // ---------------------------------------------------------------------------

  describe('error cases', () => {
    it('throws DESCRIPTOR_ERROR for a non-wsh descriptor', () => {
      expect(() => parseDescriptor('pkh([ABCD1234/44]xpub123.../0/*)')).toThrow(
        RecoveryError,
      )
      try {
        parseDescriptor('pkh([ABCD1234/44]xpub123.../0/*)')
      } catch (err) {
        expect((err as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
      }
    })

    it('throws DESCRIPTOR_ERROR when the input is completely malformed', () => {
      expect(() => parseDescriptor('not-a-descriptor')).toThrow(RecoveryError)
    })

    it('throws DESCRIPTOR_ERROR when threshold exceeds key count', () => {
      // 3-of-2 is invalid
      const badDescriptor =
        "wsh(sortedmulti(3,[ABCD1234/48'/1'/0'/2']tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C/0/*,[5678EF90/48'/1'/0'/2']tpubDDG7ZFcGNJfMcGMk6vBPZs8cXNUfVvxc3nSvRJaU3HxFZqYMrK3Db5ZvhGJDmMvqFR8CDHvGLkL6v5P3gKxL9N5VZces1VwYJDZPVPXNYM/0/*))"
      expect(() => parseDescriptor(badDescriptor)).toThrow(RecoveryError)
      try {
        parseDescriptor(badDescriptor)
      } catch (err) {
        expect((err as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
        expect((err as RecoveryError).userMessage).toContain('Threshold')
      }
    })

    it('throws DESCRIPTOR_ERROR when no valid keys are found', () => {
      // Valid outer structure but no key entries matching the pattern
      const emptyKeys = 'wsh(sortedmulti(1,garbage_key))'
      expect(() => parseDescriptor(emptyKeys)).toThrow(RecoveryError)
      try {
        parseDescriptor(emptyKeys)
      } catch (err) {
        expect((err as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
      }
    })
  })
})

// ---------------------------------------------------------------------------
// findUserKey
// ---------------------------------------------------------------------------

describe('findUserKey', () => {
  const parsed = parseDescriptor(FIXTURE_DESCRIPTOR)

  it('returns the correct index and key for the first fingerprint', () => {
    const result = findUserKey(parsed, 'ABCD1234')
    expect(result).not.toBeNull()
    expect(result!.index).toBe(0)
    expect(result!.key.fingerprint).toBe('ABCD1234')
  })

  it('returns the correct index and key for the second fingerprint', () => {
    const result = findUserKey(parsed, '5678EF90')
    expect(result).not.toBeNull()
    expect(result!.index).toBe(1)
    expect(result!.key.fingerprint).toBe('5678EF90')
  })

  it('returns the correct index and key for the third fingerprint', () => {
    const result = findUserKey(parsed, 'FF00FF00')
    expect(result).not.toBeNull()
    expect(result!.index).toBe(2)
    expect(result!.key.fingerprint).toBe('FF00FF00')
  })

  it('returns null for an unknown fingerprint', () => {
    const result = findUserKey(parsed, 'DEADBEEF')
    expect(result).toBeNull()
  })

  it('is case-insensitive (lowercase input matches uppercase stored)', () => {
    const result = findUserKey(parsed, 'abcd1234')
    expect(result).not.toBeNull()
    expect(result!.index).toBe(0)
  })

  it('is case-insensitive (uppercase input matches lowercase stored)', () => {
    // Build a parsed descriptor with a lowercase fingerprint
    const lowerDesc =
      "wsh(sortedmulti(1,[abcd1234/48'/1'/0'/2']tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C/0/*))"
    const p = parseDescriptor(lowerDesc)
    const result = findUserKey(p, 'ABCD1234')
    expect(result).not.toBeNull()
    expect(result!.index).toBe(0)
  })

  it('is case-insensitive (mixed-case fingerprint)', () => {
    const result = findUserKey(parsed, 'AbCd1234')
    expect(result).not.toBeNull()
    expect(result!.index).toBe(0)
  })
})
