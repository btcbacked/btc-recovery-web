import { RecoveryError } from './errors'

export type Network = 'mainnet' | 'testnet' | 'regtest' | 'signet'
export type Role = 'lender' | 'borrower'

/**
 * How the user's key is protected.
 *
 * 'PASSWORD' is the only value this tool can derive a key for. Every other
 * value means the private key lives on a physical device, so the browser can
 * never sign. New device types are added over time (COLD_CARD, LEDGER,
 * TREZOR, OTHER, and whatever comes next), so this is a plain string: an
 * unrecognised value must still open, not be rejected.
 */
export type KeySource = string

const PASSWORD_KEY_SOURCE = 'PASSWORD'

/**
 * True only for keys this tool can rebuild from a password. Anything else,
 * known or not, is treated as a device-held key and takes the hardware path.
 */
export function isPasswordKeySource(keySource: string): boolean {
  return keySource === PASSWORD_KEY_SOURCE
}

/**
 * What we say when the file records a device but not which one. Every escrow
 * created now records exactly that, so this is the common case and not the
 * fallback it looks like.
 */
const GENERIC_HARDWARE_LABEL = 'Hardware wallet'

const KEY_SOURCE_LABELS: Record<string, string> = {
  PASSWORD: 'Password',
  COLD_CARD: 'Coldcard hardware wallet',
  LEDGER: 'Ledger hardware wallet',
  TREZOR: 'Trezor hardware wallet',
  OTHER: GENERIC_HARDWARE_LABEL,
}

/**
 * Plain-language name for a key source, for display to the user.
 * An unrecognised value falls back to the generic device wording rather than
 * showing a raw code the user cannot act on.
 */
export function describeKeySource(keySource: string): string {
  return KEY_SOURCE_LABELS[keySource] ?? GENERIC_HARDWARE_LABEL
}

/**
 * The device's name, for a screen whose heading already says the key is on a
 * hardware wallet. Null when the file does not name a device, because the only
 * thing left to print there is the heading over again.
 *
 * This reads the same `keySource` the file has always carried and infers
 * nothing further from it. A file that records no device still records no
 * device; it simply stops saying so twice.
 */
export function describeKeySourceDevice(keySource: string): string | null {
  if (isPasswordKeySource(keySource)) return null
  const label = describeKeySource(keySource)
  return label === GENERIC_HARDWARE_LABEL ? null : label
}

export type RecoveryFileContext = {
  contractId: string
  role: Role
  threshold: number
  totalKeys: number
}

export type RecoveryFileUserKey = {
  keySource: KeySource
  derivationProfile?: string
  salt?: string
  derivationPath: string
  xpub: string
  fingerprint: string
}

/**
 * Where ONE cosigner's key sits, as data beside the descriptor.
 *
 * `outputDescriptor` publishes every HD leg as the ranged `/0/*`, so a reader
 * that resolves that wildcard at index 0 derives the wrong address for any
 * escrow whose legs sit elsewhere. Two funded escrows are in exactly that
 * state.
 *
 * Optional in the file, so this type describes only what a present entry
 * carries. `resolveCosignerPositions` in `child-derivation.ts` is the only
 * reader, and the six resolution rules live there.
 */
export type RecoveryFileCosigner = {
  /**
   * `borrower`, `lender` or `platform` in every file the platform writes.
   *
   * A plain string and unvalidated, for the same reason `KeySource` is: a role
   * added later must still open. Resolution never reads it, so an unrecognised
   * value costs nothing and an empty one, meaning the file stated none, costs
   * nothing either.
   */
  role: string
  /**
   * Lowercase hex, byte identical to the fingerprint inside this cosigner's
   * `[fingerprint/...]` origin in `outputDescriptor`.
   *
   * NOT comparable to `userKey.fingerprint`, which is uppercase on the same
   * document and always has been. Rule 6 in `child-derivation.ts` exists
   * because those two look like the same field and are not.
   */
  fingerprint: string
  /**
   * The child index below this cosigner's `<origin>/0` branch.
   *
   * NULL MEANS UNKNOWN, and unknown is never 0. Coercing it to 0 is the exact
   * failure the field was added to remove.
   */
  keyIndex: number | null
}

export type RecoveryFile = {
  version: number
  network: Network
  outputDescriptor: string
  /**
   * The address the collateral is at, for this tool to check its own
   * derivation against, or null when the file does not state one.
   *
   * Absent, `null` and an empty string all arrive here as `null`, because all
   * three say the same thing: there is nothing to check against. A null is NOT
   * a pass. It removes the check, which leaves an address nothing corroborates.
   *
   * Optional on the type, like `salt` and `derivationProfile`, because the file
   * format has it optional and a value assembled by hand should be able to say
   * so. `parseRecoveryFile` always sets it, to null when the file states none.
   */
  escrowAddress?: string | null
  /**
   * Every cosigner's child index, or null when the file does not state them.
   *
   * A MISSING ARRAY MEANS EXACTLY `keyIndex: null` ON EVERY LEG. A file written
   * before this field existed and a file where the platform could not state the
   * positions are indistinguishable from outside, so they are treated
   * identically. Rule 5 in `child-derivation.ts`.
   */
  cosigners?: RecoveryFileCosigner[] | null
  context: RecoveryFileContext
  userKey: RecoveryFileUserKey
}

/** One past the largest child index an extended PUBLIC key can derive. */
const HARDENED_OFFSET = 0x80000000

/**
 * The address the file records for the escrow, or null when it records none.
 *
 * A present but non-string value is refused, and this is the one optional field
 * on this document that still refuses. It is the only check that catches a
 * derivation this tool could not settle, and nothing on screen tells a checked
 * address apart from an unchecked one, so degrading it to null would hand the
 * customer an uncorroborated address that reads exactly like a corroborated
 * one. An empty string is not refused: it is not an address, it is the absence
 * of one, and it collapses to the same null as an absent field.
 */
function readEscrowAddress(obj: Record<string, unknown>): string | null {
  const value = obj.escrowAddress
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new RecoveryError(
      'MALFORMED_FILE',
      '"escrowAddress" must be a string if present.',
    )
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The cosigner positions the file records, or null when it records none.
 *
 * The field is optional, so an unreadable one must not refuse the document. A
 * refusal here is a refusal at parse time, which leaves the customer with no
 * descriptor, no key and no address at all, and this tool exists for the case
 * where no second file is coming. On a descriptor that already pins every leg
 * the array is ignored entirely, so refusing on it withheld an escrow that was
 * fully reproducible.
 *
 * THE LINE IS WHETHER THE BAD VALUE STATES A POSITION. A value that states none
 * is dropped, because dropping it discards nothing and leaves the file in the
 * state rules 4 and 5 already define as unknown: an array that is not an array,
 * an entry that is not an object, an entry with no `keyIndex`, and `role`, which
 * resolution never reads at all.
 *
 * A value that DOES state a position this reader cannot use still refuses. A
 * `keyIndex` that is not a derivable child index, and a `keyIndex` on an entry
 * with no fingerprint to join it to, are both the file saying where a leg sits
 * in terms this tool cannot honour. Dropping either leaves the leg ranged and
 * derived at index 0, which is where the same file has just said it is not, and
 * coercing unknown to 0 is the exact failure this field was added to remove.
 */
function readCosigners(obj: Record<string, unknown>): RecoveryFileCosigner[] | null {
  const value = obj.cosigners
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return null

  return value.flatMap((entry: unknown, position: number): RecoveryFileCosigner[] => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const cosigner = entry as Record<string, unknown>

    // Trimmed once and then stored trimmed, the same way `escrowAddress` is.
    // Checking a trimmed value and keeping the untrimmed one would let a
    // fingerprint pass here and then fail the join, which is silent: the leg
    // simply keeps its wildcard.
    const role = typeof cosigner.role === 'string' ? cosigner.role.trim() : ''
    const fingerprint =
      typeof cosigner.fingerprint === 'string' ? cosigner.fingerprint.trim() : ''

    const rawIndex = cosigner.keyIndex
    let keyIndex: number | null = null
    if (rawIndex !== undefined && rawIndex !== null) {
      if (
        typeof rawIndex !== 'number' ||
        !Number.isInteger(rawIndex) ||
        rawIndex < 0 ||
        rawIndex >= HARDENED_OFFSET
      ) {
        throw new RecoveryError(
          'MALFORMED_FILE',
          `"cosigners[${position}].keyIndex" must be an integer if present.`,
        )
      }
      keyIndex = rawIndex
    }

    // An entry with no fingerprint joins no leg. If it states no position
    // either it says nothing at all and is dropped, which is the state rule 5
    // already defines. If it states one, that position is lost and the leg is
    // derived at index 0, which is where this same file has just said it is
    // not, so it refuses on the same terms `keyIndex` does.
    if (fingerprint === '') {
      if (keyIndex === null) return []
      throw new RecoveryError(
        'MALFORMED_FILE',
        `"cosigners[${position}].fingerprint" must be a non-empty string.`,
      )
    }

    return [{ role, fingerprint, keyIndex }]
  })
}

export function parseRecoveryFile(jsonString: string): RecoveryFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch {
    throw new RecoveryError(
      'INVALID_JSON',
      'This file does not contain valid JSON. Please check that you uploaded the correct recovery file.',
    )
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new RecoveryError(
      'INVALID_JSON',
      'This file does not contain a valid JSON object.',
    )
  }

  const obj = parsed as Record<string, unknown>

  // Validate top-level required fields exist
  const requiredFields = ['version', 'network', 'outputDescriptor', 'context', 'userKey']
  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new RecoveryError(
        'MALFORMED_FILE',
        `This recovery file is missing the required "${field}" field.`,
      )
    }
  }

  // Validate version is an integer
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
    throw new RecoveryError('MALFORMED_FILE', 'The "version" field must be an integer.')
  }

  // Validate network
  const validNetworks: Network[] = ['mainnet', 'testnet', 'regtest', 'signet']
  if (!validNetworks.includes(obj.network as Network)) {
    throw new RecoveryError(
      'MALFORMED_FILE',
      `Invalid network "${obj.network}". Must be one of: ${validNetworks.join(', ')}.`,
    )
  }

  // Validate outputDescriptor is string
  if (typeof obj.outputDescriptor !== 'string') {
    throw new RecoveryError('MALFORMED_FILE', 'The "outputDescriptor" field must be a string.')
  }

  // Validate context
  if (typeof obj.context !== 'object' || obj.context === null) {
    throw new RecoveryError('MALFORMED_FILE', 'The "context" field must be an object.')
  }
  const ctx = obj.context as Record<string, unknown>
  for (const field of ['contractId', 'role', 'threshold', 'totalKeys']) {
    if (!(field in ctx)) {
      throw new RecoveryError('MALFORMED_FILE', `Missing "context.${field}" field.`)
    }
  }
  if (typeof ctx.contractId !== 'string') {
    throw new RecoveryError('MALFORMED_FILE', '"context.contractId" must be a string.')
  }
  const validRoles: Role[] = ['lender', 'borrower']
  if (!validRoles.includes(ctx.role as Role)) {
    throw new RecoveryError('MALFORMED_FILE', `Invalid role "${ctx.role}". Must be "lender" or "borrower".`)
  }
  if (typeof ctx.threshold !== 'number' || !Number.isInteger(ctx.threshold)) {
    throw new RecoveryError('MALFORMED_FILE', '"context.threshold" must be an integer.')
  }
  if (typeof ctx.totalKeys !== 'number' || !Number.isInteger(ctx.totalKeys)) {
    throw new RecoveryError('MALFORMED_FILE', '"context.totalKeys" must be an integer.')
  }

  // Validate userKey
  if (typeof obj.userKey !== 'object' || obj.userKey === null) {
    throw new RecoveryError('MALFORMED_FILE', 'The "userKey" field must be an object.')
  }
  const key = obj.userKey as Record<string, unknown>
  for (const field of ['keySource', 'derivationPath', 'xpub', 'fingerprint']) {
    if (!(field in key)) {
      throw new RecoveryError('MALFORMED_FILE', `Missing "userKey.${field}" field.`)
    }
  }
  // Any non-empty string is accepted. New wallet types are added over time and
  // a file this tool has not heard of must still open, so it is only checked
  // for being usable text.
  if (typeof key.keySource !== 'string' || key.keySource.trim() === '') {
    throw new RecoveryError('MALFORMED_FILE', 'The "userKey.keySource" field must be a non-empty string.')
  }

  // Validate optional fields have correct types if present
  if ('derivationProfile' in key && key.derivationProfile !== undefined && typeof key.derivationProfile !== 'string') {
    throw new RecoveryError('MALFORMED_FILE', '"userKey.derivationProfile" must be a string if present.')
  }
  if ('salt' in key && key.salt !== undefined && typeof key.salt !== 'string') {
    throw new RecoveryError('MALFORMED_FILE', '"userKey.salt" must be a string if present.')
  }

  return {
    version: obj.version as number,
    network: obj.network as Network,
    outputDescriptor: obj.outputDescriptor as string,
    escrowAddress: readEscrowAddress(obj),
    cosigners: readCosigners(obj),
    context: {
      contractId: ctx.contractId as string,
      role: ctx.role as Role,
      threshold: ctx.threshold as number,
      totalKeys: ctx.totalKeys as number,
    },
    userKey: {
      keySource: key.keySource,
      derivationProfile: key.derivationProfile as string | undefined,
      salt: key.salt as string | undefined,
      derivationPath: key.derivationPath as string,
      xpub: key.xpub as string,
      fingerprint: key.fingerprint as string,
    },
  }
}
