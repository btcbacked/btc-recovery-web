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
  })

  const setStep = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, step, error: null, passwordError: null }))
  }, [])

  const setRecoveryFile = useCallback((file: RecoveryFile) => {
    setState((prev) => ({ ...prev, recoveryFile: file, error: null }))
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

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, error }))
  }, [])

  const setPasswordError = useCallback((passwordError: string | null) => {
    setState((prev) => ({ ...prev, passwordError }))
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

      // Guide path (legacy hardware wallet flow)
      case 'guide': return 6

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
    setError,
    setPasswordError,
    reset,
  }
}
