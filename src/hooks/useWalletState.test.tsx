/**
 * The hook that turns a descriptor into an address and then fetches against it.
 *
 * This is the second of the two places that used to derive with a literal 0,
 * and the only one that talks to the network. Every route to it through the UI
 * is already gated on the wizard having derived an address, so the check here
 * is currently unreachable from a screen. That is exactly the guard a later
 * change deletes without noticing, so it is driven directly.
 *
 * The derivation is real. The fetch stub records the address it was asked
 * about, so a balance loaded for the wrong wallet cannot pass as a right one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Buffer } from 'buffer'
import { useWalletState } from './useWalletState'
import { parseDescriptor } from '@/crypto/descriptor-parser'
import { deriveMultisigAddress } from '@/crypto/address'
import { resolveCosignerPositions } from '@/crypto/child-derivation'
import type { RecoveryFileCosigner } from '@/crypto/recovery-file'
import {
  BORROWER_FINGERPRINT,
  LENDER_FINGERPRINT,
  PLATFORM_FINGERPRINT,
  MISMATCHED_CHILD_DESCRIPTOR,
  RANGED_EQUIVALENT_DESCRIPTOR,
} from '@/crypto/__fixtures__/fixed-child'

// bitcoinjs-lib and bip32 expect a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const ESCROW_ADDRESS = deriveMultisigAddress(
  parseDescriptor(MISMATCHED_CHILD_DESCRIPTOR),
  0,
  'testnet',
).address

const WRONG_ADDRESS = deriveMultisigAddress(
  parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
  0,
  'testnet',
).address

const POSITIONS: RecoveryFileCosigner[] = [
  { role: 'borrower', fingerprint: BORROWER_FINGERPRINT, keyIndex: 1 },
  { role: 'lender', fingerprint: LENDER_FINGERPRINT, keyIndex: 2 },
  { role: 'platform', fingerprint: PLATFORM_FINGERPRINT, keyIndex: 0 },
]

const RESOLVED = resolveCosignerPositions(
  parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
  POSITIONS,
)
const UNRESOLVED = parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR)

let fetchedUrls: string[] = []

beforeEach(() => {
  fetchedUrls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchedUrls.push(String(url))
      const body = String(url).includes('/v1/fees/recommended')
        ? { fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }
        : [{ txid: 'a'.repeat(64), vout: 0, value: 150_000, status: { confirmed: true } }]
      return { ok: true, json: async () => body } as unknown as Response
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('useWalletState', () => {
  it('fetches against the escrow address the file records', async () => {
    const { result } = renderHook(() => useWalletState())

    await act(async () => {
      await result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })

    expect(result.current.addresses[0]?.address).toBe(ESCROW_ADDRESS)
    expect(result.current.balance).toBe(150_000)
    expect(fetchedUrls.some((url) => url.includes(ESCROW_ADDRESS))).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('refuses, and asks the blockchain nothing, when the two disagree', async () => {
    const { result } = renderHook(() => useWalletState())

    await act(async () => {
      await result.current.loadWallet(UNRESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })

    expect(result.current.addresses).toHaveLength(0)
    expect(result.current.balance).toBe(0)
    expect(result.current.error).toContain('This page cannot open this escrow.')
    // Nothing at all, not merely nothing about the wrong address. The refusal
    // happens before the derivation returns, so there is no address to ask
    // about and no fee estimate worth fetching.
    expect(fetchedUrls).toHaveLength(0)
  })

  it('clears a previous load when a later one is refused', async () => {
    // The state this hook holds is read beside its own error. A success then a
    // refusal is reachable: `WalletViewStep` offers Retry, and the wizard calls
    // `loadWallet` again on re-entry. Leaving the first load standing renders
    // an address and a balance under a message saying this page cannot open
    // the escrow, and that address is one the customer can copy and send to.
    const { result } = renderHook(() => useWalletState())

    await act(async () => {
      await result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })
    expect(result.current.addresses).toHaveLength(1)
    expect(result.current.balance).toBe(150_000)

    await act(async () => {
      await result.current.loadWallet(UNRESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })

    expect(result.current.addresses).toHaveLength(0)
    expect(result.current.utxos).toHaveLength(0)
    expect(result.current.balance).toBe(0)
    expect(result.current.feeEstimates).toBeNull()
    expect(result.current.error).toContain('This page cannot open this escrow.')
  })

  it('loads without a check when the file records no address, which is not a pass', async () => {
    const { result } = renderHook(() => useWalletState())

    await act(async () => {
      await result.current.loadWallet(UNRESOLVED, 'testnet', 'https://api.test', null)
    })

    expect(result.current.addresses[0]?.address).toBe(WRONG_ADDRESS)
    expect(result.current.error).toBeNull()
  })
})
