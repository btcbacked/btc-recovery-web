import { useState, useCallback } from 'react'
import type { RecoveryFile } from '@/crypto'

export type WizardStep = 'upload' | 'info' | 'password' | 'hardware' | 'deriving' | 'result' | 'guide'

type WizardState = {
  step: WizardStep
  recoveryFile: RecoveryFile | null
  descriptor: string | null
  error: string | null
  passwordError: string | null
}

export function useRecoveryWizard() {
  const [state, setState] = useState<WizardState>({
    step: 'upload',
    recoveryFile: null,
    descriptor: null,
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
      error: null,
      passwordError: null,
    })
  }, [])

  const stepNumber = (() => {
    switch (state.step) {
      case 'upload': return 1
      case 'info': return 2
      case 'password':
      case 'hardware': return 3
      case 'deriving': return 4
      case 'result': return 5
      case 'guide': return 6
      default: {
        const _exhaustive: never = state.step
        return _exhaustive
      }
    }
  })()

  return {
    ...state,
    stepNumber,
    setStep,
    setRecoveryFile,
    setDescriptor,
    setError,
    setPasswordError,
    reset,
  }
}
