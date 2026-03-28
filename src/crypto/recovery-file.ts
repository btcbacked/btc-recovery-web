import { RecoveryError } from './errors'

export type Network = 'mainnet' | 'testnet' | 'regtest' | 'signet'
export type Role = 'lender' | 'borrower'
export type KeySource = 'PASSWORD' | 'COLD_CARD'

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
  const validKeySources: KeySource[] = ['PASSWORD', 'COLD_CARD']
  if (!validKeySources.includes(key.keySource as KeySource)) {
    throw new RecoveryError('MALFORMED_FILE', `Invalid keySource "${key.keySource}". Must be "PASSWORD" or "COLD_CARD".`)
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
      keySource: key.keySource as KeySource,
      derivationProfile: key.derivationProfile as string | undefined,
      salt: key.salt as string | undefined,
      derivationPath: key.derivationPath as string,
      xpub: key.xpub as string,
      fingerprint: key.fingerprint as string,
    },
  }
}
