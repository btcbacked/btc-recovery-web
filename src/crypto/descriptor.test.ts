// @vitest-environment node
import { BIP32Factory } from 'bip32'
import { descriptorChecksum, replaceKeyByFingerprint, withChecksum } from './descriptor'
import { RecoveryError } from './errors'
import { bitcoin, ecc } from './bitcoin-lib'
import {
  MIXED_DEPTH_DESCRIPTOR,
  USER_FINGERPRINT,
  USER_ORIGIN_NODE,
  USER_XPRV,
  USER_XPUB,
} from './__fixtures__/deep-paths'

const bip32 = BIP32Factory(ecc)

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
    expect(descriptorChecksum(fixtureDescriptor)).toBe('yrdyhnmc')
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

  // ---------------------------------------------------------------------------
  // The optional expectedXpub check.
  //
  // The fingerprint is a depth 0 value shared by every key this wallet ever
  // produces, so matching on it alone does not establish that the leg being
  // spliced is the user's leg. The descriptor and the recovery file agree
  // today, so these cover a guard against future drift, not a live defect.
  // ---------------------------------------------------------------------------
  describe('when the file also records the expected xpub', () => {
    /** A real tpub for the same wallet that is NOT the recorded origin key. */
    const OTHER_XPUB = USER_ORIGIN_NODE.derive(9).neutered().toBase58()

    /** The real descriptor with the user's leg carrying some other key. */
    const DRIFTED_DESCRIPTOR = MIXED_DEPTH_DESCRIPTOR.replace(
      USER_XPUB,
      OTHER_XPUB,
    )

    it('splices the key when the descriptor leg is the recorded one', () => {
      const result = replaceKeyByFingerprint(
        MIXED_DEPTH_DESCRIPTOR,
        USER_FINGERPRINT,
        USER_XPRV,
        USER_XPUB,
      )

      expect(result).toContain(USER_XPRV)
      expect(result).not.toContain(USER_XPUB)
    })

    it('refuses to splice into a leg carrying a different key', () => {
      expect(DRIFTED_DESCRIPTOR).not.toBe(MIXED_DEPTH_DESCRIPTOR)

      try {
        replaceKeyByFingerprint(
          DRIFTED_DESCRIPTOR,
          USER_FINGERPRINT,
          USER_XPRV,
          USER_XPUB,
        )
        expect.fail('a leg that is not the recorded key must not be spliced')
      } catch (e) {
        const err = e as RecoveryError
        expect(err).toBeInstanceOf(RecoveryError)
        // Both keys belong in the detail, where a reader can compare them.
        expect(err.detail).toContain(OTHER_XPUB)
        expect(err.detail).toContain(USER_XPUB)
      }
    })

    it('accepts the same key recorded with the other version bytes', () => {
      // Version bytes take no part in derivation, so an xpub and a tpub for the
      // same key are the same key and must not read as drift.
      const mainnetSerialization = bip32
        .fromPublicKey(
          Uint8Array.from(USER_ORIGIN_NODE.publicKey),
          Uint8Array.from(USER_ORIGIN_NODE.chainCode),
          bitcoin.networks.bitcoin,
        )
        .toBase58()
      expect(mainnetSerialization.startsWith('xpub')).toBe(true)

      const result = replaceKeyByFingerprint(
        MIXED_DEPTH_DESCRIPTOR,
        USER_FINGERPRINT,
        USER_XPRV,
        mainnetSerialization,
      )

      expect(result).toContain(USER_XPRV)
    })

    it('leaves the splice unchecked when no expected xpub is given', () => {
      // Every other caller in this file relies on this: the check is opt in.
      const result = replaceKeyByFingerprint(
        DRIFTED_DESCRIPTOR,
        USER_FINGERPRINT,
        USER_XPRV,
      )

      expect(result).toContain(USER_XPRV)
    })
  })
})

// ---------------------------------------------------------------------------
// withChecksum
//
// The hardware path hands the user the recovery file's own descriptor, which
// is not guaranteed to carry a checksum. Bitcoin Core refuses a descriptor
// whose checksum is missing or wrong, so it is attached here.
// ---------------------------------------------------------------------------

describe('withChecksum', () => {
  const BODY =
    "wsh(sortedmulti(2,[ABCD1234/48'/1'/0'/2']tpubAAA/0/*,[5678EF90/48'/1'/0'/2']tpubBBB/0/*))"

  it('appends a checksum to a descriptor that has none', () => {
    const result = withChecksum(BODY)
    expect(result.startsWith(`${BODY}#`)).toBe(true)
    expect(extractChecksum(result)).toHaveLength(8)
  })

  it('produces a checksum that matches descriptorChecksum for the same body', () => {
    expect(extractChecksum(withChecksum(BODY))).toBe(descriptorChecksum(BODY))
  })

  it('leaves the descriptor body byte for byte unchanged', () => {
    expect(stripChecksum(withChecksum(BODY))).toBe(BODY)
  })

  it('replaces a wrong checksum rather than trusting it', () => {
    const result = withChecksum(`${BODY}#zzzzzzzz`)
    expect(extractChecksum(result)).toBe(descriptorChecksum(BODY))
    expect(result).not.toContain('zzzzzzzz')
  })

  it('is idempotent', () => {
    const once = withChecksum(BODY)
    expect(withChecksum(once)).toBe(once)
  })

  it('trims surrounding whitespace before checksumming', () => {
    expect(withChecksum(`  ${BODY}  `)).toBe(withChecksum(BODY))
  })

  it('throws a RecoveryError for a descriptor containing an illegal character', () => {
    expect(() => withChecksum('wsh(sortedmulti(2,é))')).toThrow(RecoveryError)
  })
})
