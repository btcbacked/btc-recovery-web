// @vitest-environment node
import {
  RecoveryError,
  ERROR_MESSAGES,
  KEY_MISMATCH_NEXT_STEPS,
  KEY_MISMATCH_UNCHECKABLE,
  KEY_MISMATCH_INCONSISTENT_FILE,
} from './errors'
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
      'KEY_MISMATCH',
      'DERIVATION_ERROR',
      'DESCRIPTOR_ERROR',
    ]

    it('has exactly 13 error codes defined in ERROR_MESSAGES', () => {
      expect(Object.keys(ERROR_MESSAGES)).toHaveLength(13)
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

    it('KEY_MISMATCH message names the file and says the keys disagree', () => {
      const msg = ERROR_MESSAGES.KEY_MISMATCH.toLowerCase()
      expect(msg).toContain('recovery file')
      expect(msg).toContain('does not match')
    })

    it('UNSUPPORTED_VERSION message mentions version', () => {
      expect(ERROR_MESSAGES.UNSUPPORTED_VERSION.toLowerCase()).toContain('version')
    })

    it('UNSUPPORTED_PROFILE message mentions derivation or profile', () => {
      const msg = ERROR_MESSAGES.UNSUPPORTED_PROFILE.toLowerCase()
      expect(msg.includes('derivation') || msg.includes('profile') || msg.includes('method')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Copy rules for a tool that runs after BTCBacked is gone
  //
  // There is no newer file, no newer tool and nobody to ask, so a message that
  // sends the reader to any of those is a dead end. Every message that reports
  // an unusable file has to end somewhere the reader can actually go.
  // -------------------------------------------------------------------------

  describe('doomsday copy rules', () => {
    const DEAD_END_FILE_ERRORS: RecoveryErrorCode[] = [
      'MALFORMED_FILE',
      'UNSUPPORTED_VERSION',
      'UNSUPPORTED_PROFILE',
      'DERIVATION_ERROR',
    ]

    /**
     * These asserted a referral to "a Bitcoin professional you trust" until the
     * CEO ruled that this copy carries no referral to any third party. The
     * assertion is inverted rather than deleted, because an unenforced copy
     * rule is one careless edit from being back.
     *
     * What replaces it is the approved ending: confirm the money has not moved
     * and the key is still theirs, then stop. A message with no next step is
     * the intended shape here, not an oversight.
     */
    for (const code of DEAD_END_FILE_ERRORS) {
      it(`"${code}" refers the reader to no one`, () => {
        expect(ERROR_MESSAGES[code]).not.toMatch(/professional/i)
        expect(ERROR_MESSAGES[code]).not.toMatch(/take (them|it) to/i)
      })

      it(`"${code}" ends by confirming the money and the key are still theirs`, () => {
        expect(ERROR_MESSAGES[code]).toMatch(
          /Your Bitcoin has not moved and your key is still yours\.$/,
        )
      })
    }

    it('sends the reader to no outside person or service anywhere in the catalogue', () => {
      const everything = [
        ...Object.values(ERROR_MESSAGES),
        KEY_MISMATCH_NEXT_STEPS,
        KEY_MISMATCH_UNCHECKABLE,
        KEY_MISMATCH_INCONSISTENT_FILE,
      ].join(' ')
      for (const referral of [
        /professional/i,
        /specialist/i,
        /consultant/i,
        /advisor/i,
        /recovery service/i,
        /someone you trust/i,
        /third party/i,
      ]) {
        expect(everything).not.toMatch(referral)
      }
    })

    it('never refers the reader to a newer version of this tool', () => {
      expect(ERROR_MESSAGES.UNSUPPORTED_VERSION).not.toMatch(/update this tool/i)
      expect(ERROR_MESSAGES.UNSUPPORTED_VERSION).toMatch(/no newer version/i)
    })

    /**
     * This fires on both paths, so any name for the object is false for one of
     * them. Naming none is the resolution, not an omission.
     */
    it('names no object in a message that fires on both paths', () => {
      expect(ERROR_MESSAGES.DESCRIPTOR_ERROR).toBe(
        'This file could not be prepared for another wallet.',
      )
      expect(ERROR_MESSAGES.DESCRIPTOR_ERROR).not.toMatch(/configuration/i)
      expect(ERROR_MESSAGES.DESCRIPTOR_ERROR).not.toMatch(/descriptor/i)
      expect(ERROR_MESSAGES.DESCRIPTOR_ERROR).not.toMatch(/signing file/i)
      expect(ERROR_MESSAGES.DESCRIPTOR_ERROR).not.toMatch(/escrow file/i)
    })

    it('never asks the reader to retry something deterministic', () => {
      // Rebuilding a key from a password and a file is exact. A retry fails
      // identically, forever, so offering one wastes the reader's only lead.
      expect(ERROR_MESSAGES.DERIVATION_ERROR).not.toMatch(/try again/i)
    })

    it('uses no em dashes or en dashes anywhere in the catalogue', () => {
      const everything = [
        ...Object.values(ERROR_MESSAGES),
        KEY_MISMATCH_NEXT_STEPS,
        KEY_MISMATCH_UNCHECKABLE,
        KEY_MISMATCH_INCONSISTENT_FILE,
      ].join(' ')
      expect(everything).not.toMatch(/[–—]/)
    })
  })

  describe('KEY_MISMATCH_NEXT_STEPS', () => {
    /**
     * The lead used to be "take this file to a Bitcoin professional you trust",
     * which is the referral the CEO ruled out. What is left leads with the
     * instruction that needs nobody: the reader already holds both halves.
     */
    it('leads with the one instruction that always works', () => {
      const firstLine = KEY_MISMATCH_NEXT_STEPS.split('\n')[1] ?? ''
      expect(firstLine).toMatch(/Keep this file and your password/i)
      expect(firstLine).not.toMatch(/professional/i)
    })

    it('is broken into short lines rather than one paragraph', () => {
      const lines = KEY_MISMATCH_NEXT_STEPS.split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(4)
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(180)
      }
    })

    it('does not claim that passing this tool proves a file can sign', () => {
      // A stale but internally consistent file passes every check here and
      // still cannot sign, so promising the reader otherwise could make them
      // throw away the only file that works.
      expect(KEY_MISMATCH_NEXT_STEPS).not.toMatch(/the escrow will accept/i)
      expect(KEY_MISMATCH_NEXT_STEPS).toMatch(/the one to work from/i)
    })

    it('is carried by both messages the crypto layer throws', () => {
      expect(KEY_MISMATCH_UNCHECKABLE).toContain(KEY_MISMATCH_NEXT_STEPS)
      expect(KEY_MISMATCH_INCONSISTENT_FILE).toContain(KEY_MISMATCH_NEXT_STEPS)
    })

    it('tells the reader with a good password that the password was fine', () => {
      expect(KEY_MISMATCH_INCONSISTENT_FILE).toMatch(/password is correct/i)
    })
  })
})
