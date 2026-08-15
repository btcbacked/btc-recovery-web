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

const KEY_SOURCE_LABELS: Record<string, string> = {
  PASSWORD: 'Password',
  COLD_CARD: 'Coldcard hardware wallet',
  LEDGER: 'Ledger hardware wallet',
  TREZOR: 'Trezor hardware wallet',
  OTHER: 'Hardware wallet',
}

/**
 * Plain-language name for a key source, for display to the user.
 * An unrecognised value falls back to the generic device wording rather than
 * showing a raw code the user cannot act on.
 */
export function describeKeySource(keySource: string): string {
  return KEY_SOURCE_LABELS[keySource] ?? 'Hardware wallet'
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

export type RecoveryFile = {
  version: number
  network: Network
  outputDescriptor: string
  context: RecoveryFileContext
  userKey: RecoveryFileUserKey
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
