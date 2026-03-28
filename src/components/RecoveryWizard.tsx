import { useCallback, Component } from 'react'
import type { ReactNode } from 'react'
import { SecurityBadge } from '@/components/SecurityBadge'
import { StepIndicator } from '@/components/StepIndicator'
import { UploadStep } from '@/components/steps/UploadStep'
import { FileInfoStep } from '@/components/steps/FileInfoStep'
import { PasswordStep } from '@/components/steps/PasswordStep'
import { HardwareStep } from '@/components/steps/HardwareStep'
import { DerivingStep } from '@/components/steps/DerivingStep'
import { ResultStep } from '@/components/steps/ResultStep'
import { WalletGuideStep } from '@/components/steps/WalletGuideStep'
import { useRecoveryWizard } from '@/hooks/useRecoveryWizard'
import { useDerivation } from '@/hooks/useDerivation'
import type { RecoveryFile } from '@/crypto'

const STEP_LABELS = ['Upload', 'Verify', 'Authenticate', 'Derive', 'Result', 'Import']

// Error boundary wrapping the wizard content
type ErrorBoundaryState = { hasError: boolean; message: string }
class WizardErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.'
    return { hasError: true, message }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-4 text-center">
          <p className="text-sm font-medium text-destructive">Something went wrong</p>
          <p className="text-xs text-muted-foreground">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="btn-primary rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function RecoveryWizard() {
  const wizard = useRecoveryWizard()
  const { derive, derivationError } = useDerivation()

  // Destructure stable setters so useCallback deps are precise
  const { setRecoveryFile, setStep, setPasswordError, setDescriptor, reset } = wizard

  const handleFileLoaded = useCallback(
    (file: RecoveryFile) => {
      setRecoveryFile(file)
      setStep('info')
    },
    [setRecoveryFile, setStep],
  )

  const handleInfoConfirm = useCallback(() => {
    if (!wizard.recoveryFile) return
    if (wizard.recoveryFile.userKey.keySource === 'PASSWORD') {
      setStep('password')
    } else {
      setStep('hardware')
    }
  }, [wizard.recoveryFile, setStep])

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      if (!wizard.recoveryFile) return
      setPasswordError(null)
      setStep('deriving')

      const descriptor = await derive(password, wizard.recoveryFile)
      if (descriptor) {
        setDescriptor(descriptor)
        setStep('result')
      } else {
        setStep('password')
        setPasswordError(
          derivationError ??
            'The password you entered does not match this recovery file. Please check your password and try again.',
        )
      }
    },
    [wizard.recoveryFile, derive, derivationError, setPasswordError, setStep, setDescriptor],
  )

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <SecurityBadge />
      </div>

      <StepIndicator
        currentStep={wizard.stepNumber}
        totalSteps={6}
        labels={STEP_LABELS}
      />

      {/* Main card — glass-morphism + ambient glow */}
      <div
        className="glass-card rounded-[var(--radius-surface)] border p-6 md:p-8"
        style={{ boxShadow: 'var(--auth-card-glow)' }}
      >
        <WizardErrorBoundary>
          {/* Each step is wrapped in a keyed div so it re-mounts and plays the
              entrance animation whenever the step changes. */}
          {wizard.step === 'upload' && (
            <div key="upload" className="animate-step-enter">
              <UploadStep onFileLoaded={handleFileLoaded} />
            </div>
          )}
          {wizard.step === 'info' && wizard.recoveryFile && (
            <div key="info" className="animate-step-enter">
              <FileInfoStep
                file={wizard.recoveryFile}
                onConfirm={handleInfoConfirm}
                onBack={() => setStep('upload')}
              />
            </div>
          )}
          {wizard.step === 'password' && (
            <div key="password" className="animate-step-enter">
              <PasswordStep
                onSubmit={handlePasswordSubmit}
                error={wizard.passwordError}
                onBack={() => setStep('info')}
              />
            </div>
          )}
          {wizard.step === 'hardware' && wizard.recoveryFile && (
            <div key="hardware" className="animate-step-enter">
              <HardwareStep
                file={wizard.recoveryFile}
                onContinue={() => setStep('guide')}
                onBack={() => setStep('info')}
              />
            </div>
          )}
          {wizard.step === 'deriving' && (
            <div key="deriving" className="animate-step-enter">
              <DerivingStep />
            </div>
          )}
          {wizard.step === 'result' && wizard.descriptor && (
            <div key="result" className="animate-step-enter">
              <ResultStep
                descriptor={wizard.descriptor}
                onContinue={() => setStep('guide')}
              />
            </div>
          )}
          {wizard.step === 'guide' && (
            <div key="guide" className="animate-step-enter">
              <WalletGuideStep
                onReset={reset}
                onBackToDescriptor={wizard.descriptor ? () => setStep('result') : undefined}
              />
            </div>
          )}
        </WizardErrorBoundary>
      </div>
    </div>
  )
}
