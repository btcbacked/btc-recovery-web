/**
 * Which loan a number on this screen belongs to.
 *
 * A customer opens this tool when there is nobody left to ask, to find out
 * whether their Bitcoin is still there. Every screen here shows one escrow
 * address and one balance, and the only thing tying them together is that the
 * same file produced both. Two ways that tie used to come apart, and both are
 * driven end to end below through the real wizard, a real password derivation
 * and real address derivation. Only the network is stubbed.
 *
 *  1. A fetch nobody was waiting for any more still landed. `reset()` could not
 *     cancel one, so an abandoned request wrote its balance and re-stamped the
 *     "we have checked" marker over a wizard that had already moved to a
 *     different loan. The marker was keyed on the endpoint alone, and every
 *     loan on a network shares one endpoint, so the gate agreed that the new
 *     escrow had been checked and showed the old escrow's money against it.
 *
 *  2. A second recovery file inherited the first file's wallet state, because
 *     the wizard cleared its own derived state on upload and could not reach
 *     the balance, the UTXOs or the error held next door.
 *
 * The two loans hold DIFFERENT amounts on purpose. A fixture answering the same
 * balance everywhere cannot tell which loan a number came from, so it passes
 * with the guards deleted.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { RecoveryWizard } from './RecoveryWizard'
import { bitcoin, ecc } from '@/crypto/bitcoin-lib'
import { parseDescriptor } from '@/crypto/descriptor-parser'
import { deriveMultisigAddress } from '@/crypto/address'
import { deriveSeed, computeFingerprint, deriveXprv, neuterXprv } from '@/crypto/derivation'
import { getProfile } from '@/crypto/profiles'

// bitcoinjs-lib and bip32 expect a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet
const PASSWORD = 'correct horse battery staple'
const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ACCOUNT_PATH = "m/48'/1'/0'/2'"

/** Loan A holds 0.00500000 BTC. Loan B is empty. Two loans, two answers. */
const LOAN_A_SATS = 500_000
const LOAN_B_SATS = 0
/** What loan A's escrow answers on a LATER fetch, so a stale number is visible. */
const LOAN_A_LATER_SATS = 225_000

let loanA = ''
let loanB = ''
let loanADevice = ''
let addrA = ''
let addrB = ''

/**
 * A recovery file for one loan. `cosignerSeedByte` is what makes two loans
 * different escrows; the user's own key is the same in both, which is what a
 * real customer holding two loans has.
 */
function buildFile(
  cosignerSeedByte: number,
  userXpub: string,
  fingerprint: string,
  keySource: string,
): { json: string; descriptor: string } {
  const m = bip32.fromSeed(Buffer.alloc(32, cosignerSeedByte), NET)
  const xpubs = [0, 2].map((i) => m.derive(i).neutered().toBase58())
  const outputDescriptor =
    `wsh(sortedmulti(2,[${fingerprint}/48'/1'/0'/2']${userXpub}/0/1,` +
    `[aaaaaaaa/48'/1'/0'/2']${xpubs[0]}/0/*,` +
    `[cccccccc/48'/1'/0'/2']${xpubs[1]}/0/*))`
  const userKey: Record<string, string> = {
    keySource,
    derivationPath: ACCOUNT_PATH,
    xpub: userXpub,
    fingerprint,
  }
  if (keySource === 'PASSWORD') {
    userKey.derivationProfile = 'pbkdf2-v1'
    userKey.salt = SALT
  }
  return {
    descriptor: outputDescriptor,
    json: JSON.stringify({
      version: 1,
      network: 'testnet',
      outputDescriptor,
      context: { contractId: 'c', role: 'borrower', threshold: 2, totalKeys: 3 },
      userKey,
    }),
  }
}

beforeAll(async () => {
  const profile = getProfile('pbkdf2-v1')!
  const seed = await deriveSeed(PASSWORD, SALT, profile)
  const userXprv = deriveXprv(seed, ACCOUNT_PATH, 'testnet')
  const userXpub = neuterXprv(userXprv, 'testnet')
  const fingerprint = computeFingerprint(seed, 'testnet')

  const a = buildFile(0x07, userXpub, fingerprint, 'PASSWORD')
  const b = buildFile(0x11, userXpub, fingerprint, 'PASSWORD')
  // The SAME escrow as loan A, held on a device instead of behind a password.
  // Both files exist for one contract, which is why the file being replaced and
  // the file replacing it can share an address.
  const aDevice = buildFile(0x07, userXpub, fingerprint, 'COLD_CARD')

  loanA = a.json
  loanB = b.json
  loanADevice = aDevice.json
  addrA = deriveMultisigAddress(parseDescriptor(a.descriptor), 0, 'testnet').address
  addrB = deriveMultisigAddress(parseDescriptor(b.descriptor), 0, 'testnet').address

  // If these ever coincide the whole file proves nothing.
  expect(addrA).not.toBe(addrB)
}, 60_000)

// ---------------------------------------------------------------------------
// Network: every /utxo request is held open until a test lets it go
// ---------------------------------------------------------------------------

type Parked = { url: string; release: () => void }
let parked: Parked[] = []
/** Successive answers per address. The last one repeats once exhausted. */
let answers: Record<string, number[]> = {}

function stubFetch() {
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
      const address = Object.keys(answers).find((a) => u.includes(a))
      const queue = address ? answers[address] : undefined
      const sats = queue === undefined ? 0 : queue.length > 1 ? queue.shift()! : queue[0]
      await new Promise<void>((resolve) => parked.push({ url: u, release: resolve }))
      return {
        ok: true,
        json: async () =>
          sats === 0
            ? []
            : [{ txid: 'a'.repeat(64), vout: 0, value: sats, status: { confirmed: true } }],
      } as unknown as Response
    }),
  )
}

/** Lets through every held request whose URL names this address. */
async function release(address: string) {
  const held = parked.filter((p) => p.url.includes(address))
  parked = parked.filter((p) => !p.url.includes(address))
  await act(async () => {
    held.forEach((p) => p.release())
    await Promise.resolve()
    await Promise.resolve()
  })
  return held.length
}

const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

beforeEach(() => {
  parked = []
  answers = { [addrA]: [LOAN_A_SATS], [addrB]: [LOAN_B_SATS] }
  stubFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Driving the wizard
// ---------------------------------------------------------------------------

function pasteFile(json: string) {
  fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
  fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
    target: { value: json },
  })
  fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
}

/** Upload a password file and walk it all the way to the Choose screen. */
async function recoverToChooseScreen(json: string) {
  pasteFile(json)
  fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
  fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
    target: { value: PASSWORD },
  })
  fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }))
}

/**
 * The balance line, read from the live region that carries it.
 *
 * Throws rather than returning nothing, so a screen that stopped rendering the
 * balance at all fails here instead of passing every "does not show" assertion
 * below for free.
 */
function balanceLine(): string {
  const label = screen.getByText('Escrow Balance')
  const region = label.closest('[role="status"]')
  if (!region) throw new Error('the Choose screen renders no balance live region')
  return region.textContent ?? ''
}

// ---------------------------------------------------------------------------
// 1. An abandoned fetch must not speak for the loan that replaced it
// ---------------------------------------------------------------------------

describe('a balance abandoned mid-flight', () => {
  it('never appears against the next loan opened in the same tab', async () => {
    render(<RecoveryWizard />)

    // ---- loan A, funded ----------------------------------------------------
    await recoverToChooseScreen(loanA)
    await screen.findByText(addrA)
    await settle(500) // the Choose screen debounce fires and the fetch is held

    // The positive partner for everything below. Every later assertion says a
    // value did NOT appear, and all of it passes for free against a tool that
    // never asked the network anything at all.
    expect(parked.some((p) => p.url.includes(addrA))).toBe(true)

    // The customer wanders to the export guide, which starts a fetch of its
    // own, and then starts over while both are still in the air.
    fireEvent.click(screen.getByRole('button', { name: /Export Your Signing File Instead/i }))
    await settle(50)
    fireEvent.click(await screen.findByRole('button', { name: /Start Over/i }))
    await settle(50)
    expect(screen.queryByText(addrA)).toBeNull()

    // ---- loan B, a different escrow, empty ---------------------------------
    // Loan A's requests are still in the air, deliberately. A slow answer
    // coming back while the customer is already looking at the next loan is
    // the ordering that does the damage, and the one the field produces.
    await recoverToChooseScreen(loanB)
    await screen.findByText(addrB)
    await settle(500) // loan B's own fetch starts, and is held in turn

    // Nobody is waiting for these any more. They land anyway.
    expect(await release(addrA)).toBeGreaterThan(0)

    // Loan A's money must not be standing under loan B's address, and loan A's
    // answer must not have made this screen think it has been answered.
    expect(balanceLine()).not.toContain('0.00500000')
    expect(balanceLine()).toMatch(/Checking the balance/i)

    // The other positive partner. That waiting state is a stage, not the end:
    // loan B's own answer arrives and it is loan B's, which is zero.
    await release(addrB)
    expect(balanceLine()).toContain('0.00000000')
    expect(balanceLine()).toMatch(/No spendable balance/i)
    expect(balanceLine()).not.toContain('0.00500000')
  }, 30_000)
})

// ---------------------------------------------------------------------------
// 2. A second file starts clean
// ---------------------------------------------------------------------------

describe('a second recovery file', () => {
  it('does not inherit the balance fetched for the first one', async () => {
    // Same escrow both times, which is the case the endpoint-and-address gate
    // cannot catch and so isolates this defect on its own. A customer holding a
    // device file and a password file for one contract has exactly this pair.
    answers = { [addrA]: [LOAN_A_SATS, LOAN_A_LATER_SATS] }
    render(<RecoveryWizard />)

    // ---- the first file, on a device, loads a balance ----------------------
    pasteFile(loanADevice)
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await screen.findByText(addrA)
    await release(addrA)

    // The positive partner. The state this test says must be cleared has to
    // exist first, or clearing it proves nothing.
    expect(await screen.findByText(/0\.00500000/)).toBeTruthy()

    // ---- back out and open a different file --------------------------------
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Upload a different file/i }))

    await recoverToChooseScreen(loanA)
    await screen.findByText(addrA)

    // Read before this file's own fetch has been allowed to return. Nothing
    // has been asked on behalf of THIS file yet, and the previous file's
    // balance is not an answer about it.
    expect(balanceLine()).toMatch(/Unknown/i)
    expect(balanceLine()).not.toContain('0.00500000')

    // This file's own answer, and it is the later one, so the number on screen
    // can be traced to the fetch that produced it.
    await settle(500)
    await release(addrA)
    expect(balanceLine()).toContain('0.00225000')
    expect(balanceLine()).not.toContain('0.00500000')
  }, 30_000)
})
