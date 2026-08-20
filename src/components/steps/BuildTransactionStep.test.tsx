/**
 * Path A's own refusal, the one the wizard is not supposed to be able to reach.
 *
 * `escrowAddressObj` being null stops Path A twice over: `wallet-view` cannot
 * load a balance without an address, and its Create Transaction button is
 * disabled at a zero balance, so `build-tx` is unreachable through the UI.
 * That is exactly why this needs a test of its own. The refusal here is the
 * layer that catches a future change to either of those, and a guard nothing
 * exercises is a guard nobody notices deleting.
 *
 * Tested at component level rather than through the wizard for the same
 * reason: driving the wizard to this screen is not currently possible, so a
 * wizard test would have to fake the state it is meant to be checking.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BuildTransactionStep } from './BuildTransactionStep'
import type { DerivedAddress } from '@/crypto/address'

// bitcoinjs-lib expects a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const UTXOS = [
  { txid: 'a'.repeat(64), vout: 0, value: 150_000, status: { confirmed: true } },
]

// Only `.address` is read by this screen, so the rest is filler.
const ESCROW: DerivedAddress = {
  index: 0,
  address: 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
  witnessScript: Buffer.alloc(0),
  publicKeys: [],
}

const DESTINATION = 'tb1q6rhpng9evdsfnn833a4f4vej0asu6dk5srld6x'

function renderStep(escrowAddress: DerivedAddress | null) {
  const onReview = vi.fn()
  render(
    <BuildTransactionStep
      utxos={UTXOS}
      balance={150_000}
      feeEstimates={null}
      escrowAddress={escrowAddress}
      onReview={onReview}
      onBack={() => {}}
    />,
  )
  return onReview
}

function fillIn(destination: string, amountBtc: string) {
  fireEvent.change(screen.getByLabelText(/Destination Address/i), {
    target: { value: destination },
  })
  fireEvent.change(screen.getByLabelText(/Amount \(BTC\)/i), {
    target: { value: amountBtc },
  })
}

const REFUSAL = /cannot work out your escrow address, so it will not build a payment/i

afterEach(cleanup)

describe('building a payment when the escrow address could not be worked out', () => {
  it('says why, in place of the address error', () => {
    renderStep(null)
    fillIn(DESTINATION, '0.0005')

    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })

  it('will not build the payment', () => {
    const onReview = renderStep(null)
    fillIn(DESTINATION, '0.0005')

    const review = screen.getByRole('button', { name: /Review Transaction/i })
    expect(review.hasAttribute('disabled')).toBe(true)

    fireEvent.click(review)
    expect(onReview).not.toHaveBeenCalled()
  })

  it('says nothing at all before a destination is typed', () => {
    renderStep(null)

    // The refusal belongs to the destination field, so it appears when the
    // field is in play. Shouting at an untouched form helps nobody.
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('still builds the payment when the escrow address is known', () => {
    const onReview = renderStep(ESCROW)
    fillIn(DESTINATION, '0.0005')

    expect(screen.queryByText(REFUSAL)).toBeNull()

    const review = screen.getByRole('button', { name: /Review Transaction/i })
    expect(review.hasAttribute('disabled')).toBe(false)

    fireEvent.click(review)
    expect(onReview).toHaveBeenCalledTimes(1)
    expect(onReview.mock.calls[0]?.[0]).toMatchObject({
      destinationAddress: DESTINATION,
      amountSats: 50_000,
    })
  })

  it('still refuses to pay the escrow itself', () => {
    const onReview = renderStep(ESCROW)
    fillIn(ESCROW.address, '0.0005')

    expect(screen.getByText(/Destination cannot be the same as the escrow address/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Review Transaction/i }))
    expect(onReview).not.toHaveBeenCalled()
  })
})
