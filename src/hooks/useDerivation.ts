import { useState, useCallback } from 'react'
import { deriveSigningKey, replaceKeyByFingerprint, getProfile, isPasswordKeySource, RecoveryError, ERROR_MESSAGES } from '@/crypto'
import type { RecoveryFile } from '@/crypto'

/**
 * The outcome of one derivation attempt.
 *
 * It is returned rather than published as hook state on purpose. The caller
 * runs inside a callback captured on an earlier render, so reading the error
 * back out of state gave it the value from before the attempt: null on the
 * first failure. That turned a "this file disagrees with itself" message into
 * a wrong-password accusation aimed at the one customer whose password is
 * provably correct.
 */
export type DeriveResult =
  | { descriptor: string; error: null }
  | { descriptor: null; error: string }

export function useDerivation() {
  const [isDeriving, setIsDeriving] = useState(false)

  const derive = useCallback(
    async (
      password: string,
      file: RecoveryFile,
    ): Promise<DeriveResult> => {
      setIsDeriving(true)

      try {
        if (!isPasswordKeySource(file.userKey.keySource)) {
          throw new RecoveryError('HARDWARE_KEY', ERROR_MESSAGES.HARDWARE_KEY)
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

        const xprv = await deriveSigningKey({
          password,
          saltHex: file.userKey.salt,
          derivationPath: file.userKey.derivationPath,
          expectedFingerprint: file.userKey.fingerprint,
          expectedXpub: file.userKey.xpub,
          network: file.network,
          profile,
        })

        const descriptor = replaceKeyByFingerprint(
          file.outputDescriptor,
          file.userKey.fingerprint,
          xprv,
          file.userKey.xpub,
        )

        return { descriptor, error: null }
      } catch (err) {
        console.error('[useDerivation] Error during key derivation:', err)
        const message =
          err instanceof RecoveryError
            ? err.userMessage
            : `Something went wrong while rebuilding your key. ${err instanceof Error ? err.message : String(err)}`
        return { descriptor: null, error: message }
      } finally {
        setIsDeriving(false)
      }
    },
    [],
  )

  return { isDeriving, derive }
}
