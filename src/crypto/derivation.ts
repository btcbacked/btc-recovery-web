import * as ecc from '@bitcoinerlab/secp256k1'
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'
import type { Network } from './recovery-file'
import type { DerivationProfile } from './profiles'
import { RecoveryError } from './errors'

const bip32 = BIP32Factory(ecc)

function getNetworkConfig(network: Network): {
  bip32: { public: number; private: number }
  wif: number
} {
  if (network === 'mainnet') {
    return {
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
      wif: 0x80,
    }
  }
  // testnet, regtest, signet all use the same version bytes
  return {
    bip32: { public: 0x043587cf, private: 0x04358394 },
    wif: 0xef,
  }
}

function normalizeDerivationPath(path: string): string {
  // Add m/ prefix if missing
  let normalized = path.startsWith('m/') ? path : `m/${path}`
  // Convert 'h' hardened notation to apostrophe (bip32 npm only accepts ')
  normalized = normalized.replace(/h\b/g, "'")
  return normalized
}

/**
 * Derives a BIP-32 seed (512 bits / 64 bytes) from a password using PBKDF2-HMAC-SHA256.
 * Uses the Web Crypto API for hardware-accelerated key derivation.
 */
export async function deriveSeed(
  password: string,
  saltHex: string,
  profile: DerivationProfile,
): Promise<string> {
  if (!crypto?.subtle) {
    throw new RecoveryError(
      'DERIVATION_ERROR',
      'Your browser does not support the Web Crypto API. Please use a modern browser with a secure (HTTPS) connection.',
    )
  }

  if (profile.keyLength !== 64) {
    throw new RecoveryError(
      'DERIVATION_ERROR',
      'Derivation profile must produce 64-byte output for BIP32 seed.',
    )
  }

  const encoder = new TextEncoder()
  const passwordBuffer = encoder.encode(password)

  const saltMatch = saltHex.match(/.{2}/g)
  if (!saltMatch) {
    throw new RecoveryError(
      'DERIVATION_ERROR',
      'Salt is empty or invalid. The recovery file may be corrupted.',
    )
  }
  const saltBuffer = new Uint8Array(
    saltMatch.map((byte) => parseInt(byte, 16)),
  )

  try {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    )

    const seedBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: profile.iterations,
        hash: 'SHA-256',
      },
      passwordKey,
      512, // 512 bits = 64 bytes
    )

    const seedBytes = new Uint8Array(seedBuffer)
    const hex = Buffer.from(seedBytes).toString('hex')
    seedBytes.fill(0)
    return hex
  } finally {
    passwordBuffer.fill(0)
    saltBuffer.fill(0)
  }
}

/**
 * Derives the BIP32 master extended private key from a seed.
 */
export function deriveMasterKey(
  seedHex: string,
  network: Network,
) {
  const networkConfig = getNetworkConfig(network)
  const seedBuffer = Buffer.from(seedHex, 'hex')
  // NOTE: do NOT zero seedBuffer here — bip32.fromSeed keeps an internal
  // reference to it. Zeroing would corrupt the returned BIP32 node.
  return bip32.fromSeed(seedBuffer, networkConfig)
}

/**
 * Computes the master fingerprint (first 4 bytes of HASH160 of the public key).
 * Returns an 8-character uppercase hex string.
 */
export function computeFingerprint(
  seedHex: string,
  network: Network,
): string {
  const master = deriveMasterKey(seedHex, network)
  return Buffer.from(master.fingerprint).toString('hex').toUpperCase()
}

/**
 * Derives a child key at the given BIP32 path from a seed.
 * Returns the base58-encoded extended private key (xprv/tprv).
 */
export function deriveXprv(
  seedHex: string,
  derivationPath: string,
  network: Network,
): string {
  const master = deriveMasterKey(seedHex, network)
  const path = normalizeDerivationPath(derivationPath)
  const child = master.derivePath(path)
  return child.toBase58()
}

/**
 * Full derivation pipeline: password -> seed -> fingerprint check -> xprv.
 * Returns the xprv string or throws RecoveryError on fingerprint mismatch.
 */
export async function deriveSigningKey(
  password: string,
  saltHex: string,
  derivationPath: string,
  expectedFingerprint: string,
  network: Network,
  profile: DerivationProfile,
): Promise<string> {
  const seedHex = await deriveSeed(password, saltHex, profile)

  const actualFingerprint = computeFingerprint(seedHex, network)
  if (actualFingerprint !== expectedFingerprint.toUpperCase()) {
    throw new RecoveryError(
      'FINGERPRINT_MISMATCH',
      'The password you entered does not match this recovery file. Please check your password and try again.',
      `Expected fingerprint: ${expectedFingerprint}, got: ${actualFingerprint}`,
    )
  }

  return deriveXprv(seedHex, derivationPath, network)
}
