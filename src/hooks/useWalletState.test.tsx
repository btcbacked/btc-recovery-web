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
import { useWalletState, balanceCheckKey } from './useWalletState'
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


/**
 * A fetch stub whose every /utxo call is held open until the test lets it go,
 * and which answers a DIFFERENT balance per address. Both matter: the parking
 * is what puts two loads in flight at once, and the per-address balance is what
 * lets an assertion say WHICH loan a number came from. A stub answering one
 * balance everywhere would pass these tests with the guard deleted.
 */
const BALANCE_BY_ADDRESS: Record<string, number> = {
  [ESCROW_ADDRESS]: 500_000,
  [WRONG_ADDRESS]: 12_345,
}

type Parked = { url: string; release: () => void }

function stubParkedFetch(parked: Parked[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/v1/fees/recommended')) {
        return {
          ok: true,
          json: async () => ({
            fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1,
          }),
        } as unknown as Response
      }
      const address = Object.keys(BALANCE_BY_ADDRESS).find((a) => u.includes(a))
      const value = address ? BALANCE_BY_ADDRESS[address] : 0
      await new Promise<void>((resolve) => parked.push({ url: u, release: resolve }))
      return {
        ok: true,
        json: async () => [{ txid: 'a'.repeat(64), vout: 0, value, status: { confirmed: true } }],
      } as unknown as Response
    }),
  )
}

/** Lets every held request through and gives React a turn to process them. */
async function releaseAll(parked: Parked[]) {
  const held = parked.splice(0, parked.length)
  await act(async () => {
    held.forEach((p) => p.release())
    await Promise.resolve()
    await Promise.resolve()
  })
  return held.length
}

/**
 * An answer that nobody is waiting for any more must not be written.
 *
 * A fetch cannot be recalled once it is in the air. It lands, and until now it
 * landed on whatever the tool had moved on to: it wrote `balance`, `utxos` and
 * `feeEstimates`, and it re-stamped the "we have checked" marker. On a screen
 * whose whole job is telling somebody whether their Bitcoin is still there,
 * that put one loan's balance under another loan's address.
 */
describe('a load that has been superseded', () => {
  let parked: Parked[] = []

  beforeEach(() => {
    parked = []
    stubParkedFetch(parked)
  })

  it('writes nothing when reset() happened while it was in flight', async () => {
    const { result } = renderHook(() => useWalletState())

    let pending: Promise<void> | null = null
    await act(async () => {
      pending = result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
      await Promise.resolve()
    })

    // The positive partner, and it is not decoration. Everything below is an
    // assertion that a value did NOT appear, and all of it passes for free
    // against a hook that never asked the network anything. This is the line
    // that says the request really was in the air.
    expect(parked.some((p) => p.url.includes(ESCROW_ADDRESS))).toBe(true)
    expect(result.current.isLoading).toBe(true)

    act(() => result.current.reset())
    expect(result.current.isLoading).toBe(false)

    const released = await releaseAll(parked)
    expect(released).toBeGreaterThan(0)
    await act(async () => { await pending })

    expect(result.current.balance).toBe(0)
    expect(result.current.utxos).toHaveLength(0)
    expect(result.current.addresses).toHaveLength(0)
    expect(result.current.feeEstimates).toBeNull()
    // The one that re-armed the gate. A stamp here reports "checked" for
    // whatever escrow is on screen next.
    expect(result.current.balanceCheckedFor).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('lets the newest load win, not the last one to land', async () => {
    // Two loads, two different escrows, two different balances, and the FIRST
    // one answers LAST. Without a sequence guard the hook keeps whichever
    // response arrived most recently, which is the older question's answer.
    const { result } = renderHook(() => useWalletState())

    let first: Promise<void> | null = null
    let second: Promise<void> | null = null
    await act(async () => {
      first = result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
      await Promise.resolve()
    })
    await act(async () => {
      second = result.current.loadWallet(UNRESOLVED, 'testnet', 'https://api.test', null)
      await Promise.resolve()
    })

    const forFirst = parked.filter((p) => p.url.includes(ESCROW_ADDRESS))
    const forSecond = parked.filter((p) => p.url.includes(WRONG_ADDRESS))
    expect(forFirst.length).toBeGreaterThan(0)
    expect(forSecond.length).toBeGreaterThan(0)

    // Newest answers first, oldest answers last.
    await act(async () => {
      forSecond.forEach((p) => p.release())
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      forFirst.forEach((p) => p.release())
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => { await Promise.all([first, second]) })

    expect(result.current.balance).toBe(BALANCE_BY_ADDRESS[WRONG_ADDRESS])
    expect(result.current.balance).not.toBe(BALANCE_BY_ADDRESS[ESCROW_ADDRESS])
    expect(result.current.addresses[0]?.address).toBe(WRONG_ADDRESS)
    expect(result.current.balanceCheckedFor).toBe(
      balanceCheckKey('https://api.test', WRONG_ADDRESS),
    )
  })
})

/**
 * What the "we have checked" stamp is allowed to mean.
 *
 * The wizard reads it by comparing it against the endpoint and address it is
 * showing. Keyed on the endpoint alone it matched for any escrow on the same
 * network, which is every loan on mainnet, so the gate reported "checked" for
 * an escrow nobody had asked about and the previous loan's balance was shown
 * against it.
 */
describe('the completed-check stamp', () => {
  it('names the address it was fetched for, not just the endpoint', async () => {
    const { result } = renderHook(() => useWalletState())

    await act(async () => {
      await result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })

    expect(result.current.balanceCheckedFor).toBe(
      balanceCheckKey('https://api.test', ESCROW_ADDRESS),
    )
    // The same endpoint, a different escrow. This is the comparison the wizard
    // makes, and it has to fail.
    expect(result.current.balanceCheckedFor).not.toBe(
      balanceCheckKey('https://api.test', WRONG_ADDRESS),
    )
    // And a bare endpoint is not the key either, which is what it used to be.
    expect(result.current.balanceCheckedFor).not.toBe('https://api.test')
  })

  it('names the address it QUERIED, not the spelling the file recorded', async () => {
    // BIP-173 makes the uppercase form of a bech32 address the same address,
    // and `deriveEscrowAddress` accepts it for exactly that reason. The stamp
    // is compared EXACTLY, by `balanceCheckKey`, against the address the wizard
    // is showing, and the wizard shows the DERIVED one. Stamp the recorded
    // spelling instead and a file written in the uppercase form leaves the gate
    // permanently unmatched: a balance loads and the screen reads Unknown for
    // the rest of the session.
    //
    // The suite tests the uppercase acceptance at the derivation layer. This is
    // the same file carried through to the stamp.
    const { result } = renderHook(() => useWalletState())
    const RECORDED_UPPERCASE = ESCROW_ADDRESS.toUpperCase()

    await act(async () => {
      await result.current.loadWallet(
        RESOLVED, 'testnet', 'https://api.test', RECORDED_UPPERCASE,
      )
    })

    // The premise: the two spellings really are different strings, and the
    // uppercase one really was accepted. Without these the assertions below
    // pass for a file whose recorded address was lowercase all along, and for
    // a load that was refused and never queried anything.
    expect(RECORDED_UPPERCASE).not.toBe(ESCROW_ADDRESS)
    expect(result.current.error).toBeNull()
    expect(result.current.balance).toBe(150_000)
    expect(fetchedUrls.some((url) => url.includes(ESCROW_ADDRESS))).toBe(true)

    expect(result.current.balanceCheckedFor).toBe(
      balanceCheckKey('https://api.test', ESCROW_ADDRESS),
    )
    // The comparison the wizard makes, and it has to be the one above. This is
    // the key a stamp built from `expectedAddress` would carry.
    expect(result.current.balanceCheckedFor).not.toBe(
      balanceCheckKey('https://api.test', RECORDED_UPPERCASE),
    )
  })

  it('still records a check that completed and failed', async () => {
    // A failed fetch is an answer this hook has. The wizard turns it into
    // Unknown rather than a zero, and it can only do that if the stamp is set.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 }) as unknown as Response))
    const { result } = renderHook(() => useWalletState())

    await act(async () => {
      await result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })

    expect(result.current.error).not.toBeNull()
    expect(result.current.balanceCheckedFor).toBe(
      balanceCheckKey('https://api.test', ESCROW_ADDRESS),
    )
  })
})

/**
 * The same stub as above, except that one address answers a 502 when it is
 * released. Both halves are needed at once: the parking is what puts a failing
 * load and a succeeding load in flight together, and the per-address answer is
 * what lets an assertion say WHICH load a number, or an error, came from.
 */
function stubParkedFetchFailingFor(parked: Parked[], failingAddress: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/v1/fees/recommended')) {
        return {
          ok: true,
          json: async () => ({
            fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1,
          }),
        } as unknown as Response
      }
      const address = Object.keys(BALANCE_BY_ADDRESS).find((a) => u.includes(a))
      const value = address ? BALANCE_BY_ADDRESS[address] : 0
      await new Promise<void>((resolve) => parked.push({ url: u, release: resolve }))
      if (u.includes(failingAddress)) {
        return { ok: false, status: 502 } as unknown as Response
      }
      return {
        ok: true,
        json: async () => [{ txid: 'a'.repeat(64), vout: 0, value, status: { confirmed: true } }],
      } as unknown as Response
    }),
  )
}

/**
 * A superseded load that FAILS, which is the direction the two tests above do
 * not go: both of them park a fetch that succeeds.
 *
 * The catch block wipes state on its way to setting the error, so an abandoned
 * load coming back a 502 does not merely fail to write its own answer, it
 * DELETES somebody else's. The `finally` guard cannot cover this: the catch
 * body has already run by the time `finally` decides not to stamp.
 */
describe('a superseded load that comes back a failure', () => {
  let parked: Parked[] = []

  beforeEach(() => {
    parked = []
    stubParkedFetchFailingFor(parked, WRONG_ADDRESS)
  })

  it('does not wipe the escrow the customer moved on to', async () => {
    // Loan A is in flight and will come back a 502. The customer opens loan B
    // in the same tab, B lands correctly, and only then does A's failure
    // arrive. Without the guard in the catch block it empties the screen: the
    // balance goes to 0, the address and the UTXOs go with it, and an error
    // appears, for a loan that is completely fine.
    const { result } = renderHook(() => useWalletState())

    let failing: Promise<void> | null = null
    await act(async () => {
      failing = result.current.loadWallet(UNRESOLVED, 'testnet', 'https://api.test', null)
      await Promise.resolve()
    })
    const forA = parked.filter((p) => p.url.includes(WRONG_ADDRESS))

    let current: Promise<void> | null = null
    await act(async () => {
      current = result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
      await Promise.resolve()
    })
    const forB = parked.filter((p) => p.url.includes(ESCROW_ADDRESS))

    // Both really are in the air. Everything below is about a value surviving,
    // and a hook that never asked the network anything would satisfy none of
    // it, but these are what say the FAILING request exists at all.
    expect(forA.length).toBeGreaterThan(0)
    expect(forB.length).toBeGreaterThan(0)

    // B answers first and is what the customer is looking at.
    await act(async () => {
      forB.forEach((p) => p.release())
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => { await current })

    // Half a million sats, which is B's number and not A's, so the assertions
    // after the failure can tell which load the balance came from.
    expect(result.current.balance).toBe(BALANCE_BY_ADDRESS[ESCROW_ADDRESS])
    expect(result.current.balance).not.toBe(BALANCE_BY_ADDRESS[WRONG_ADDRESS])
    expect(result.current.addresses[0]?.address).toBe(ESCROW_ADDRESS)
    expect(result.current.error).toBeNull()

    // Now A's 502 lands.
    await act(async () => {
      forA.forEach((p) => p.release())
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => { await failing })

    // Nothing moved. A customer whose escrow holds 0.005 BTC is still shown
    // 0.005 BTC, not an empty escrow and an error about a loan they closed.
    expect(result.current.balance).toBe(BALANCE_BY_ADDRESS[ESCROW_ADDRESS])
    expect(result.current.addresses[0]?.address).toBe(ESCROW_ADDRESS)
    expect(result.current.utxos).toHaveLength(1)
    expect(result.current.feeEstimates).not.toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.balanceCheckedFor).toBe(
      balanceCheckKey('https://api.test', ESCROW_ADDRESS),
    )
  })
})

/**
 * A failure, then a retry that works.
 *
 * The suite already covers the other direction, in "clears a previous load when
 * a later one is refused". This one is what `setError(null)` is for, and it is
 * cleared at BOTH ends of a load: on the way in, and again on the way out of
 * the success path. The two mask each other, so neither survives a mutation
 * alone and the pair has to be driven by its real subject.
 *
 * `ActionChoiceStep` returns Unknown whenever `balanceError !== null`, so an
 * error left standing after a good load means one network blip makes this tool
 * report Unknown for the rest of the session while the money is sitting right
 * there, loaded, in the state beside it.
 */
describe('an error left behind by a load that has since succeeded', () => {
  it('is gone once the retry comes back', async () => {
    // A balance that is neither the 150,000 the default stub answers nor the 0
    // an untouched hook holds, so this assertion cannot be satisfied by the
    // first load, by no load, or by the fixture the other tests share.
    const RETRY_BALANCE = 777_000
    let utxoAttempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/v1/fees/recommended')) {
          return {
            ok: true,
            json: async () => ({
              fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1,
            }),
          } as unknown as Response
        }
        utxoAttempts += 1
        // One transient 502, then the endpoint is back.
        if (utxoAttempts === 1) return { ok: false, status: 502 } as unknown as Response
        return {
          ok: true,
          json: async () => [
            { txid: 'b'.repeat(64), vout: 0, value: RETRY_BALANCE, status: { confirmed: true } },
          ],
        } as unknown as Response
      }),
    )

    const { result } = renderHook(() => useWalletState())

    await act(async () => {
      await result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })

    // The blip really happened. Without this the test below passes for a hook
    // that never had an error to clear.
    const blip = result.current.error
    expect(blip).not.toBeNull()
    expect(result.current.balance).toBe(0)

    await act(async () => {
      await result.current.loadWallet(RESOLVED, 'testnet', 'https://api.test', ESCROW_ADDRESS)
    })

    expect(utxoAttempts).toBe(2)
    expect(result.current.balance).toBe(RETRY_BALANCE)
    expect(result.current.utxos).toHaveLength(1)
    expect(result.current.addresses[0]?.address).toBe(ESCROW_ADDRESS)
    // The whole point. The money is on screen; the message saying it could not
    // be reached must not be.
    expect(result.current.error).toBeNull()
  })
})

/**
 * The claim `balanceCheckKey`'s own docstring makes: no two different pairs can
 * collide on the same key.
 *
 * It is carried entirely by the separator, and nothing tested it.
 */
describe('the key the stamp is built from', () => {
  it('cannot be made to answer for a pair it was not built from', () => {
    const endpoint = 'http://localhost:8999/api'
    const address = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

    // Both halves of this pair are reachable, and it is regtest that makes it
    // so. The endpoint is a field the customer types, and an empty address is
    // `queriedAddress`'s documented value when the derivation refused: no
    // escrow was queried, so there is nothing to name. Glued together with no
    // separator, "endpoint plus address, checked" and "endpoint that happens to
    // end in that address, refused" are the same string, and the refusal's
    // stamp answers "checked" for an escrow nobody asked about.
    expect(balanceCheckKey(endpoint, address)).not.toBe(
      balanceCheckKey(endpoint + address, ''),
    )

    // And the separator cannot be a character a URL contains, which rules out
    // the two that would otherwise be the obvious choices. A URL is full of
    // colons and slashes, so either one leaves the boundary ambiguous.
    expect(balanceCheckKey(endpoint, address)).not.toBe(
      balanceCheckKey('http', `//localhost:8999/api:${address}`),
    )
    expect(balanceCheckKey(endpoint, address)).not.toBe(
      balanceCheckKey('http:', `/localhost:8999/api/${address}`),
    )

    // The positive partner. The same pair still keys the same, so the three
    // above are about where the boundary falls and not about a function that
    // answers something different every time it is called.
    expect(balanceCheckKey(endpoint, address)).toBe(balanceCheckKey(endpoint, address))
    expect(balanceCheckKey(endpoint, address)).toContain(address)
  })
})
