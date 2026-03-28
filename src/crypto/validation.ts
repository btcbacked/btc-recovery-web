import type { RecoveryFile } from './recovery-file'
import { RecoveryError } from './errors'
import { isSupportedProfile } from './profiles'

const SUPPORTED_VERSION = 1

export function validate(file: RecoveryFile): void {
  validateVersion(file.version)
  validateContext(file)
  validateUserKey(file)
  validateOutputDescriptor(file)
}

function validateVersion(version: number): void {
  if (version !== SUPPORTED_VERSION) {
    throw new RecoveryError(
      'UNSUPPORTED_VERSION',
      `This recovery file uses format version ${version}, but this tool only supports version ${SUPPORTED_VERSION}. You may need a newer version of this recovery tool.`,
    )
  }
}

function validateContext(file: RecoveryFile): void {
  if (!file.context.contractId) {
    throw new RecoveryError('MALFORMED_FILE', 'Contract ID cannot be empty.')
  }
  if (!Number.isInteger(file.context.threshold) || file.context.threshold <= 0) {
    throw new RecoveryError('MALFORMED_FILE', 'Multisig threshold must be a positive integer.')
  }
  if (!Number.isInteger(file.context.totalKeys) || file.context.totalKeys < file.context.threshold) {
    throw new RecoveryError('MALFORMED_FILE', 'Total keys must be an integer greater than or equal to the threshold.')
  }
}

function validateUserKey(file: RecoveryFile): void {
  const key = file.userKey

  if (!isValidFingerprint(key.fingerprint)) {
    throw new RecoveryError(
      'MALFORMED_FILE',
      `Invalid fingerprint "${key.fingerprint}". Must be exactly 8 hexadecimal characters.`,
    )
  }

  if (!isValidDerivationPath(key.derivationPath)) {
    throw new RecoveryError(
      'MALFORMED_FILE',
      `Invalid derivation path "${key.derivationPath}".`,
    )
  }

  if (!key.xpub) {
    throw new RecoveryError('MALFORMED_FILE', 'Extended public key (xpub) cannot be empty.')
  }

  if (key.keySource === 'PASSWORD') {
    if (!key.derivationProfile) {
      throw new RecoveryError(
        'MALFORMED_FILE',
        'Derivation profile is required for password-derived keys.',
      )
    }
    if (!isSupportedProfile(key.derivationProfile)) {
      throw new RecoveryError(
        'UNSUPPORTED_PROFILE',
        `Unsupported derivation profile "${key.derivationProfile}". This tool may need to be updated.`,
      )
    }
    if (!key.salt) {
      throw new RecoveryError('MALFORMED_FILE', 'Salt is required for password-derived keys.')
    }
    if (!isValidHex(key.salt)) {
      throw new RecoveryError(
        'MALFORMED_FILE',
        'Salt must be a valid hexadecimal string with even length.',
      )
    }
  }
}

function validateOutputDescriptor(file: RecoveryFile): void {
  if (!file.outputDescriptor) {
    throw new RecoveryError('MALFORMED_FILE', 'Output descriptor cannot be empty.')
  }
}

export function isValidFingerprint(s: string): boolean {
  return /^[0-9a-fA-F]{8}$/.test(s)
}

export function isValidHex(s: string): boolean {
  return s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s)
}

export function isValidDerivationPath(s: string): boolean {
  const path = s.startsWith('m/') ? s.slice(2) : s
  if (!path) return false

  const components = path.split('/')
  for (const component of components) {
    const numStr = component.replace(/[h']$/, '')
    const num = parseInt(numStr, 10)
    if (isNaN(num) || num < 0 || numStr !== String(num)) return false
    // BIP32 index must be less than 2^31 (hardened flag is handled separately)
    if (num >= 2147483648) return false
  }
  return true
}
