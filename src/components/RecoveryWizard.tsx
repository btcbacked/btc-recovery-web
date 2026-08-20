import { useCallback, useMemo, Component } from 'react'
import type { ReactNode } from 'react'
import { DerivationNotice, UnsupportedEscrowNotice } from '@/components/DerivationNotice'
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
import type { WizardStep } from '@/hooks/useRecoveryWizard'
import { useDerivation } from '@/hooks/useDerivation'
import { useWalletState } from '@/hooks/useWalletState'
import { usePsbtWorkflow } from '@/hooks/usePsbtWorkflow'
import { useNetworkConfig } from '@/hooks/useNetworkConfig'
import { AlertTriangle } from 'lucide-react'
import { parseDescriptor, usesStandardChildDerivation } from '@/crypto/descriptor-parser'
import { originPathWarning } from '@/crypto/origin-path'
import { deriveMultisigAddress } from '@/crypto/address'
import { withChecksum } from '@/crypto/descriptor'
import { isPasswordKeySource } from '@/crypto/recovery-file'
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

/**
 * The only steps that must NOT carry the derivation notice at wizard level,
 * because they render an `EscrowSummary` which carries its own copy of it.
 *
 * A denylist, not an allowlist. The defect being fixed was a screen nobody
 * remembered to add, so a step added later has to default to warned; an
 * allowlist defaults it to silent and reproduces the bug.
 */
const SUMMARY_STEPS: WizardStep[] = ['hardware', 'guide']

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
          <p className="text-sm font-medium text-destructive-text">Something went wrong</p>
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
  const { derive } = useDerivation()

  // Network config — derived from the recovery file's network once loaded
  const network = wizard.recoveryFile?.network ?? 'mainnet'
  const networkConfig = useNetworkConfig(network)

  // Wallet data (Path A)
  const walletState = useWalletState()

  // PSBT workflow (shared by both paths)
  const psbtWorkflow = usePsbtWorkflow()

  // Destructure stable setters
  const {
    setRecoveryFile, setStep, setPasswordError, setOriginPathWarning,
    setDescriptor, setXprv, setParsedDescriptor, setDescriptorUnreadable, reset,
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

  /**
   * The escrow address, derived once.
   *
   * Index 0 is not an assumption about where the money is: `deriveMultisigAddress`
   * resolves each key's own child derivation, so a descriptor pinned to a fixed
   * child ignores this index and a ranged one takes it, and an escrow has a
   * single address either way. Memoised because four callbacks below close over
   * it, and a fresh object each render would defeat their memoisation.
   *
   * Null when this tool will not reproduce the address: a child derivation
   * `childIndices` refuses, or an extended key that will not read. That is
   * deliberate: no address at all is safer than a plausible wrong one.
   */
  const escrowAddressObj = useMemo(() => {
    if (!wizard.parsedDescriptor || !wizard.recoveryFile) return null
    try {
      return deriveMultisigAddress(wizard.parsedDescriptor, 0, wizard.recoveryFile.network)
    } catch {
      return null
    }
  }, [wizard.parsedDescriptor, wizard.recoveryFile])

  const escrowAddress = escrowAddressObj?.address ?? ''

  /**
   * True once this tool has looked at the file and cannot produce its escrow
   * address. Held apart from "no descriptor yet", which is every screen before
   * the file is opened and is not a refusal at all.
   *
   * Two ways to get here, and both have to count. The descriptor parsed and
   * `deriveMultisigAddress` then refused it, or the descriptor did not parse at
   * all. The second was silent: `parsedDescriptor` stays null, which is
   * indistinguishable from "not read yet" without the flag, so the customer got
   * no address, no balance and no warning, and a sign button that did nothing.
   */
  const cannotDeriveEscrow =
    wizard.descriptorUnreadable ||
    (wizard.parsedDescriptor !== null && escrowAddressObj === null)

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

    // The one thing neither key check can see. Both of them compare key
    // material, so a file whose descriptor bracket names a different path from
    // `userKey.derivationPath` passes every check the tool makes. It is settled
    // here because it is a property of the file alone, so it is known before a
    // password is worth typing, and it runs for a device held key too: a device
    // is what reads the path, which makes that the population it helps most.
    setOriginPathWarning(originPathWarning(wizard.recoveryFile))

    if (isPasswordKeySource(wizard.recoveryFile.userKey.keySource)) {
      setStep('password')
      return
    }
    // A device-held key has nothing to derive, so the password path never runs
    // and never fills this in. The file's own descriptor already carries every
    // public key, which is all the escrow address and balance need.
    try {
      setParsedDescriptor(parseDescriptor(wizard.recoveryFile.outputDescriptor))
      setDescriptorUnreadable(false)
    } catch {
      // The descriptor is still shown and can be imported by hand, so this is
      // not fatal. It is not silent either: no address can come from a
      // descriptor that will not parse, which means no balance to check and no
      // signing, and the customer has to be told that before they act on it.
      setParsedDescriptor(null)
      setDescriptorUnreadable(true)
    }
    setStep('hardware')
  }, [wizard.recoveryFile, setStep, setParsedDescriptor, setDescriptorUnreadable, setOriginPathWarning])

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      if (!wizard.recoveryFile) return
      setPasswordError(null)
      setStep('deriving')

      // The error comes back from the call, not from hook state: this callback
      // was captured on an earlier render, so state read here is the value from
      // before the attempt.
      const { descriptor, error } = await derive(password, wizard.recoveryFile)
      if (descriptor) {
        setDescriptor(descriptor)

        // Also extract the xprv from the descriptor for signing later
        try {
          const parsed = parseDescriptor(descriptor)
          setParsedDescriptor(parsed)
          setDescriptorUnreadable(false)
          const privKey = parsed.keys.find((k) => k.isPrivate)
          if (privKey) {
            setXprv(privKey.extendedKey)
          }
        } catch {
          // The descriptor can still be exported, but nothing else works: no
          // address, no balance, no signing. Same reasoning as the device path.
          setParsedDescriptor(null)
          setDescriptorUnreadable(true)
        }

        setStep('result')
      } else {
        setStep('password')
        setPasswordError(error)
      }
    },
    [wizard.recoveryFile, derive, setPasswordError, setStep, setDescriptor, setParsedDescriptor, setDescriptorUnreadable, setXprv],
  )

  /**
   * Fetch the escrow balance for whichever descriptor we currently hold.
   * Used by every screen that shows the user an address to check against.
   */
  const handleLoadWallet = useCallback(() => {
    if (!wizard.parsedDescriptor || !wizard.recoveryFile) return
    loadWallet(wizard.parsedDescriptor, wizard.recoveryFile.network, networkConfig.apiBaseUrl)
  }, [wizard.parsedDescriptor, wizard.recoveryFile, loadWallet, networkConfig.apiBaseUrl])

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
      if (!wizard.parsedDescriptor || !wizard.recoveryFile || !escrowAddressObj) return

      try {
        const { parsedDescriptor, recoveryFile } = wizard
        const escrowAddr = escrowAddressObj

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
    [wizard.parsedDescriptor, wizard.recoveryFile, walletState.utxos, psbtBuild, setStep, escrowAddressObj],
  )

  /**
   * Path A signing.
   *
   * `escrowAddressObj` is required, not optional. It is null exactly when
   * `childIndices` refused this descriptor, and that refusal exists to stop a
   * signature against the wrong key: `psbt-signer.ts` locates the key by the
   * last two components of the PSBT path, so a descriptor whose child suffix is
   * a different length signs with a key that is not the one in the witness
   * script. Refusing to derive an address and then signing anyway would make
   * the refusal decorative. `UnsupportedEscrowNotice` is on screen throughout,
   * so the button doing nothing is not the only thing the customer sees.
   */
  const handleSign_PathA = useCallback(() => {
    if (!psbtWorkflow.psbt || !wizard.xprv || !wizard.recoveryFile || !escrowAddressObj) return

    const inputsSigned = psbtSign(
      psbtWorkflow.psbt,
      wizard.xprv,
      wizard.recoveryFile.userKey.fingerprint,
      wizard.recoveryFile.network,
      escrowAddressObj.address,
    )

    // Only advance if signing succeeded (non-null return means at least attempted)
    if (inputsSigned !== null) {
      setStep('export-psbt')
    }
  }, [psbtSign, psbtWorkflow.psbt, wizard.xprv, wizard.recoveryFile, setStep, escrowAddressObj])

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

      // `escrowAddress` is a display hint, not a check. Its only consumer is
      // `psbt-finalizer.ts`, which uses it to label an output paying back to
      // the escrow as change in the summary shown next. Nothing here or below
      // asks whether the imported PSBT belongs to this escrow, so do not read
      // this argument as though something does.
      const imported = psbtImport(
        data,
        wizard.recoveryFile.network,
        escrowAddress || undefined,
      )
      if (imported) {
        setStep('review-psbt')
      }
    },
    [wizard.recoveryFile, psbtImport, setStep, escrowAddress],
  )

  /** Path B signing. Same refusal as Path A, and for the same reason. */
  const handleSign_PathB = useCallback(() => {
    if (!psbtWorkflow.psbt || !wizard.xprv || !wizard.recoveryFile || !escrowAddressObj) return

    const inputsSigned = psbtSign(
      psbtWorkflow.psbt,
      wizard.xprv,
      wizard.recoveryFile.userKey.fingerprint,
      wizard.recoveryFile.network,
      escrowAddressObj.address,
    )

    // Only advance if signing succeeded (non-null return means at least attempted)
    if (inputsSigned !== null) {
      setStep('sign-finalize')
    }
  }, [psbtSign, psbtWorkflow.psbt, wizard.xprv, wizard.recoveryFile, setStep, escrowAddressObj])

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

  // The descriptor the user copies into another wallet. The password path has
  // already rebuilt and checksummed one; the hardware path uses the file's own,
  // checksummed here so wallets that demand a checksum accept it.
  const activeDescriptor = (() => {
    if (wizard.descriptor) return wizard.descriptor
    if (!wizard.recoveryFile) return ''
    try {
      return withChecksum(wizard.recoveryFile.outputDescriptor)
    } catch {
      return wizard.recoveryFile.outputDescriptor
    }
  })()

  // False when the escrow is not on the plain ranged branch. The address this
  // tool derives is right either way; what the screens have to say is that
  // other wallet software may show something different.
  const isStandardDerivation = wizard.parsedDescriptor
    ? usesStandardChildDerivation(wizard.parsedDescriptor)
    : true

  /**
   * The summary only renders when there is an address, so on a refusal these
   * two steps carry nothing: the customer is handed the file to import with no
   * address, no balance and no caveat at all. Gate on the address rather than
   * on the step, or the one case that needs saying most is the one case that
   * says nothing.
   */
  const summaryCarriesNotice = SUMMARY_STEPS.includes(wizard.step) && escrowAddress !== ''

  // Never both: on a refusal there is no address for the notice to vouch for,
  // and `UnsupportedEscrowNotice` is what applies instead.
  const showDerivationNotice =
    !cannotDeriveEscrow && !isStandardDerivation && !summaryCarriesNotice

  const descriptorHasPrivateKey =
    wizard.parsedDescriptor?.keys.some((k) => k.isPrivate) ?? false

  // Shown on the three screens where the path is about to matter: before the
  // password is typed, on the device screen, and on the screen that hands over
  // the descriptor. It is deliberately not shown on the transaction screens,
  // where it changes nothing and would only crowd out what does.
  const showOriginPathWarning =
    wizard.originPathWarning !== null &&
    (wizard.step === 'password' ||
      wizard.step === 'hardware' ||
      wizard.step === 'result')

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
        {cannotDeriveEscrow && (
          <div className="mb-6">
            <UnsupportedEscrowNotice />
          </div>
        )}

        {showDerivationNotice && (
          <div className="mb-6">
            <DerivationNotice />
          </div>
        )}

        {showOriginPathWarning && (
          <div
            role="status"
            className="mb-6 flex items-start gap-2 rounded-[var(--radius-base)] bg-warning/10 px-4 py-3"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-sm text-warning-text">{wizard.originPathWarning}</p>
          </div>
        )}

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
                descriptor={activeDescriptor}
                escrowAddress={escrowAddress}
                balance={walletState.balance}
                depositCount={walletState.utxos.length}
                isLoadingBalance={walletState.isLoading}
                balanceError={walletState.error}
                isStandardDerivation={isStandardDerivation}
                onLoadBalance={handleLoadWallet}
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
                descriptor={activeDescriptor}
                descriptorHasPrivateKey={descriptorHasPrivateKey}
                escrowAddress={escrowAddress}
                balance={walletState.balance}
                depositCount={walletState.utxos.length}
                isLoadingBalance={walletState.isLoading}
                balanceError={walletState.error}
                isStandardDerivation={isStandardDerivation}
                cannotDeriveEscrow={cannotDeriveEscrow}
                onLoadBalance={handleLoadWallet}
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

          {/* Gated on the file alone, never on `parsedDescriptor`. A descriptor
              this page cannot parse leaves that null, and requiring it here
              rendered nothing at all: the customer arrived from Create
              Transaction to a card holding the refusal notice and no button of
              any kind, forward or back, and was stranded. Both refusal causes
              now land on the same screen, which is Back and nothing else. */}
          {wizard.step === 'wallet-view' && wizard.recoveryFile && (
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
                cannotDeriveEscrow={cannotDeriveEscrow}
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
