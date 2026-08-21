/**
 * The warning, with the detector deliberately made to miss.
 *
 * Every other test in this suite exercises the real scan, so all of them agree
 * with it by construction. That is exactly the wrong shape for proving a guard
 * fails closed, because the question is not "does the scan work" but "what
 * happens on the day it does not". A key shape nobody anticipated is the whole
 * risk: the pattern reports clean, and under the old rule the screen went
 * silent while printing the key in full.
 *
 * So here the scan is replaced with one that is wrong in the dangerous
 * direction: `provablyPublicOnly` certifies everything as safe, on a string
 * that is carrying a real `tprv`.
 *
 * This lives in its own file because the mock is per module and the tests next
 * door need the genuine scan.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { bitcoin, ecc } from '@/crypto/bitcoin-lib'

vi.mock('@/crypto/private-key-scan', () => ({
  provablyPublicOnly: () => true,
}))

import { ResultStep } from './ResultStep'
import { WalletGuideStep } from './WalletGuideStep'
import { provablyPublicOnly } from '@/crypto'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const bip32 = BIP32Factory(ecc)
const node = bip32.fromSeed(Buffer.alloc(32, 0x21), bitcoin.networks.testnet)
const TPRV = node.toBase58()
const TPUB = node.neutered().toBase58()

/** A real private key on the page, which the blinded scan reports clean. */
const CARRIES_THE_KEY =
  `wsh(multi(2,[aaaaaaaa/48'/1'/0'/2']${TPRV}/0/1,` +
  `[bbbbbbbb/48'/1'/0'/2']${TPUB}/0/1))`

const WARNING = /Keep this secret/i

const guideProps = {
  // The password path: this string really does carry the recovered key.
  keySource: 'PASSWORD',
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

describe('when the detector is wrong in the dangerous direction', () => {
  /** The premise, asserted rather than assumed: the scan really is blinded. */
  it('the scan really has been made to miss the key that is on the page', () => {
    expect(CARRIES_THE_KEY).toContain(TPRV)
    expect(provablyPublicOnly(CARRIES_THE_KEY)).toBe(true)
  })

  /**
   * The guarantee that does not depend on the scan being right. `ResultStep` is
   * reachable only on the password path, where the string always carries the
   * recovered key, so the screen asserts that itself rather than asking.
   */
  it('ResultStep still warns, because it never asks the scan', () => {
    render(<ResultStep descriptor={CARRIES_THE_KEY} onContinue={() => {}} />)

    expect(document.body.textContent ?? '').toContain(TPRV)
    expect(screen.queryAllByText(WARNING).length).toBeGreaterThan(0)
  })

  /**
   * The honest limit of the fix, recorded rather than hidden.
   *
   * A screen that genuinely serves both paths has nothing but the string to go
   * on, so a scan that actively lies about the string can still silence it.
   * What the new rule buys is that silence now needs a false positive claim of
   * proof, not merely a failed match, and the one screen that always carries
   * the secret no longer depends on the scan at all.
   */
  it('WalletGuideStep is silenced, which is why ResultStep does not consult it', () => {
    render(<WalletGuideStep {...guideProps} descriptor={CARRIES_THE_KEY} />)

    expect(screen.queryAllByText(WARNING).length).toBe(0)
  })
})
