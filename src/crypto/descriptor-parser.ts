import { RecoveryError } from './errors'

export type ParsedKeyEntry = {
  fingerprint: string
  originPath: string
  extendedKey: string
  isPrivate: boolean
  childDerivation: string
}

export type ParsedDescriptor = {
  scriptType: 'wsh'
  multisigType: 'sortedmulti'
  threshold: number
  keys: ParsedKeyEntry[]
  raw: string
}

/**
 * Parse a wsh(sortedmulti(...)) descriptor into its constituent parts.
 *
 * Expected format:
 *   wsh(sortedmulti(2,[FP/path]xpub.../0/*,...))#checksum
 */
export function parseDescriptor(descriptor: string): ParsedDescriptor {
  // Strip checksum if present
  const raw = (descriptor.trim().split('#')[0] ?? descriptor.trim())

  // Match outer structure: wsh(sortedmulti(N, ...))
  const outerMatch = raw.match(
    /^wsh\(sortedmulti\((\d+),(.+)\)\)$/,
  )
  if (!outerMatch) {
    throw new RecoveryError(
      'DESCRIPTOR_ERROR',
      'Unsupported descriptor format. Expected wsh(sortedmulti(...)).',
    )
  }

  const threshold = parseInt(outerMatch[1]!, 10)
  if (threshold <= 0) {
    throw new RecoveryError(
      'DESCRIPTOR_ERROR',
      `Invalid threshold: ${threshold}. Must be greater than zero.`,
    )
  }
  const keysString = outerMatch[2]!

  // Parse each key entry.
  // Keys are comma-separated, but we need to be careful since paths contain slashes.
  // Pattern: [fingerprint/origin_path]extended_key/child_derivation
  const keyPattern =
    /\[([0-9a-fA-F]{8})([^\]]*)\]((?:x|t)(?:pub|prv)[a-zA-Z0-9]+)(\/[^\],)]*)?/g

  const keys: ParsedKeyEntry[] = []
  let match: RegExpExecArray | null

  while ((match = keyPattern.exec(keysString)) !== null) {
    const fingerprint = match[1]!
    const originPath = match[2]?.replace(/^\//, '') ?? ''
    const extendedKey = match[3]!
    const childDerivation = (match[4] ?? '').replace(/^\//, '')

    const isPrivate =
      extendedKey.startsWith('xprv') || extendedKey.startsWith('tprv')

    keys.push({
      fingerprint,
      originPath,
      extendedKey,
      isPrivate,
      childDerivation,
    })
  }

  if (keys.length === 0) {
    throw new RecoveryError(
      'DESCRIPTOR_ERROR',
      'No valid keys found in the descriptor.',
    )
  }

  if (threshold > keys.length) {
    throw new RecoveryError(
      'DESCRIPTOR_ERROR',
      `Threshold (${threshold}) exceeds the number of keys (${keys.length}).`,
    )
  }

  return {
    scriptType: 'wsh',
    multisigType: 'sortedmulti',
    threshold,
    keys,
    raw,
  }
}

/**
 * Find a specific key in the parsed descriptor by its master fingerprint.
 * Case-insensitive comparison.
 */
export function findUserKey(
  parsed: ParsedDescriptor,
  fingerprint: string,
): { index: number; key: ParsedKeyEntry } | null {
  const fpLower = fingerprint.toLowerCase()
  const index = parsed.keys.findIndex(
    (k) => k.fingerprint.toLowerCase() === fpLower,
  )
  if (index === -1) return null
  return { index, key: parsed.keys[index]! }
}
