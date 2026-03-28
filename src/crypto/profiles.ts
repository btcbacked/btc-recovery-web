/** Supported key derivation algorithm identifiers. */
export type Algorithm = 'pbkdf2-hmac-sha256'

/** Parameters for a key derivation function used to derive a BIP32 seed from a password. */
export type DerivationProfile = {
  algorithm: Algorithm
  iterations: number
  keyLength: number
}

const PROFILES: Record<string, DerivationProfile> = {
  'pbkdf2-v1': {
    algorithm: 'pbkdf2-hmac-sha256',
    iterations: 100_000,
    keyLength: 64,
  },
}

/** Returns the derivation profile for the given name, or null if not found. */
export function getProfile(name: string): DerivationProfile | null {
  return PROFILES[name] ?? null
}

/** Returns true if the given profile name is recognized by this tool. */
export function isSupportedProfile(name: string): boolean {
  return name in PROFILES
}
