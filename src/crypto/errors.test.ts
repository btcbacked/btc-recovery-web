// @vitest-environment node
import { RecoveryError, ERROR_MESSAGES } from './errors'
import type { RecoveryErrorCode } from './errors'

describe('RecoveryError', () => {
  describe('constructor and properties', () => {
    it('sets name to RecoveryError', () => {
      const err = new RecoveryError('INVALID_JSON', 'user message')
      expect(err.name).toBe('RecoveryError')
    })

    it('sets code correctly', () => {
      const err = new RecoveryError('MALFORMED_FILE', 'some message')
      expect(err.code).toBe('MALFORMED_FILE')
    })

    it('sets userMessage correctly', () => {
      const err = new RecoveryError('UNSUPPORTED_VERSION', 'version 99 not supported')
      expect(err.userMessage).toBe('version 99 not supported')
    })

    it('sets the Error message to userMessage', () => {
      const err = new RecoveryError('FINGERPRINT_MISMATCH', 'wrong password')
      expect(err.message).toBe('wrong password')
    })

    it('stores optional detail when provided', () => {
      const err = new RecoveryError(
        'FINGERPRINT_MISMATCH',
        'wrong password',
        'Expected: ABCD1234, got: 12345678',
      )
      expect(err.detail).toBe('Expected: ABCD1234, got: 12345678')
    })

    it('detail is undefined when not provided', () => {
      const err = new RecoveryError('DESCRIPTOR_ERROR', 'descriptor error')
      expect(err.detail).toBeUndefined()
    })

    it('is an instance of Error', () => {
      const err = new RecoveryError('DERIVATION_ERROR', 'derivation failed')
      expect(err).toBeInstanceOf(Error)
    })

    it('is an instance of RecoveryError', () => {
      const err = new RecoveryError('INVALID_JSON', 'bad json')
      expect(err).toBeInstanceOf(RecoveryError)
    })

    it('can be caught as Error', () => {
      expect(() => {
        throw new RecoveryError('HARDWARE_KEY', 'hardware key')
      }).toThrow(Error)
    })

    it('can be caught as RecoveryError', () => {
      expect(() => {
        throw new RecoveryError('HARDWARE_KEY', 'hardware key')
      }).toThrow(RecoveryError)
    })
  })

  describe('all error codes', () => {
    const allCodes: RecoveryErrorCode[] = [
      'INVALID_JSON',
      'MALFORMED_FILE',
      'UNSUPPORTED_VERSION',
      'UNSUPPORTED_PROFILE',
      'HARDWARE_KEY',
      'FINGERPRINT_MISMATCH',
      'DERIVATION_ERROR',
      'DESCRIPTOR_ERROR',
    ]

    it('has exactly 12 error codes defined in ERROR_MESSAGES', () => {
      expect(Object.keys(ERROR_MESSAGES)).toHaveLength(12)
    })

    for (const code of allCodes) {
      it(`ERROR_MESSAGES has a non-empty string for code "${code}"`, () => {
        expect(typeof ERROR_MESSAGES[code]).toBe('string')
        expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0)
      })

      it(`RecoveryError can be constructed with code "${code}"`, () => {
        const err = new RecoveryError(code, 'test message')
        expect(err.code).toBe(code)
      })
    }
  })

  describe('ERROR_MESSAGES content spot checks', () => {
    it('INVALID_JSON message mentions JSON', () => {
      expect(ERROR_MESSAGES.INVALID_JSON.toLowerCase()).toContain('json')
    })

    it('FINGERPRINT_MISMATCH message mentions password', () => {
      expect(ERROR_MESSAGES.FINGERPRINT_MISMATCH.toLowerCase()).toContain('password')
    })

    it('UNSUPPORTED_VERSION message mentions version', () => {
      expect(ERROR_MESSAGES.UNSUPPORTED_VERSION.toLowerCase()).toContain('version')
    })

    it('UNSUPPORTED_PROFILE message mentions derivation or profile', () => {
      const msg = ERROR_MESSAGES.UNSUPPORTED_PROFILE.toLowerCase()
      expect(msg.includes('derivation') || msg.includes('profile') || msg.includes('method')).toBe(true)
    })
  })
})
