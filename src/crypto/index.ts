export { parseRecoveryFile } from './recovery-file'
export type { RecoveryFile, Network, Role, KeySource, RecoveryFileContext, RecoveryFileUserKey } from './recovery-file'
export { validate } from './validation'
export { isValidFingerprint, isValidHex, isValidDerivationPath } from './validation'
export { getProfile, isSupportedProfile } from './profiles'
export type { DerivationProfile, Algorithm } from './profiles'
export { deriveSeed, deriveMasterKey, computeFingerprint, deriveXprv, deriveSigningKey } from './derivation'
export { replaceKeyByFingerprint, descriptorChecksum } from './descriptor'
export { RecoveryError, ERROR_MESSAGES } from './errors'
export type { RecoveryErrorCode } from './errors'

// Bitcoin library bootstrap
export { bitcoin, ECPair, ecc } from './bitcoin-lib'

// Network utilities
export { getBitcoinNetwork, getMempoolApiBase } from './networks'

// Descriptor parser
export { parseDescriptor, findUserKey } from './descriptor-parser'
export type { ParsedDescriptor, ParsedKeyEntry } from './descriptor-parser'

// Address derivation
export { deriveMultisigAddress, deriveMultisigAddresses } from './address'
export type { DerivedAddress } from './address'

// Blockchain API
export { fetchUtxos, fetchFeeEstimates, broadcastTransaction } from './blockchain-api'
export type { Utxo, FeeEstimates } from './blockchain-api'

// PSBT codec
export { psbtToBase64, psbtFromBase64, psbtToBuffer, psbtFromBuffer } from './psbt-codec'

// PSBT builder
export { buildPsbt, estimateTxVsize, estimateFee } from './psbt-builder'
export type { TxOutput } from './psbt-builder'

// PSBT signer
export { signPsbtWithXprv } from './psbt-signer'

// PSBT finalizer
export { analyzePsbt, finalizePsbt, extractRawTransaction } from './psbt-finalizer'
export type { PsbtAnalysis, PsbtOutput } from './psbt-finalizer'
