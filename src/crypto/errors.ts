export type RecoveryErrorCode =
  | 'INVALID_JSON'
  | 'MALFORMED_FILE'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_PROFILE'
  | 'HARDWARE_KEY'
  | 'FINGERPRINT_MISMATCH'
  | 'DERIVATION_ERROR'
  | 'DESCRIPTOR_ERROR'
  | 'NETWORK_ERROR'
  | 'PSBT_ERROR'
  | 'TRANSACTION_ERROR'
  | 'ADDRESS_ERROR'

export class RecoveryError extends Error {
  constructor(
    public readonly code: RecoveryErrorCode,
    public readonly userMessage: string,
    public readonly detail?: string,
  ) {
    super(userMessage)
    this.name = 'RecoveryError'
  }
}

export const ERROR_MESSAGES: Record<RecoveryErrorCode, string> = {
  INVALID_JSON:
    'This file does not contain valid JSON. Please check that you uploaded the correct recovery file.',
  MALFORMED_FILE:
    'This recovery file is missing required information or has invalid data.',
  UNSUPPORTED_VERSION:
    'This recovery file uses a newer format version. Please update this tool.',
  UNSUPPORTED_PROFILE:
    'This recovery file uses an unknown key derivation method.',
  HARDWARE_KEY:
    'Hardware wallet key detected. No password needed — import the descriptor directly into your wallet software.',
  FINGERPRINT_MISMATCH:
    'The password you entered does not match this recovery file. Please check your password and try again.',
  DERIVATION_ERROR: 'An error occurred during key derivation. Please try again.',
  DESCRIPTOR_ERROR:
    'An error occurred while preparing the output descriptor.',
  NETWORK_ERROR:
    'A network error occurred while communicating with the blockchain API. Check your connection.',
  PSBT_ERROR:
    'An error occurred while processing the partially signed Bitcoin transaction.',
  TRANSACTION_ERROR:
    'An error occurred while building or broadcasting the transaction.',
  ADDRESS_ERROR:
    'An error occurred while deriving a multisig address from the descriptor.',
}
