// @vitest-environment node
import { getProfile, isSupportedProfile } from './profiles'
import type { DerivationProfile } from './profiles'

describe('profiles', () => {
  describe('getProfile', () => {
    it('returns a profile object for "pbkdf2-v1"', () => {
      const profile = getProfile('pbkdf2-v1')
      expect(profile).not.toBeNull()
    })

    it('pbkdf2-v1 profile has correct algorithm', () => {
      const profile = getProfile('pbkdf2-v1') as DerivationProfile
      expect(profile.algorithm).toBe('pbkdf2-hmac-sha256')
    })

    it('pbkdf2-v1 profile has 100,000 iterations', () => {
      const profile = getProfile('pbkdf2-v1') as DerivationProfile
      expect(profile.iterations).toBe(100_000)
    })

    it('pbkdf2-v1 profile has keyLength of 64', () => {
      const profile = getProfile('pbkdf2-v1') as DerivationProfile
      expect(profile.keyLength).toBe(64)
    })

    it('returns null for unknown profile "pbkdf2-v2"', () => {
      expect(getProfile('pbkdf2-v2')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(getProfile('')).toBeNull()
    })

    it('returns null for completely unknown name', () => {
      expect(getProfile('argon2id-v1')).toBeNull()
    })

    it('returns null for partial match "pbkdf2"', () => {
      expect(getProfile('pbkdf2')).toBeNull()
    })

    it('returns null for name with extra whitespace', () => {
      expect(getProfile(' pbkdf2-v1')).toBeNull()
      expect(getProfile('pbkdf2-v1 ')).toBeNull()
    })

    it('returns null for null-like string "null"', () => {
      expect(getProfile('null')).toBeNull()
    })
  })

  describe('isSupportedProfile', () => {
    it('returns true for "pbkdf2-v1"', () => {
      expect(isSupportedProfile('pbkdf2-v1')).toBe(true)
    })

    it('returns false for "pbkdf2-v2"', () => {
      expect(isSupportedProfile('pbkdf2-v2')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isSupportedProfile('')).toBe(false)
    })

    it('returns false for unknown algorithm "argon2id-v1"', () => {
      expect(isSupportedProfile('argon2id-v1')).toBe(false)
    })

    it('returns false for "scrypt-v1"', () => {
      expect(isSupportedProfile('scrypt-v1')).toBe(false)
    })

    it('isSupportedProfile is consistent with getProfile not returning null', () => {
      const name = 'pbkdf2-v1'
      expect(isSupportedProfile(name)).toBe(getProfile(name) !== null)
    })

    it('isSupportedProfile is consistent with getProfile returning null for unknown', () => {
      const name = 'unknown-profile'
      expect(isSupportedProfile(name)).toBe(getProfile(name) !== null)
    })
  })
})
