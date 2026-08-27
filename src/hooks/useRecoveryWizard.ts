import { useState, useCallback } from 'react'
import type { RecoveryFile } from '@/crypto'
import type { ParsedDescriptor } from '@/crypto/descriptor-parser'

export type WizardStep =
  | 'upload' | 'info' | 'password' | 'hardware' | 'deriving' | 'result'
  | 'guide'
  | 'action-choice'
  // Path A: create and sign a new transaction
  | 'wallet-view' | 'build-tx' | 'review-sign' | 'export-psbt'
  // Path B: import and sign an existing PSBT
  | 'import-psbt' | 'review-psbt' | 'sign-finalize' | 'broadcast'

type WizardState = {
  step: WizardStep
  recoveryFile: RecoveryFile | null
  descriptor: string | null
  xprv: string | null
  parsedDescriptor: ParsedDescriptor | null
  error: string | null
  passwordError: string | null
  /**
   * Set when the file's recorded derivation path and its own descriptor bracket
   * disagree. Held apart from `error` and `passwordError` on purpose: those are
   * cleared on every step change, and this one has to survive the walk from the
   * file details screen to the screen that hands over the descriptor.
   */
  originPathWarning: string | null
  /**
   * Set when `parseDescriptor` was run on this file's descriptor and threw.
   *
   * Held apart from `parsedDescriptor === null`, which is also every step
   * before a file is opened and on the password path every step before the
   * password succeeds. Neither of those is a refusal. Without this flag the
   * parse failure is indistinguishable from "not yet", so the customer is
   * handed the file with no address, no balance and no warning, and the sign
   * button dies with nothing said.
   */
  descriptorUnreadable: boolean
}

export function useRecoveryWizard() {
  const [state, setState] = useState<WizardState>({
    step: 'upload',
    recoveryFile: null,
    descriptor: null,
    xprv: null,
    parsedDescriptor: null,
    error: null,
    passwordError: null,
    originPathWarning: null,
    descriptorUnreadable: false,
  })

  const setStep = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, step, error: null, passwordError: null }))
  }, [])

  const setRecoveryFile = useCallback((file: RecoveryFile) => {
    // Everything derived from a file belongs to THAT file, so a second upload
    // must not inherit the first one's. `parsedDescriptor` is the one that
    // matters: it is the gate both sign handlers read, and the wizard checks it
    // against the NEW file's recorded escrow address, so a stale one from file
    // A judged against file B is a comparison of two unrelated escrows.
    setState((prev) => ({
      ...prev,
      recoveryFile: file,
      descriptor: null,
      xprv: null,
      parsedDescriptor: null,
      error: null,
      originPathWarning: null,
      descriptorUnreadable: false,
    }))
  }, [])

  const setDescriptor = useCallback((descriptor: string) => {
    setState((prev) => ({ ...prev, descriptor }))
  }, [])

  const setXprv = useCallback((xprv: string | null) => {
    setState((prev) => ({ ...prev, xprv }))
  }, [])

  const setParsedDescriptor = useCallback((parsedDescriptor: ParsedDescriptor | null) => {
    setState((prev) => ({ ...prev, parsedDescriptor }))
  }, [])

  const setDescriptorUnreadable = useCallback((descriptorUnreadable: boolean) => {
    setState((prev) => ({ ...prev, descriptorUnreadable }))
  }, [])

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, error }))
  }, [])

  const setPasswordError = useCallback((passwordError: string | null) => {
    setState((prev) => ({ ...prev, passwordError }))
  }, [])

  const setOriginPathWarning = useCallback((originPathWarning: string | null) => {
    setState((prev) => ({ ...prev, originPathWarning }))
  }, [])

  const reset = useCallback(() => {
    setState({
      step: 'upload',
      recoveryFile: null,
      descriptor: null,
      xprv: null,
      parsedDescriptor: null,
      error: null,
      passwordError: null,
      originPathWarning: null,
      descriptorUnreadable: false,
    })
  }, [])

  const stepNumber = (() => {
    switch (state.step) {
      // Shared prefix — steps 1-5
      case 'upload': return 1
      case 'info': return 2
      case 'password':
      case 'hardware': return 3
      case 'deriving': return 4
      case 'result': return 5
      case 'action-choice': return 6

      // Guide path (legacy hardware wallet flow). Seven, not six: this path's
      // labels are the six shared ones plus 'Export', and Export is the screen
      // being shown. Six highlighted 'Choose', the step already behind them,
      // and left 'Export' rendered as a future step nobody had reached, in the
      // chip and in its aria-label both.
      case 'guide': return 7

      // Path A: create transaction
      case 'wallet-view': return 7
      case 'build-tx': return 8
      case 'review-sign': return 9
      case 'export-psbt': return 10

      // Path B: import & sign PSBT
      case 'import-psbt': return 7
      case 'review-psbt': return 8
      case 'sign-finalize': return 9
      case 'broadcast': return 10

      default: {
        const _exhaustive: never = state.step
        return _exhaustive
      }
    }
  })()

  // Determine which path is active (for dynamic step labels)
  const activePath: 'none' | 'a' | 'b' = (() => {
    const pathA: WizardStep[] = ['wallet-view', 'build-tx', 'review-sign', 'export-psbt']
    const pathB: WizardStep[] = ['import-psbt', 'review-psbt', 'sign-finalize', 'broadcast']
    if (pathA.includes(state.step)) return 'a'
    if (pathB.includes(state.step)) return 'b'
    return 'none'
  })()

  return {
    ...state,
    stepNumber,
    activePath,
    setStep,
    setRecoveryFile,
    setDescriptor,
    setXprv,
    setParsedDescriptor,
    setDescriptorUnreadable,
    setError,
    setPasswordError,
    setOriginPathWarning,
    reset,
  }
}
