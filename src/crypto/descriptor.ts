import { RecoveryError } from './errors'

/**
 * Bitcoin descriptor checksum algorithm (BIP-380).
 * Ported from Bitcoin Core's DescriptorChecksum implementation.
 */
const INPUT_CHARSET =
  '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ '
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function polymod(c: bigint, val: number): bigint {
  const c0 = Number(c >> 35n)
  c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(val)
  if (c0 & 1) c ^= 0xf5dee51989n
  if (c0 & 2) c ^= 0xa9fdca3312n
  if (c0 & 4) c ^= 0x1bab10e32dn
  if (c0 & 8) c ^= 0x3706b1677an
  if (c0 & 16) c ^= 0x644d626fcdn
  return c
}

/**
 * Computes the BIP-380 checksum for a descriptor string.
 * The input must NOT contain a `#checksum` suffix -- pass only the raw descriptor body.
 */
export function descriptorChecksum(descriptor: string): string {
  let c = 1n
  let cls = 0
  let clsCount = 0

  for (const ch of descriptor) {
    const pos = INPUT_CHARSET.indexOf(ch)
    if (pos === -1) {
      throw new RecoveryError(
        'DESCRIPTOR_ERROR',
        `Invalid character '${ch}' in descriptor.`,
      )
    }
    c = polymod(c, pos & 31)
    cls = cls * 3 + (pos >> 5)
    clsCount++
    if (clsCount === 3) {
      c = polymod(c, cls)
      cls = 0
      clsCount = 0
    }
  }

  if (clsCount > 0) {
    c = polymod(c, cls)
  }

  for (let i = 0; i < 8; i++) {
    c = polymod(c, 0)
  }

  c ^= 1n

  let result = ''
  for (let i = 0; i < 8; i++) {
    result += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & 31n)] ?? ''
  }

  return result
}

/**
 * Replace an xpub with an xprv in a descriptor, matching by fingerprint.
 * Case-insensitive fingerprint matching. Recalculates checksum.
 *
 * The regex matches the pattern `[FINGERPRINT/path]xpub...` or `[FINGERPRINT/path]tpub...`
 * and replaces the extended public key with the provided extended private key.
 * Only the first matching key origin is replaced (via `String.prototype.replace`
 * without the global flag), which is the expected behavior for single-user recovery.
 *
 * Ported from key-recovery/src/descriptor/replacer.rs
 */
export function replaceKeyByFingerprint(
  descriptor: string,
  fingerprint: string,
  xprv: string,
): string {
  // Strip existing checksum if present
  const descriptorWithoutChecksum = descriptor.split('#')[0] ?? descriptor

  // Pattern: [FINGERPRINT/path]xpub... or [FINGERPRINT/path]tpub...
  const pattern = new RegExp(
    `\\[(${escapeRegex(fingerprint)})(/[^\\]]*)\\](x|t)pub([a-zA-Z0-9]+)`,
    'i',
  )

  if (!pattern.test(descriptorWithoutChecksum)) {
    throw new RecoveryError(
      'DESCRIPTOR_ERROR',
      `Your key's fingerprint (${fingerprint}) was not found in the output descriptor. The recovery file may be corrupted.`,
    )
  }

  // Determine prefix from xprv
  let prvPrefix: string
  let xprvKeyPart: string
  if (xprv.startsWith('xprv')) {
    prvPrefix = 'xprv'
    xprvKeyPart = xprv.slice(4)
  } else if (xprv.startsWith('tprv')) {
    prvPrefix = 'tprv'
    xprvKeyPart = xprv.slice(4)
  } else {
    throw new RecoveryError(
      'DESCRIPTOR_ERROR',
      'Extended private key must start with "xprv" or "tprv".',
    )
  }

  const resultWithoutChecksum = descriptorWithoutChecksum.replace(
    pattern,
    (_match, fp, path) => `[${fp}${path}]${prvPrefix}${xprvKeyPart}`,
  )

  // Calculate and append new checksum
  const checksum = descriptorChecksum(resultWithoutChecksum)
  return `${resultWithoutChecksum}#${checksum}`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
