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
import { ActionChoiceStep } from '@/components/steps/ActionChoiceStep'
import { WalletViewStep } from '@/components/steps/WalletViewStep'
import { BuildTransactionStep } from '@/components/steps/BuildTransactionStep'
import { ReviewSignStep } from '@/components/steps/ReviewSignStep'
import { ExportPsbtStep } from '@/components/steps/ExportPsbtStep'
import { ImportPsbtStep } from '@/components/steps/ImportPsbtStep'
import { ReviewPsbtStep } from '@/components/steps/ReviewPsbtStep'
import { SignFinalizeStep } from '@/components/steps/SignFinalizeStep'
import { BroadcastStep } from '@/components/steps/BroadcastStep'
import { useRecoveryWizard } from '@/hooks/useRecoveryWizard'
import { useDerivation } from '@/hooks/useDerivation'
import { useWalletState } from '@/hooks/useWalletState'
import { usePsbtWorkflow } from '@/hooks/usePsbtWorkflow'
import { useNetworkConfig } from '@/hooks/useNetworkConfig'
import { parseDescriptor } from '@/crypto/descriptor-parser'
import { deriveMultisigAddress } from '@/crypto/address'
import type { RecoveryFile } from '@/crypto'
import type { TxOutput } from '@/crypto/psbt-builder'

// ── Step label sets ──────────────────────────────────────────────────────────

const STEP_LABELS_SHARED = ['Upload', 'Verify', 'Authenticate', 'Derive', 'Result', 'Choose']

const STEP_LABELS_PATH_A = [
  ...STEP_LABELS_SHARED,
  'Wallet', 'Build', 'Review', 'Export',
]

const STEP_LABELS_PATH_B = [
  ...STEP_LABELS_SHARED,
  'Import', 'Review', 'Sign', 'Broadcast',
]

const STEP_LABELS_GUIDE = [...STEP_LABELS_SHARED, 'Import']

// ── Error boundary ────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export function RecoveryWizard() {
  const wizard = useRecoveryWizard()
  const { derive, derivationError } = useDerivation()

  // Network config — derived from the recovery file's network once loaded
  const network = wizard.recoveryFile?.network ?? 'mainnet'
  const networkConfig = useNetworkConfig(network)

  // Wallet data (Path A)
  const walletState = useWalletState()

  // PSBT workflow (shared by both paths)
  const psbtWorkflow = usePsbtWorkflow()

  // Destructure stable setters
  const {
    setRecoveryFile, setStep, setPasswordError,
    setDescriptor, setXprv, setParsedDescriptor, reset,
  } = wizard

  // Destructure stable psbtWorkflow functions to avoid whole-object dep
  const {
    build: psbtBuild,
    sign: psbtSign,
    importPsbt: psbtImport,
    finalizeAndBroadcast: psbtFinalizeAndBroadcast,

    reset: psbtReset,
  } = psbtWorkflow

  // Destructure stable walletState functions
  const { loadWallet, reset: walletReset } = walletState

  // ── Handlers: shared wizard steps ──────────────────────────────────────────

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

        // Also extract the xprv from the descriptor for signing later
        try {
          const parsed = parseDescriptor(descriptor)
          setParsedDescriptor(parsed)
          const privKey = parsed.keys.find((k) => k.isPrivate)
          if (privKey) {
            setXprv(privKey.extendedKey)
          }
        } catch {
          // Non-fatal — user can still export the descriptor
        }

        setStep('result')
      } else {
        setStep('password')
        setPasswordError(
          derivationError ??
            'The password you entered does not match this recovery file. Please check your password and try again.',
        )
      }
    },
    [wizard.recoveryFile, derive, derivationError, setPasswordError, setStep, setDescriptor, setParsedDescriptor, setXprv],
  )

  // ── Handlers: action-choice step ──────────────────────────────────────────

  const handleActionChoice_CreateTx = useCallback(() => {
    setStep('wallet-view')
  }, [setStep])

  const handleActionChoice_SignExisting = useCallback(() => {
    setStep('import-psbt')
  }, [setStep])

  const handleActionChoice_ImportWallet = useCallback(() => {
    setStep('guide')
  }, [setStep])

  // ── Handlers: Path A — wallet-view → build-tx → review-sign → export-psbt ─

  const handleBuildTxReview = useCallback(
    (params: {
      destinationAddress: string
      amountSats: number
      feeRate: number
      sendAll: boolean
    }) => {
      if (!wizard.parsedDescriptor || !wizard.recoveryFile) return

      try {
        const { parsedDescriptor, recoveryFile } = wizard
        const escrowAddr = deriveMultisigAddress(parsedDescriptor, 0, recoveryFile.network)

        const outputs: TxOutput[] = [
          { address: params.destinationAddress, value: params.amountSats },
        ]

        const utxoPairs = walletState.utxos.map((u) => ({
          utxo: u,
          addressInfo: escrowAddr,
        }))

        // For send-all: no change address, single output
        const changeAddress = params.sendAll ? null : escrowAddr

        const built = psbtBuild({
          utxos: utxoPairs,
          outputs,
          changeAddress,
          feeRate: params.feeRate,
          network: recoveryFile.network,
          parsedDescriptor,
        })

        if (built) setStep('review-sign')
      } catch {
        // Error is surfaced in psbtWorkflow.error
      }
    },
    [wizard.parsedDescriptor, wizard.recoveryFile, walletState.utxos, psbtBuild, setStep],
  )

  const handleSign_PathA = useCallback(() => {
    if (!psbtWorkflow.psbt || !wizard.xprv || !wizard.recoveryFile || !wizard.parsedDescriptor) return

    const escrowAddr = (() => {
      try {
        return deriveMultisigAddress(wizard.parsedDescriptor, 0, wizard.recoveryFile.network).address
      } catch {
        return undefined
      }
    })()

    const inputsSigned = psbtSign(
      psbtWorkflow.psbt,
      wizard.xprv,
      wizard.recoveryFile.userKey.fingerprint,
      wizard.recoveryFile.network,
      escrowAddr,
    )

    // Only advance if signing succeeded (non-null return means at least attempted)
    if (inputsSigned !== null) {
      setStep('export-psbt')
    }
  }, [psbtSign, psbtWorkflow.psbt, wizard.xprv, wizard.recoveryFile, wizard.parsedDescriptor, setStep])

  const handleDownloadPsbt = useCallback(() => {
    const base64 = psbtWorkflow.getBase64()
    if (!base64) return
    const blob = new Blob([base64], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'btcbacked-recovery.psbt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }, [psbtWorkflow])

  // ── Handlers: Path B — import-psbt → review-psbt → sign-finalize → broadcast

  const handleImportPsbt = useCallback(
    (data: string | ArrayBuffer) => {
      if (!wizard.recoveryFile) return

      const escrowAddr = (() => {
        if (!wizard.parsedDescriptor) return undefined
        try {
          return deriveMultisigAddress(wizard.parsedDescriptor, 0, wizard.recoveryFile.network).address
        } catch {
          return undefined
        }
      })()

      const imported = psbtImport(data, wizard.recoveryFile.network, escrowAddr)
      if (imported) {
        setStep('review-psbt')
      }
    },
    [wizard.recoveryFile, wizard.parsedDescriptor, psbtImport, setStep],
  )

  const handleSign_PathB = useCallback(() => {
    if (!psbtWorkflow.psbt || !wizard.xprv || !wizard.recoveryFile || !wizard.parsedDescriptor) return

    const escrowAddr = (() => {
      try {
        return deriveMultisigAddress(wizard.parsedDescriptor, 0, wizard.recoveryFile.network).address
      } catch {
        return undefined
      }
    })()

    const inputsSigned = psbtSign(
      psbtWorkflow.psbt,
      wizard.xprv,
      wizard.recoveryFile.userKey.fingerprint,
      wizard.recoveryFile.network,
      escrowAddr,
    )

    // Only advance if signing succeeded (non-null return means at least attempted)
    if (inputsSigned !== null) {
      setStep('sign-finalize')
    }
  }, [psbtSign, psbtWorkflow.psbt, wizard.xprv, wizard.recoveryFile, wizard.parsedDescriptor, setStep])

  const handleBroadcastFromStep = useCallback(async () => {
    if (!psbtWorkflow.psbt) return
    await psbtFinalizeAndBroadcast(psbtWorkflow.psbt, networkConfig.apiBaseUrl)
  }, [psbtFinalizeAndBroadcast, psbtWorkflow.psbt, networkConfig.apiBaseUrl])

  // ── Step indicator labels ─────────────────────────────────────────────────

  const stepLabels = (() => {
    if (wizard.activePath === 'a') return STEP_LABELS_PATH_A
    if (wizard.activePath === 'b') return STEP_LABELS_PATH_B
    if (wizard.step === 'guide') return STEP_LABELS_GUIDE
    return STEP_LABELS_SHARED
  })()

  const totalSteps = stepLabels.length

  // ── Derived state ─────────────────────────────────────────────────────────

  const escrowAddress = (() => {
    if (!wizard.parsedDescriptor || !wizard.recoveryFile) return ''
    try {
      return deriveMultisigAddress(wizard.parsedDescriptor, 0, wizard.recoveryFile.network).address
    } catch {
      return ''
    }
  })()

  const escrowAddressObj = (() => {
    if (!wizard.parsedDescriptor || !wizard.recoveryFile) return null
    try {
      return deriveMultisigAddress(wizard.parsedDescriptor, 0, wizard.recoveryFile.network)
    } catch {
      return null
    }
  })()

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <SecurityBadge />
      </div>

      <StepIndicator
        currentStep={wizard.stepNumber}
        totalSteps={totalSteps}
        labels={stepLabels}
      />

      {/* Main card */}
      <div
        className="glass-card rounded-[var(--radius-surface)] border p-6 md:p-8"
        style={{ boxShadow: 'var(--auth-card-glow)' }}
      >
        <WizardErrorBoundary>
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
                onContinue={() => setStep('action-choice')}
              />
            </div>
          )}

          {wizard.step === 'guide' && (
            <div key="guide" className="animate-step-enter">
              <WalletGuideStep
                onReset={() => { psbtReset(); walletReset(); reset() }}
                onBackToDescriptor={wizard.descriptor ? () => setStep('result') : undefined}
              />
            </div>
          )}

          {/* ── action-choice ── */}
          {wizard.step === 'action-choice' && (
            <div key="action-choice" className="animate-step-enter">
              <ActionChoiceStep
                escrowAddress={escrowAddress}
                network={network}
                customEndpoint={networkConfig.customEndpoint}
                needsCustomEndpoint={networkConfig.needsCustomEndpoint}
                onCustomEndpointChange={networkConfig.setCustomEndpoint}
                onCreateTransaction={handleActionChoice_CreateTx}
                onSignExisting={handleActionChoice_SignExisting}
                onImportWallet={handleActionChoice_ImportWallet}
                onBack={() => setStep('result')}
              />
            </div>
          )}

          {/* ── Path A ── */}

          {wizard.step === 'wallet-view' && wizard.parsedDescriptor && wizard.recoveryFile && (
            <div key="wallet-view" className="animate-step-enter">
              <WalletViewStep
                parsedDescriptor={wizard.parsedDescriptor}
                network={wizard.recoveryFile.network}
                apiBaseUrl={networkConfig.apiBaseUrl}
                addresses={walletState.addresses}
                utxos={walletState.utxos}
                balance={walletState.balance}
                isLoading={walletState.isLoading}
                error={walletState.error}
                onLoadWallet={loadWallet}
                onCreateTransaction={() => setStep('build-tx')}
                onBack={() => setStep('action-choice')}
              />
            </div>
          )}

          {wizard.step === 'build-tx' && wizard.recoveryFile && (
            <div key="build-tx" className="animate-step-enter">
              <BuildTransactionStep
                utxos={walletState.utxos}
                balance={walletState.balance}
                feeEstimates={walletState.feeEstimates}
                escrowAddress={escrowAddressObj}
                psbtError={psbtWorkflow.error}
                onReview={handleBuildTxReview}
                onBack={() => setStep('wallet-view')}
              />
            </div>
          )}

          {wizard.step === 'review-sign' && psbtWorkflow.analysis && (
            <div key="review-sign" className="animate-step-enter">
              <ReviewSignStep
                analysis={psbtWorkflow.analysis}
                error={psbtWorkflow.error}
                onSign={handleSign_PathA}
                onBack={() => setStep('build-tx')}
              />
            </div>
          )}

          {wizard.step === 'export-psbt' && psbtWorkflow.analysis && (
            <div key="export-psbt" className="animate-step-enter">
              <ExportPsbtStep
                analysis={psbtWorkflow.analysis}
                psbtBase64={psbtWorkflow.getBase64() ?? ''}
                psbtError={psbtWorkflow.error}
                onDownload={handleDownloadPsbt}
                onBack={() => setStep('review-sign')}
                onStartOver={() => { psbtReset(); walletReset(); reset() }}
              />
            </div>
          )}

          {/* ── Path B ── */}

          {wizard.step === 'import-psbt' && (
            <div key="import-psbt" className="animate-step-enter">
              <ImportPsbtStep
                error={psbtWorkflow.error}
                onImport={handleImportPsbt}
                onBack={() => setStep('action-choice')}
              />
            </div>
          )}

          {wizard.step === 'review-psbt' && psbtWorkflow.analysis && (
            <div key="review-psbt" className="animate-step-enter">
              <ReviewPsbtStep
                analysis={psbtWorkflow.analysis}
                onSign={handleSign_PathB}
                onBack={() => setStep('import-psbt')}
              />
            </div>
          )}

          {wizard.step === 'sign-finalize' && (
            <div key="sign-finalize" className="animate-step-enter">
              <SignFinalizeStep
                analysis={psbtWorkflow.analysis}
                psbtBase64={psbtWorkflow.getBase64()}
                isProcessing={psbtWorkflow.isProcessing}
                error={psbtWorkflow.error}
                onBroadcast={() => {
                  setStep('broadcast')
                }}
                onDownloadPsbt={handleDownloadPsbt}
                onBack={() => setStep('review-psbt')}
                onRetrySign={handleSign_PathB}
              />
            </div>
          )}

          {wizard.step === 'broadcast' && wizard.recoveryFile && (
            <div key="broadcast" className="animate-step-enter">
              <BroadcastStep
                txid={psbtWorkflow.txid}
                isProcessing={psbtWorkflow.isProcessing}
                error={psbtWorkflow.error}
                network={wizard.recoveryFile.network}
                onBroadcast={handleBroadcastFromStep}
                onStartOver={() => { psbtReset(); walletReset(); reset() }}
              />
            </div>
          )}
        </WizardErrorBoundary>
      </div>
    </div>
  )
}
