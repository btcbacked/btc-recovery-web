import * as ecc from '@bitcoinerlab/secp256k1'
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'
import type { Network } from './recovery-file'
import type { DerivationProfile } from './profiles'
import {
  RecoveryError,
  KEY_MISMATCH_UNCHECKABLE,
  KEY_MISMATCH_INCONSISTENT_FILE,
} from './errors'

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
  // Convert the 'h' hardened marker to an apostrophe, which is all bip32
  // accepts. Lowercase only, deliberately: an unrecognised marker such as
  // "48H" is NOT silently mis-derived here. It fails bip32's own path format
  // check and throws, and isValidDerivationPath rejects the file before that.
  // Both this tool and the Rust CLI fail closed on H, so the marker set stays
  // the same in both. (psbt-builder.ts needs the case-insensitive form for a
  // different reason: PSBT encoding silently unhardens what it cannot parse.)
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
 * The extended PUBLIC key for an extended private key, as base58.
 * This is the value a recovery file records, so it is what a derived key has
 * to be compared against.
 */
export function neuterXprv(xprv: string, network: Network): string {
  return bip32
    .fromBase58(xprv, getNetworkConfig(network))
    .neutered()
    .toBase58()
}

export type XpubCheckResult = 'match' | 'mismatch' | 'unreadable'

/**
 * Reads an extended public key without insisting on one network.
 *
 * Version bytes are a serialisation detail: they take no part in derivation,
 * and a file written by an older server can carry the other network's prefix
 * for the same key. Only the key material has to agree, so the string is tried
 * against both version byte sets. Returns null when it is not a readable
 * extended key at all.
 */
function parseExtendedKeyAnyNetwork(extendedKey: string) {
  for (const network of ['mainnet', 'testnet'] as const) {
    try {
      return bip32.fromBase58(extendedKey, getNetworkConfig(network))
    } catch {
      // Try the other version bytes.
    }
  }
  return null
}

/**
 * Checks a derived extended private key against the extended public key the
 * recovery file records for it.
 *
 * The master fingerprint check proves the password rebuilt the right wallet.
 * It says nothing about the path, because the fingerprint is taken at depth 0.
 * The recorded xpub is the only value in the file that pins the path, so it is
 * the only thing that can catch a stale or wrong derivationPath, which would
 * otherwise produce a valid looking key, a valid descriptor, a plausible
 * address and the wrong signature.
 *
 * Compares the public key and the chain code rather than the base58 strings,
 * so a difference in version bytes alone is not read as a different key.
 */
export function checkDerivedKeyAgainstXpub(
  xprv: string,
  expectedXpub: string,
  network: Network,
): XpubCheckResult {
  const expected = parseExtendedKeyAnyNetwork(expectedXpub)
  // A private key in the xpub field is not a public key. Reading it as one
  // would bless a file that records something it must never contain.
  if (!expected || !expected.isNeutered()) return 'unreadable'

  const derived = bip32.fromBase58(xprv, getNetworkConfig(network)).neutered()

  return sameKeyMaterial(derived, expected) ? 'match' : 'mismatch'
}

/**
 * True when two BIP32 nodes are the same key.
 *
 * Both halves matter. The public key alone does not identify a node: two nodes
 * can share a public key and carry different chain codes, and every child
 * derived from them then differs, so the addresses and the signatures do too.
 */
function sameKeyMaterial(
  a: { publicKey: Uint8Array; chainCode: Uint8Array },
  b: { publicKey: Uint8Array; chainCode: Uint8Array },
): boolean {
  return (
    Buffer.compare(Buffer.from(a.publicKey), Buffer.from(b.publicKey)) === 0 &&
    Buffer.compare(Buffer.from(a.chainCode), Buffer.from(b.chainCode)) === 0
  )
}

/**
 * Compares two extended keys, in either serialisation, by key material only.
 *
 * Used to check the extended public key a recovery file records for the user
 * against the one the file's own descriptor carries for the same fingerprint.
 * Those two values come from the same place today, so this is a guard against
 * future drift rather than a fix for a known defect.
 */
export function checkExtendedKeysMatch(a: string, b: string): XpubCheckResult {
  const left = parseExtendedKeyAnyNetwork(a)
  const right = parseExtendedKeyAnyNetwork(b)
  // Both sides are meant to be public keys. An extended PRIVATE key carries the
  // same public key and chain code as its neutered form, so it would compare
  // equal and quietly bless a file that records something it must never
  // contain. Read as unreadable instead.
  if (!left || !right || !left.isNeutered() || !right.isNeutered()) {
    return 'unreadable'
  }

  return sameKeyMaterial(left, right) ? 'match' : 'mismatch'
}

/**
 * Everything needed to rebuild one signing key, as a named set.
 *
 * Named rather than positional on purpose: `derivationPath`,
 * `expectedFingerprint` and `expectedXpub` are all plain strings, so a
 * transposed pair would type check and then tell a customer with the right
 * password that their password is wrong.
 */
export type SigningKeyRequest = {
  password: string
  saltHex: string
  /** The path the recovery file records. Any depth. */
  derivationPath: string
  /** Master fingerprint from the file, checked at depth 0. */
  expectedFingerprint: string
  /** Extended public key from the file, checked at `derivationPath`. */
  expectedXpub: string
  network: Network
  profile: DerivationProfile
}

/**
 * Full derivation pipeline: password -> seed -> fingerprint check -> xprv ->
 * check the rebuilt key against the xpub in the file.
 * Returns the xprv string or throws RecoveryError if either check fails.
 */
export async function deriveSigningKey({
  password,
  saltHex,
  derivationPath,
  expectedFingerprint,
  expectedXpub,
  network,
  profile,
}: SigningKeyRequest): Promise<string> {
  const seedHex = await deriveSeed(password, saltHex, profile)

  const actualFingerprint = computeFingerprint(seedHex, network)
  if (actualFingerprint !== expectedFingerprint.toUpperCase()) {
    throw new RecoveryError(
      'FINGERPRINT_MISMATCH',
      'The password you entered does not match this recovery file. Please check your password and try again.',
      `Expected fingerprint: ${expectedFingerprint}, got: ${actualFingerprint}`,
    )
  }

  const xprv = deriveXprv(seedHex, derivationPath, network)

  const check = checkDerivedKeyAgainstXpub(xprv, expectedXpub, network)
  if (check === 'unreadable') {
    throw new RecoveryError(
      'KEY_MISMATCH',
      KEY_MISMATCH_UNCHECKABLE,
      `Recorded xpub could not be read as an extended public key: ${expectedXpub}`,
    )
  }
  if (check === 'mismatch') {
    throw new RecoveryError(
      'KEY_MISMATCH',
      KEY_MISMATCH_INCONSISTENT_FILE,
      `Path ${derivationPath} produced ${neuterXprv(xprv, network)}, but the file records ${expectedXpub}`,
    )
  }

  return xprv
}
