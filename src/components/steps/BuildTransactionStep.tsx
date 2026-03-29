import { useState, useMemo } from 'react'
import { ArrowLeft, ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBtc, formatSats } from '@/lib/btcFormat'
import { estimateFee } from '@/crypto/psbt-builder'
import type { FeeEstimates, Utxo } from '@/crypto/blockchain-api'
import type { DerivedAddress } from '@/crypto/address'

type FeePreset = 'fast' | 'medium' | 'slow' | 'custom'

type BuildTransactionStepProps = {
  utxos: Utxo[]
  balance: number
  feeEstimates: FeeEstimates | null
  escrowAddress: DerivedAddress | null
  /** Error from psbt workflow (e.g. build failure) */
  psbtError?: string | null
  onReview: (params: {
    destinationAddress: string
    amountSats: number
    feeRate: number
    sendAll: boolean
  }) => void
  onBack: () => void
}

function isValidBitcoinAddress(addr: string): boolean {
  // Basic length + character check; full validation happens in the builder
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
    /^bc1[ac-hj-np-z02-9]{6,87}$/.test(addr) ||
    /^tb1[ac-hj-np-z02-9]{6,87}$/.test(addr) ||
    /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
    /^bcrt1[ac-hj-np-z02-9]{6,87}$/.test(addr)
}

export function BuildTransactionStep({
  utxos,
  balance,
  feeEstimates,
  escrowAddress,
  psbtError,
  onReview,
  onBack,
}: BuildTransactionStepProps) {
  const [destination, setDestination] = useState('')
  const [amountBtc, setAmountBtc] = useState('')
  const [sendAll, setSendAll] = useState(false)
  const [feePreset, setFeePreset] = useState<FeePreset>('medium')
  const [customFeeRate, setCustomFeeRate] = useState('')

  const feeRate = useMemo(() => {
    if (feePreset === 'custom') {
      const parsed = parseFloat(customFeeRate)
      return isNaN(parsed) || parsed <= 0 ? 1 : parsed
    }
    if (!feeEstimates) return 5
    switch (feePreset) {
      case 'fast': return feeEstimates.fastestFee
      case 'medium': return feeEstimates.halfHourFee
      case 'slow': return feeEstimates.hourFee
    }
  }, [feePreset, customFeeRate, feeEstimates])

  const amountSats = useMemo(() => {
    if (sendAll) return 0 // calculated after fee
    const parsed = parseFloat(amountBtc)
    if (isNaN(parsed) || parsed <= 0) return 0
    return Math.round(parsed * 100_000_000)
  }, [amountBtc, sendAll])

  const estimatedFee = useMemo(() => {
    const inputCount = utxos.length
    const outputCount = sendAll ? 1 : 2 // no change if sending all
    return estimateFee(inputCount, outputCount, feeRate)
  }, [utxos.length, sendAll, feeRate])

  const effectiveAmountSats = sendAll ? balance - estimatedFee : amountSats

  const isAddressValid = destination.trim() !== '' && isValidBitcoinAddress(destination.trim())
  const isAmountValid = sendAll
    ? effectiveAmountSats > 0
    : amountSats > 0 && amountSats + estimatedFee <= balance
  const canReview = isAddressValid && isAmountValid && destination.trim() !== escrowAddress?.address

  const addressError = (() => {
    if (!destination) return null
    if (!isValidBitcoinAddress(destination.trim())) return 'Invalid Bitcoin address format.'
    if (destination.trim() === escrowAddress?.address) return 'Destination cannot be the same as the escrow address.'
    return null
  })()

  const amountError = (() => {
    if (!amountBtc && !sendAll) return null
    if (!sendAll && amountSats === 0) return 'Amount must be greater than zero.'
    if (!sendAll && amountSats + estimatedFee > balance)
      return `Insufficient funds. Max sendable: ${formatBtc(Math.max(0, balance - estimatedFee))} BTC`
    return null
  })()

  const handleReview = () => {
    if (!canReview) return
    onReview({
      destinationAddress: destination.trim(),
      amountSats: effectiveAmountSats,
      feeRate,
      sendAll,
    })
  }

  const feePresets: Array<{ id: FeePreset; label: string; time: string; rate: string }> = [
    {
      id: 'fast',
      label: 'Fast',
      time: '~10 min',
      rate: feeEstimates ? `~${feeEstimates.fastestFee} sat/vB` : '—',
    },
    {
      id: 'medium',
      label: 'Medium',
      time: '~30 min',
      rate: feeEstimates ? `~${feeEstimates.halfHourFee} sat/vB` : '—',
    },
    {
      id: 'slow',
      label: 'Slow',
      time: '~1 hr',
      rate: feeEstimates ? `~${feeEstimates.hourFee} sat/vB` : '—',
    },
    { id: 'custom', label: 'Custom', time: '', rate: '' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Create Transaction
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure where to send your Bitcoin and how much to pay in fees.
        </p>
      </div>

      {/* Balance context */}
      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Available balance</span>
          <span className="text-sm font-semibold text-foreground">
            {formatBtc(balance)} BTC
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({formatSats(balance)} sats)
            </span>
          </span>
        </div>
      </div>

      {/* Destination address */}
      <div className="space-y-1.5">
        <label htmlFor="destination" className="text-xs font-medium text-foreground">
          Destination Address
        </label>
        <input
          id="destination"
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="bc1q..."
          className={cn(
            'input-premium w-full rounded-[var(--radius-base)] border bg-[var(--input-bg)] px-3 py-2.5 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30',
            addressError ? 'border-destructive/60 focus:border-destructive' : 'border-border focus:border-ring',
          )}
          autoComplete="off"
          spellCheck={false}
        />
        {addressError && (
          <p className="text-xs text-destructive" role="alert">{addressError}</p>
        )}
      </div>

      {/* Amount */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="amount-btc" className="text-xs font-medium text-foreground">
            Amount (BTC)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <span>Send all</span>
            <button
              type="button"
              role="switch"
              aria-checked={sendAll}
              onClick={() => setSendAll((v) => !v)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                sendAll ? 'bg-primary' : 'bg-border',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  sendAll ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
          </label>
        </div>

        {!sendAll && (
          <>
            <input
              id="amount-btc"
              type="number"
              min="0"
              step="0.00000001"
              value={amountBtc}
              onChange={(e) => setAmountBtc(e.target.value)}
              placeholder="0.00000000"
              className={cn(
                'input-premium w-full rounded-[var(--radius-base)] border bg-[var(--input-bg)] px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30',
                amountError ? 'border-destructive/60 focus:border-destructive' : 'border-border focus:border-ring',
              )}
            />
            {amountSats > 0 && (
              <p className="text-xs text-muted-foreground">{formatSats(amountSats)} sats</p>
            )}
            {amountError && (
              <p className="text-xs text-destructive" role="alert">{amountError}</p>
            )}
          </>
        )}

        {sendAll && (
          <div className="rounded-[var(--radius-base)] border border-border bg-accent/30 px-3 py-2.5">
            <p className="text-sm text-foreground">
              {effectiveAmountSats > 0
                ? `${formatBtc(effectiveAmountSats)} BTC (${formatSats(effectiveAmountSats)} sats) after fees`
                : 'Calculating...'}
            </p>
          </div>
        )}
      </div>

      {/* Fee rate */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Fee Rate</p>
        <div className="grid grid-cols-4 gap-2">
          {feePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={feePreset === preset.id}
              onClick={() => setFeePreset(preset.id)}
              className={cn(
                'rounded-[var(--radius-base)] border px-3 py-2.5 text-center text-xs transition-colors',
                feePreset === preset.id
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              <span className="block font-medium">{preset.label}</span>
              {preset.time && (
                <span className="mt-0.5 block text-[10px] text-muted-foreground">{preset.time}</span>
              )}
              {preset.rate && <span className="mt-0.5 block text-[10px]">{preset.rate}</span>}
            </button>
          ))}
        </div>

        {feePreset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              step="1"
              value={customFeeRate}
              onChange={(e) => setCustomFeeRate(e.target.value)}
              placeholder="e.g. 10"
              className="input-premium w-32 rounded-[var(--radius-base)] border border-border bg-[var(--input-bg)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <span className="text-xs text-muted-foreground">sat/vB</span>
          </div>
        )}
      </div>

      {/* Fee estimate */}
      <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-accent/50 px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Estimated fee: </span>
          {formatSats(estimatedFee)} sats ({formatBtc(estimatedFee)} BTC) at {feeRate} sat/vB
        </div>
      </div>

      {/* PSBT build error */}
      {psbtError && (
        <div className="rounded-[var(--radius-base)] border border-destructive/20 bg-destructive/10 px-4 py-3">
          <p className="text-sm text-destructive">{psbtError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          className="btn-outline inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>

        <button
          type="button"
          onClick={handleReview}
          disabled={!canReview}
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:bg-[var(--button-primary-disabled-bg)] disabled:text-[var(--button-primary-disabled-fg)] disabled:opacity-100 disabled:shadow-none"
        >
          Review Transaction
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
