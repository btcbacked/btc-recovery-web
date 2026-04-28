// @vitest-environment node
import { descriptorChecksum, replaceKeyByFingerprint } from './descriptor'
import { RecoveryError } from './errors'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Extract just the body (no #checksum) from a descriptor string
function stripChecksum(descriptor: string): string {
  return descriptor.split('#')[0] ?? descriptor
}

// Extract the checksum from a descriptor string (part after #)
function extractChecksum(descriptor: string): string {
  return descriptor.split('#')[1] ?? ''
}

function hasValidChecksum(descriptor: string): boolean {
  const parts = descriptor.split('#')
  if (parts.length !== 2) {
    return false
  }

  const body = parts[0] ?? ''
  const checksum = parts[1] ?? ''
  const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

  if (checksum.length !== 8) {
    return false
  }

  if (!checksum.split('').every(ch => CHECKSUM_CHARSET.includes(ch))) {
    return false
  }

  try {
    return descriptorChecksum(body) === checksum
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// descriptorChecksum
// ---------------------------------------------------------------------------

describe('descriptorChecksum', () => {
  it('returns an 8-character string', () => {
    const desc = "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABC,[5678EF90/48'/0'/0'/2']xpubDEF))"
    const checksum = descriptorChecksum(desc)
    expect(checksum).toHaveLength(8)
  })

  it('uses only characters from the checksum charset (qpzry9x8gf2tvdw0s3jn54khce6mua7l)', () => {
    const desc = "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABC,[5678EF90/48'/0'/0'/2']xpubDEF))"
    const checksum = descriptorChecksum(desc)
    const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    for (const ch of checksum) {
      expect(CHECKSUM_CHARSET).toContain(ch)
    }
  })

  it('is deterministic — same input always produces same checksum', () => {
    const desc = "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABC,[5678EF90/48'/0'/0'/2']xpubDEF))"
    expect(descriptorChecksum(desc)).toBe(descriptorChecksum(desc))
  })

  it('different descriptors produce different checksums', () => {
    const desc1 = "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubAAA,[5678EF90/48'/0'/0'/2']xpubBBB))"
    const desc2 = "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubCCC,[5678EF90/48'/0'/0'/2']xpubDDD))"
    expect(descriptorChecksum(desc1)).not.toBe(descriptorChecksum(desc2))
  })

  it('throws DESCRIPTOR_ERROR for descriptor containing invalid character (backslash not in charset)', () => {
    // The INPUT_CHARSET does contain backslash — let us use a character that is truly not in the charset
    // Checking the charset: '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ '
    // Tab character (\t) is NOT in the charset
    try {
      descriptorChecksum("wsh(\t)")
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
    }
  })

  it('computes a known checksum for the fixture descriptor body', () => {
    // Use the body from the password fixture (strip the checksum if any)
    const fixtureDescriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/1'/0'/2']tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C/0/*,[5678EF90/48'/1'/0'/2']tpubDDG7ZFcGNJfMcGMk6vBPZs8cXNUfVvxc3nSvRJaU3HxFZqYMrK3Db5ZvhGJDmMvqFR8CDHvGLkL6v5P3gKxL9N5VZces1VwYJDZPVPXNYM/0/*,[FF00FF00/48'/1'/0'/2']tpubDDSNULZRYcSjfS8W1aLFCd2qrPwC9bDxQ8LDvtw7z4DEEfUckqAjHJ6LvKHfLLJLPqSE1oMRNffFk5cpxoXWvUELLxQPjF8gnQLFaJek5Zf/0/*))"
    const checksum = descriptorChecksum(fixtureDescriptor)
    // Verify it is stable (length and charset)
    expect(checksum).toHaveLength(8)
    // Round-trip: compute again and check equal
    expect(descriptorChecksum(fixtureDescriptor)).toBe(checksum)
  })

  it('matches the BIP-380 test vector raw(deadbeef) -> 89f8spxm', () => {
    expect(descriptorChecksum('raw(deadbeef)')).toBe('89f8spxm')
  })

  it('matches BIP-380 checksum validity vectors', () => {
    const valid = ['raw(deadbeef)#89f8spxm']
    const invalid = [
      'raw(deadbeef)',
      'raw(deadbeef)#',
      'raw(deadbeef)#89f8spxmx',
      'raw(deadbeef)#89f8spx',
      'raw(deedbeef)#89f8spxm',
      'raw(deadbeef)#99f8spxm',
      'raw(Ü)#00000000',
    ]

    for (const descriptor of valid) {
      expect(hasValidChecksum(descriptor)).toBe(true)
    }

    for (const descriptor of invalid) {
      expect(hasValidChecksum(descriptor)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// replaceKeyByFingerprint — ported from Rust replacer.rs tests
// ---------------------------------------------------------------------------

describe('replaceKeyByFingerprint', () => {
  // ---------------------------------------------------------------------------
  // Test: replace single key in 2-of-2, second key unchanged
  // Ported from Rust: test_replace_single_key
  // ---------------------------------------------------------------------------
  it('replaces the matching xpub and leaves the second key unchanged', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF,[5678EF90/48'/0'/0'/2']xpubGHIJKL))"
    const xprv = 'xprvABCDEFGHIJKLMNOP'

    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', xprv)

    expect(result).toContain('xprvABCDEFGHIJKLMNOP')
    expect(result).toContain('[ABCD1234/')
    expect(result).toContain('xprv')
    // Second key untouched
    expect(result).toContain("[5678EF90/48'/0'/0'/2']xpubGHIJKL")
  })

  // ---------------------------------------------------------------------------
  // Test: replace testnet key (tpub -> tprv)
  // Ported from Rust: test_replace_testnet_key
  // ---------------------------------------------------------------------------
  it('replaces a tpub with a tprv for testnet descriptors', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/1'/0'/2']tpubABCDEF,[5678EF90/48'/1'/0'/2']tpubGHIJKL))"
    const tprv = 'tprvABCDEFGHIJKLMNOP'

    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', tprv)

    expect(result).toContain('tprvABCDEFGHIJKLMNOP')
    expect(result).toContain('[ABCD1234/')
    expect(result).toContain('tprv')
  })

  // ---------------------------------------------------------------------------
  // Test: fingerprint not found throws DESCRIPTOR_ERROR
  // Ported from Rust: test_fingerprint_not_found
  // ---------------------------------------------------------------------------
  it('throws DESCRIPTOR_ERROR when fingerprint is not in the descriptor', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF))"
    const xprv = 'xprvABCDEFGHIJKLMNOP'

    try {
      replaceKeyByFingerprint(descriptor, 'XXXXXXXX', xprv)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
    }
  })

  it('DESCRIPTOR_ERROR message mentions the fingerprint that was not found', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF))"

    try {
      replaceKeyByFingerprint(descriptor, 'DEADBEEF', 'xprvSOMETHING')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).userMessage).toContain('DEADBEEF')
    }
  })

  // ---------------------------------------------------------------------------
  // Test: case-insensitive fingerprint matching
  // Ported from Rust: test_case_insensitive_fingerprint
  // ---------------------------------------------------------------------------
  it('matches fingerprint case-insensitively (lowercase in descriptor, uppercase search)', () => {
    // Descriptor uses lowercase fingerprint 'abcd1234', we search with 'ABCD1234'
    const descriptor =
      "wsh(sortedmulti(2,[abcd1234/48'/0'/0'/2']xpubABCDEF,[5678EF90/48'/0'/0'/2']xpubGHIJKL))"
    const xprv = 'xprvABCDEFGHIJKLMNOP'

    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', xprv)

    expect(result).toContain('xprvABCDEFGHIJKLMNOP')
  })

  it('matches fingerprint case-insensitively (uppercase in descriptor, lowercase search)', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF,[5678EF90/48'/0'/0'/2']xpubGHIJKL))"
    const xprv = 'xprvABCDEFGHIJKLMNOP'

    const result = replaceKeyByFingerprint(descriptor, 'abcd1234', xprv)

    expect(result).toContain('xprvABCDEFGHIJKLMNOP')
  })

  // ---------------------------------------------------------------------------
  // Test: 3-of-3 multisig, only middle key replaced
  // Ported from Rust: test_three_of_three_multisig
  // ---------------------------------------------------------------------------
  it('replaces only the middle key in a 3-key multisig', () => {
    const descriptor =
      "wsh(sortedmulti(2,[AAAA1111/48'/0'/0'/2']xpubAAA,[BBBB2222/48'/0'/0'/2']xpubBBB,[CCCC3333/48'/0'/0'/2']xpubCCC))"
    const xprv = 'xprvBBBBBBBBB'

    const result = replaceKeyByFingerprint(descriptor, 'BBBB2222', xprv)

    // First key unchanged
    expect(result).toContain("[AAAA1111/48'/0'/0'/2']xpubAAA")
    // Middle key replaced
    expect(result).toContain('[BBBB2222/')
    expect(result).toContain('xprvBBBBBBBBB')
    // Last key unchanged
    expect(result).toContain("[CCCC3333/48'/0'/0'/2']xpubCCC")
  })

  // ---------------------------------------------------------------------------
  // Test: old checksum stripped and new checksum recalculated
  // Ported from Rust: test_checksum_recalculated
  // ---------------------------------------------------------------------------
  it('strips the old checksum and appends a new one', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF,[5678EF90/48'/0'/0'/2']xpubGHIJKL))#oldchecksum"
    const xprv = 'xprvABCDEFGHIJKLMNOP'

    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', xprv)

    // Result must contain a # separator (has checksum)
    expect(result).toContain('#')
    // Must NOT contain the old checksum string
    expect(result).not.toContain('#oldchecksum')
    // Must contain the replacement key
    expect(result).toContain('xprvABCDEFGHIJKLMNOP')
  })

  it('result without the old checksum has a valid 8-char checksum appended', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF,[5678EF90/48'/0'/0'/2']xpubGHIJKL))#oldchecksum"
    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', 'xprvABCDEFGHIJKLMNOP')
    const checksum = extractChecksum(result)
    expect(checksum).toHaveLength(8)
  })

  it('result checksum matches freshly computed checksum of the body', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF,[5678EF90/48'/0'/0'/2']xpubGHIJKL))"
    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', 'xprvABCDEFGHIJKLMNOP')
    const body = stripChecksum(result)
    const checksum = extractChecksum(result)
    expect(checksum).toBe(descriptorChecksum(body))
  })

  // ---------------------------------------------------------------------------
  // Test: descriptor without existing checksum also gets checksum added
  // ---------------------------------------------------------------------------
  it('adds a checksum even when the input descriptor has no checksum', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF,[5678EF90/48'/0'/0'/2']xpubGHIJKL))"

    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', 'xprvABCDEFGHIJKLMNOP')

    expect(result).toContain('#')
    expect(extractChecksum(result)).toHaveLength(8)
  })

  // ---------------------------------------------------------------------------
  // Test: xprv not starting with xprv or tprv throws DESCRIPTOR_ERROR
  // ---------------------------------------------------------------------------
  it('throws DESCRIPTOR_ERROR when xprv does not start with "xprv" or "tprv"', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF))"

    try {
      replaceKeyByFingerprint(descriptor, 'ABCD1234', 'zprvINVALID')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
    }
  })

  it('throws DESCRIPTOR_ERROR when xprv is an empty string', () => {
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF))"

    try {
      replaceKeyByFingerprint(descriptor, 'ABCD1234', '')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
    }
  })

  // ---------------------------------------------------------------------------
  // Test: invalid character in descriptor body throws DESCRIPTOR_ERROR
  // (tab is not in the INPUT_CHARSET)
  // ---------------------------------------------------------------------------
  it('throws DESCRIPTOR_ERROR when the descriptor body contains an invalid character', () => {
    // We build a descriptor that would pass the fingerprint check but fail the
    // checksum calculation due to a tab character in the body
    const descriptorWithTab =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubABCDEF\t,[5678EF90/48'/0'/0'/2']xpubGHIJKL))"

    try {
      replaceKeyByFingerprint(descriptorWithTab, 'ABCD1234', 'xprvReplacement')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('DESCRIPTOR_ERROR')
    }
  })

  // ---------------------------------------------------------------------------
  // Test: only the FIRST occurrence is replaced (replaceKeyByFingerprint uses
  // non-global regex via String.prototype.replace without /g flag)
  // ---------------------------------------------------------------------------
  it('replaces only the first matching occurrence when the same fingerprint appears twice', () => {
    // Artificial descriptor where ABCD1234 appears in two keys (shouldn't happen in practice)
    const descriptor =
      "wsh(sortedmulti(2,[ABCD1234/48'/0'/0'/2']xpubFIRST,[ABCD1234/48'/0'/0'/2']xpubSECOND))"

    const result = replaceKeyByFingerprint(descriptor, 'ABCD1234', 'xprvREPLACED')

    // The result must contain the xprv replacement
    expect(result).toContain('xprvREPLACED')
    // And should still contain one of the original xpub occurrences (the second one)
    // Since only first is replaced, one xpub key suffix remains
    const bodyAfterReplace = stripChecksum(result)
    // Count occurrences of xpub in body
    const xpubCount = (bodyAfterReplace.match(/xpub/g) ?? []).length
    expect(xpubCount).toBe(1)
  })
})
