// @vitest-environment node
import { parseRecoveryFile } from './recovery-file'
import { RecoveryError } from './errors'

// ---------------------------------------------------------------------------
// Fixture data (mirrors the real fixture files on disk)
// ---------------------------------------------------------------------------

const VALID_PASSWORD_FIXTURE = JSON.stringify({
  version: 1,
  network: 'testnet',
  outputDescriptor:
    "wsh(sortedmulti(2,[ABCD1234/48'/1'/0'/2']tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C/0/*,[5678EF90/48'/1'/0'/2']tpubDDG7ZFcGNJfMcGMk6vBPZs8cXNUfVvxc3nSvRJaU3HxFZqYMrK3Db5ZvhGJDmMvqFR8CDHvGLkL6v5P3gKxL9N5VZces1VwYJDZPVPXNYM/0/*,[FF00FF00/48'/1'/0'/2']tpubDDSNULZRYcSjfS8W1aLFCd2qrPwC9bDxQ8LDvtw7z4DEEfUckqAjHJ6LvKHfLLJLPqSE1oMRNffFk5cpxoXWvUELLxQPjF8gnQLFaJek5Zf/0/*))",
  context: {
    contractId: 'test-contract-123',
    role: 'lender',
    threshold: 2,
    totalKeys: 3,
  },
  userKey: {
    keySource: 'PASSWORD',
    derivationProfile: 'pbkdf2-v1',
    salt: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    derivationPath: "48'/1'/0'/2'",
    xpub: 'tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C',
    fingerprint: 'ABCD1234',
  },
})

const VALID_HARDWARE_FIXTURE = JSON.stringify({
  version: 1,
  network: 'testnet',
  outputDescriptor:
    "wsh(sortedmulti(2,[ABCD1234/48'/1'/0'/2']tpubABC/0/*,[5678EF90/48'/1'/0'/2']tpubDEF/0/*))",
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
})

// ---------------------------------------------------------------------------
// Parsing valid fixtures
// ---------------------------------------------------------------------------

describe('parseRecoveryFile — valid fixtures', () => {
  describe('valid password recovery fixture', () => {
    it('parses without throwing', () => {
      expect(() => parseRecoveryFile(VALID_PASSWORD_FIXTURE)).not.toThrow()
    })

    it('returns version 1', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.version).toBe(1)
    })

    it('returns network "testnet"', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.network).toBe('testnet')
    })

    it('returns non-empty outputDescriptor', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.outputDescriptor.length).toBeGreaterThan(0)
    })

    it('returns context.contractId "test-contract-123"', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.context.contractId).toBe('test-contract-123')
    })

    it('returns context.role "lender"', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.context.role).toBe('lender')
    })

    it('returns context.threshold 2', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.context.threshold).toBe(2)
    })

    it('returns context.totalKeys 3', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.context.totalKeys).toBe(3)
    })

    it('returns userKey.keySource "PASSWORD"', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.userKey.keySource).toBe('PASSWORD')
    })

    it('returns userKey.derivationProfile "pbkdf2-v1"', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.userKey.derivationProfile).toBe('pbkdf2-v1')
    })

    it('returns userKey.salt', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.userKey.salt).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90')
    })

    it('returns userKey.fingerprint "ABCD1234"', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.userKey.fingerprint).toBe('ABCD1234')
    })

    it('returns userKey.derivationPath', () => {
      const file = parseRecoveryFile(VALID_PASSWORD_FIXTURE)
      expect(file.userKey.derivationPath).toBe("48'/1'/0'/2'")
    })
  })

  describe('valid hardware recovery fixture', () => {
    it('parses without throwing', () => {
      expect(() => parseRecoveryFile(VALID_HARDWARE_FIXTURE)).not.toThrow()
    })

    it('returns userKey.keySource "COLD_CARD"', () => {
      const file = parseRecoveryFile(VALID_HARDWARE_FIXTURE)
      expect(file.userKey.keySource).toBe('COLD_CARD')
    })

    it('returns context.role "borrower"', () => {
      const file = parseRecoveryFile(VALID_HARDWARE_FIXTURE)
      expect(file.context.role).toBe('borrower')
    })

    it('COLD_CARD file has no derivationProfile (undefined)', () => {
      const file = parseRecoveryFile(VALID_HARDWARE_FIXTURE)
      expect(file.userKey.derivationProfile).toBeUndefined()
    })

    it('COLD_CARD file has no salt (undefined)', () => {
      const file = parseRecoveryFile(VALID_HARDWARE_FIXTURE)
      expect(file.userKey.salt).toBeUndefined()
    })

    it('returns userKey.fingerprint "5678EF90"', () => {
      const file = parseRecoveryFile(VALID_HARDWARE_FIXTURE)
      expect(file.userKey.fingerprint).toBe('5678EF90')
    })
  })
})

// ---------------------------------------------------------------------------
// Rejecting non-JSON input
// ---------------------------------------------------------------------------

describe('parseRecoveryFile — invalid JSON', () => {
  it('rejects plain text with INVALID_JSON', () => {
    try {
      parseRecoveryFile('not json at all')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects empty string with INVALID_JSON', () => {
    try {
      parseRecoveryFile('')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects truncated JSON with INVALID_JSON', () => {
    try {
      parseRecoveryFile('{"version": 1')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects JSON array with a RecoveryError (MALFORMED_FILE — arrays are objects in JS, so missing fields error fires)', () => {
    // Note: JSON.parse('[1,2,3]') returns an Array, which passes the typeof !== 'object'
    // check (arrays ARE objects). The code then fails on missing required fields, so the
    // error code is MALFORMED_FILE rather than INVALID_JSON.
    try {
      parseRecoveryFile('[1, 2, 3]')
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(RecoveryError)
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects JSON null with INVALID_JSON', () => {
    try {
      parseRecoveryFile('null')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects JSON string primitive with INVALID_JSON', () => {
    try {
      parseRecoveryFile('"hello"')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects JSON number primitive with INVALID_JSON', () => {
    try {
      parseRecoveryFile('42')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects JSON boolean with INVALID_JSON', () => {
    try {
      parseRecoveryFile('true')
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('INVALID_JSON')
    }
  })

  it('throws RecoveryError (not a generic Error) for invalid JSON', () => {
    try {
      parseRecoveryFile('not json')
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(RecoveryError)
    }
  })
})

// ---------------------------------------------------------------------------
// Rejecting missing top-level fields
// ---------------------------------------------------------------------------

describe('parseRecoveryFile — missing top-level fields', () => {
  const REQUIRED_TOP_LEVEL = ['version', 'network', 'outputDescriptor', 'context', 'userKey']

  for (const field of REQUIRED_TOP_LEVEL) {
    it(`rejects file missing "${field}" with MALFORMED_FILE`, () => {
      const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
      delete obj[field]
      try {
        parseRecoveryFile(JSON.stringify(obj))
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
        expect((e as RecoveryError).userMessage).toContain(field)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Rejecting invalid types for top-level fields
// ---------------------------------------------------------------------------

describe('parseRecoveryFile — invalid field types', () => {
  it('rejects version as string with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.version = '1'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects version as float (non-integer) with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.version = 1.5
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects outputDescriptor as number with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.outputDescriptor = 42
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects context as array with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.context = [1, 2, 3]
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects context as null with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.context = null
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects userKey as string with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.userKey = 'bad'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })
})

// ---------------------------------------------------------------------------
// Rejecting invalid enum values
// ---------------------------------------------------------------------------

describe('parseRecoveryFile — invalid enum values', () => {
  it('rejects invalid network "bitcoin" with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.network = 'bitcoin'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects invalid network "MAINNET" (wrong case) with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.network = 'MAINNET'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('accepts all valid networks: mainnet', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.network = 'mainnet'
    expect(() => parseRecoveryFile(JSON.stringify(obj))).not.toThrow()
  })

  it('accepts all valid networks: regtest', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.network = 'regtest'
    expect(() => parseRecoveryFile(JSON.stringify(obj))).not.toThrow()
  })

  it('accepts all valid networks: signet', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.network = 'signet'
    expect(() => parseRecoveryFile(JSON.stringify(obj))).not.toThrow()
  })

  it('rejects invalid role "admin" with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.context.role = 'admin'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects invalid keySource "TREZOR" with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.userKey.keySource = 'TREZOR'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects invalid keySource "password" (lowercase) with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.userKey.keySource = 'password'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })
})

// ---------------------------------------------------------------------------
// Rejecting missing context sub-fields
// ---------------------------------------------------------------------------

describe('parseRecoveryFile — missing context sub-fields', () => {
  const CONTEXT_FIELDS = ['contractId', 'role', 'threshold', 'totalKeys']

  for (const field of CONTEXT_FIELDS) {
    it(`rejects missing "context.${field}" with MALFORMED_FILE`, () => {
      const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
      delete obj.context[field]
      try {
        parseRecoveryFile(JSON.stringify(obj))
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })
  }

  it('rejects context.threshold as float with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.context.threshold = 1.5
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects context.totalKeys as string with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.context.totalKeys = '3'
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })
})

// ---------------------------------------------------------------------------
// Rejecting missing userKey sub-fields
// ---------------------------------------------------------------------------

describe('parseRecoveryFile — missing userKey sub-fields', () => {
  const USERKEY_REQUIRED_FIELDS = ['keySource', 'derivationPath', 'xpub', 'fingerprint']

  for (const field of USERKEY_REQUIRED_FIELDS) {
    it(`rejects missing "userKey.${field}" with MALFORMED_FILE`, () => {
      const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
      delete obj.userKey[field]
      try {
        parseRecoveryFile(JSON.stringify(obj))
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
      }
    })
  }

  it('rejects userKey.derivationProfile as number with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.userKey.derivationProfile = 42
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })

  it('rejects userKey.salt as number with MALFORMED_FILE', () => {
    const obj = JSON.parse(VALID_PASSWORD_FIXTURE)
    obj.userKey.salt = 12345678
    try {
      parseRecoveryFile(JSON.stringify(obj))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as RecoveryError).code).toBe('MALFORMED_FILE')
    }
  })
})
