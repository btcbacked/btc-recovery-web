import { useState, useCallback } from 'react'
import { deriveSigningKey, replaceKeyByFingerprint, getProfile, RecoveryError } from '@/crypto'
import type { RecoveryFile } from '@/crypto'

type DerivationState = {
  isDeriving: boolean
  error: string | null
}

export function useDerivation() {
  const [state, setState] = useState<DerivationState>({
    isDeriving: false,
    error: null,
  })

  const derive = useCallback(
    async (
      password: string,
      file: RecoveryFile,
    ): Promise<string | null> => {
      setState({ isDeriving: true, error: null })

      try {
        if (file.userKey.keySource !== 'PASSWORD') {
          throw new RecoveryError(
            'HARDWARE_KEY',
            'Hardware wallet key detected. No password needed — import the descriptor directly into your wallet software.',
          )
        }

        if (!file.userKey.derivationProfile || !file.userKey.salt) {
          throw new RecoveryError(
            'MALFORMED_FILE',
            'Derivation profile and salt are required for password-derived keys.',
          )
        }

        const profile = getProfile(file.userKey.derivationProfile)
        if (!profile) {
          throw new RecoveryError(
            'UNSUPPORTED_PROFILE',
            `Unsupported derivation profile: ${file.userKey.derivationProfile}`,
          )
        }

        const xprv = await deriveSigningKey(
          password,
          file.userKey.salt,
          file.userKey.derivationPath,
          file.userKey.fingerprint,
          file.network,
          profile,
        )

        const descriptor = replaceKeyByFingerprint(
          file.outputDescriptor,
          file.userKey.fingerprint,
          xprv,
        )

        setState({ isDeriving: false, error: null })
        return descriptor
      } catch (err) {
        console.error('[useDerivation] Error during key derivation:', err)
        const message =
          err instanceof RecoveryError
            ? err.userMessage
            : `An unexpected error occurred during key derivation. ${err instanceof Error ? err.message : String(err)}`
        setState({ isDeriving: false, error: message })
        return null
      }
    },
    [],
  )

  return {
    isDeriving: state.isDeriving,
    derivationError: state.error,
    derive,
  }
}
