/**
 * The naming claim, with the detector deliberately made to FIRE.
 *
 * The sibling file blinds the detector to prove the warning still shows. This
 * one does the opposite and proves the screen still tells the truth.
 *
 * The scan errs toward showing on purpose, so it will refuse to prove a string
 * safe whenever anything in it is unfamiliar. That is free for a warning, which
 * only has to be safe when wrong. It is not free for a claim. Telling a
 * hardware wallet owner they are holding a file containing their private key is
 * simply false, and it contradicts the promise their whole setup rests on,
 * which is that the key never leaves the device. Once is too often for that,
 * because the customer it lands on is the one least equipped to know we are
 * wrong.
 *
 * So the claim reads `keySource` off the recovery file and the warning reads
 * the string, and here they are forced to disagree. The correct outcome is that
 * BOTH behave properly: a warning nobody needed, and a name that is still
 * right.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { bitcoin, ecc } from '@/crypto/bitcoin-lib'

vi.mock('@/crypto/private-key-scan', () => ({
  provablyPublicOnly: () => false,
}))

import { WalletGuideStep } from './WalletGuideStep'
import { provablyPublicOnly } from '@/crypto'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const bip32 = BIP32Factory(ecc)
const node = bip32.fromSeed(Buffer.alloc(32, 0x21), bitcoin.networks.testnet)
const TPUB = node.neutered().toBase58()

/** A device path descriptor: public keys only, and no private key anywhere. */
const DEVICE_PATH_FILE =
  `wsh(multi(2,[aaaaaaaa/48'/1'/0'/2']${TPUB}/0/1,` +
  `[bbbbbbbb/48'/1'/0'/2']${TPUB}/0/1))`

const WARNING = /Keep this secret/i

const guideProps = {
  descriptor: DEVICE_PATH_FILE,
  escrowAddress: '',
  balance: 0,
  depositCount: 0,
  isLoadingBalance: false,
  balanceError: null,
  isStandardDerivation: true,
  cannotDeriveEscrow: true,
  onLoadBalance: () => {},
  onReset: () => {},
}

afterEach(cleanup)

describe('when the detector fires on a device path customer', () => {
  /** The premise, asserted rather than assumed: the detector really is lying. */
  it('the scan really has been made to fire on a file with no key in it', () => {
    expect(DEVICE_PATH_FILE).not.toContain('prv')
    expect(provablyPublicOnly(DEVICE_PATH_FILE)).toBe(false)
  })

  it('is never told they are holding a signing file, on any device', () => {
    for (const keySource of ['COLD_CARD', 'LEDGER', 'TREZOR', 'BITBOX02', 'OTHER']) {
      render(<WalletGuideStep {...guideProps} keySource={keySource} />)
      const page = document.body.textContent ?? ''

      expect(page).toMatch(/Escrow File/)
      expect(page).not.toMatch(/Signing File/)
      expect(page).not.toMatch(/signing file/)
      cleanup()
    }
  })

  it('is never given the password path advice about moving funds', () => {
    // The negative used to name 'already holds your signing key'. That sentence
    // no longer exists on either path, which would leave this assertion true
    // for a component that renders nothing at all, so it now names the sentence
    // the password branch actually carries today.
    //
    // 'watch-only wallet' and not 'Create Transaction': `guideProps` sets
    // `cannotDeriveEscrow`, and the password branch drops Create Transaction on
    // a refusal, so that phrase is absent here whatever the key source and
    // would discriminate nothing.
    render(<WalletGuideStep {...guideProps} keySource="COLD_CARD" />)

    const sparrow = document.getElementById('wallet-panel-sparrow')?.textContent ?? ''
    expect(sparrow).toMatch(/Connect your hardware wallet/i)
    expect(sparrow).not.toMatch(/watch-only wallet/i)
  })

  /**
   * The other half of the split, asserted in the same breath so the separation
   * cannot be "fixed" by quietly making the warning read `keySource` too. The
   * warning is allowed to be wrong here. The name is not.
   */
  it('still gets the warning, because a claim and a warning are different things', () => {
    render(<WalletGuideStep {...guideProps} keySource="COLD_CARD" />)

    expect(screen.queryAllByText(WARNING).length).toBeGreaterThan(0)
  })
})
