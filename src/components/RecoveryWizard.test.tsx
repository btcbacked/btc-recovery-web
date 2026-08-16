/**
 * Wizard-level tests for the hardware wallet path.
 *
 * The defect these lock down: a hardware customer reached the hardware step and
 * then the guide with no escrow address and no balance, because
 * `setParsedDescriptor` was only ever called on the password path. A wallet that
 * quietly builds the wrong wallet then looks identical to a correct one.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { RecoveryWizard } from './RecoveryWizard'
import { bitcoin, ecc } from '@/crypto/bitcoin-lib'
import { parseDescriptor } from '@/crypto/descriptor-parser'
import { deriveMultisigAddress } from '@/crypto/address'
import { deriveSeed, computeFingerprint } from '@/crypto/derivation'
import { getProfile } from '@/crypto/profiles'

// bitcoinjs-lib and bip32 expect a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

// ---------------------------------------------------------------------------
// A real 2-of-3 testnet descriptor, so address derivation actually runs
// ---------------------------------------------------------------------------

const master = bip32.fromSeed(Buffer.alloc(32, 0x07), NET)
const xpubs = [0, 1, 2].map((i) => master.derive(i).neutered().toBase58())
const fps = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']

function descriptorWith(childSuffixes: [string, string, string]): string {
  const keys = xpubs.map((xpub, i) => `[${fps[i]}/48'/1'/0'/2']${xpub}${childSuffixes[i]}`)
  return `wsh(sortedmulti(2,${keys.join(',')}))`
}

const MODERN_DESCRIPTOR = descriptorWith(['/0/*', '/0/*', '/0/*'])

/**
 * `derivationPath` carries the leading `m/` and the descriptor bracket does
 * not, which is what the backend writes into every real recovery file: it
 * stores the path through a normaliser that adds `m/`, and strips `^m/` when
 * building the bracket. Every wizard test therefore runs against a file in the
 * production shape, so a path check that compares the two fields as plain
 * strings cannot pass this suite. Do not "tidy" the `m/` away.
 */
function recoveryJson(
  overrides: {
    keySource?: string
    outputDescriptor?: string
    derivationPath?: string
  } = {},
): string {
  return JSON.stringify({
    version: 1,
    network: 'testnet',
    outputDescriptor: overrides.outputDescriptor ?? MODERN_DESCRIPTOR,
    context: { contractId: 'contract-1', role: 'borrower', threshold: 2, totalKeys: 3 },
    userKey: {
      keySource: overrides.keySource ?? 'COLD_CARD',
      derivationPath: overrides.derivationPath ?? "m/48'/1'/0'/2'",
      xpub: xpubs[1],
      fingerprint: 'BBBBBBBB',
    },
  })
}

// The address the tool must show, derived independently of the component.
const EXPECTED_ADDRESS = deriveMultisigAddress(
  parseDescriptor(MODERN_DESCRIPTOR),
  0,
  'testnet',
).address

// ---------------------------------------------------------------------------
// Network stub
// ---------------------------------------------------------------------------

const UTXOS = [
  { txid: 'a'.repeat(64), vout: 0, value: 150_000, status: { confirmed: true } },
  { txid: 'b'.repeat(64), vout: 1, value: 75_000, status: { confirmed: true } },
]
let fetchCalls: string[] = []

function stubFetch(utxos: unknown = UTXOS) {
  fetchCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchCalls.push(String(url))
      const body = String(url).includes('/v1/fees/recommended')
        ? { fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }
        : utxos
      return { ok: true, json: async () => body } as unknown as Response
    }),
  )
}

/** Drive the wizard from upload to the hardware step. */
function loadFile(json: string) {
  render(<RecoveryWizard />)
  fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
  fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
    target: { value: json },
  })
  fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
}

function confirmInfo() {
  fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
}

beforeEach(() => stubFetch())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Task 1: the hardware step shows the escrow address and the balance
// ---------------------------------------------------------------------------

describe('hardware path — escrow address and balance', () => {
  it('shows the escrow address on the hardware step', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    expect(await screen.findByText(EXPECTED_ADDRESS)).toBeTruthy()
  })

  it('shows the address that the descriptor actually derives, not a placeholder', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    const shown = await screen.findByText(EXPECTED_ADDRESS)
    expect(shown.textContent).toBe(EXPECTED_ADDRESS)
    expect(EXPECTED_ADDRESS.startsWith('tb1q')).toBe(true)
  })

  it('fetches the balance for that exact address', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    await screen.findByText(EXPECTED_ADDRESS)
    await waitFor(() =>
      expect(fetchCalls.some((u) => u.includes(`/address/${EXPECTED_ADDRESS}/utxo`))).toBe(true),
    )
  })

  it('shows the total balance in BTC', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    expect(await screen.findByText('Total Balance')).toBeTruthy()
    expect(await screen.findByText(/0\.00225000/)).toBeTruthy()
  })

  it('shows how many deposits make up the balance', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    expect(await screen.findByText(`Deposits (${UTXOS.length})`)).toBeTruthy()
  })

  it('shows a zero balance rather than nothing when the address is empty', async () => {
    stubFetch([])
    loadFile(recoveryJson())
    confirmInfo()

    expect(await screen.findByText('Total Balance')).toBeTruthy()
    expect(await screen.findByText(/0\.00000000/)).toBeTruthy()
    expect(await screen.findByText('Deposits (0)')).toBeTruthy()
  })

  it('keeps showing the address when the balance lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    loadFile(recoveryJson())
    confirmInfo()

    expect(await screen.findByText(EXPECTED_ADDRESS)).toBeTruthy()
    expect(await screen.findByText(/balance could not be loaded/i)).toBeTruthy()
    expect(screen.getByText(/address above is still correct/i)).toBeTruthy()
  })

  it('tells the user the wallet must show this exact address and balance', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    await screen.findByText(EXPECTED_ADDRESS)
    expect(screen.getByText(/must show this exact address/i)).toBeTruthy()
  })

  it('carries the address and balance through to the import instructions', async () => {
    loadFile(recoveryJson())
    confirmInfo()
    await screen.findByText(EXPECTED_ADDRESS)

    fireEvent.click(screen.getByRole('button', { name: /View Import Instructions/i }))

    expect(await screen.findByText(EXPECTED_ADDRESS)).toBeTruthy()
    expect(await screen.findByText('Total Balance')).toBeTruthy()
    expect(await screen.findByText(/0\.00225000/)).toBeTruthy()
  })

  it('hands the user a descriptor carrying a checksum', async () => {
    loadFile(recoveryJson())
    confirmInfo()
    await screen.findByText(EXPECTED_ADDRESS)

    const shown = screen.getByText(new RegExp(`^wsh\\(sortedmulti\\(2,`))
    expect(shown.textContent).toMatch(/#[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}$/)
  })
})

// ---------------------------------------------------------------------------
// A descriptor this tool cannot reproduce must not be presented as checkable
// ---------------------------------------------------------------------------

describe('hardware path — descriptor this tool cannot reproduce', () => {
  const PINNED = descriptorWith(['/0/3', '/0/5', '/0/9'])

  it('warns instead of presenting the address as something to check against', async () => {
    loadFile(recoveryJson({ outputDescriptor: PINNED }))
    confirmInfo()

    expect(await screen.findByText(/Do not rely on the address or balance below/i)).toBeTruthy()
    expect(screen.queryByText(/must show this exact address/i)).toBeNull()
  })

  it('does not warn for a normal descriptor', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    await screen.findByText(EXPECTED_ADDRESS)
    expect(screen.queryByText(/Do not rely on the address or balance below/i)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The derivation path in the file against the one in the file's own descriptor
//
// Neither key check can see this: both compare key material, so a file whose
// bracket names a different path passes every check the tool makes. It is a
// warning and never a refusal, because the address, the balance and the
// signature are all unaffected. The one thing that reads the path is a wallet
// or device registering the key.
// ---------------------------------------------------------------------------

describe('derivation path recorded against the descriptor', () => {
  const WARNING = /derivation path this recovery file records/i

  /** The user's leg moved onto a branch the recorded path does not name. */
  const STALE_BRACKET = MODERN_DESCRIPTOR.replace(
    `[${fps[1]}/48'/1'/0'/2']`,
    `[${fps[1]}/48'/1'/0'/2'/0/9]`,
  )

  function passwordJson(derivationPath: string, outputDescriptor: string): string {
    return JSON.stringify({
      version: 1,
      network: 'testnet',
      outputDescriptor,
      context: { contractId: 'c', role: 'lender', threshold: 2, totalKeys: 3 },
      userKey: {
        keySource: 'PASSWORD',
        derivationProfile: 'pbkdf2-v1',
        salt: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        derivationPath,
        xpub: xpubs[1],
        fingerprint: 'BBBBBBBB',
      },
    })
  }

  it('says nothing about a file in the shape the platform writes', async () => {
    // The recorded path carries an `m/` and the bracket does not, which is
    // every real file. Comparing the two as strings reports all of them.
    loadFile(recoveryJson())
    confirmInfo()

    await screen.findByText(EXPECTED_ADDRESS)
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('warns on the device screen when the two paths disagree', async () => {
    loadFile(recoveryJson({ outputDescriptor: STALE_BRACKET }))
    confirmInfo()

    const warning = await screen.findByText(WARNING)
    expect(warning.textContent).toContain("m/48'/1'/0'/2'")
    expect(warning.textContent).toContain("48'/1'/0'/2'/0/9")
  })

  it('warns and lets a device user carry on to the address and the guide', async () => {
    loadFile(recoveryJson({ outputDescriptor: STALE_BRACKET }))
    confirmInfo()

    // Warned about, not stopped: the escrow address is still derived and the
    // import instructions are still reachable.
    await screen.findByText(WARNING)
    expect(
      screen.getByRole('button', { name: /View Import Instructions/i }),
    ).toBeTruthy()
  })

  it('warns before the password is typed, and still asks for it', async () => {
    loadFile(passwordJson("m/48'/1'/0'/2'", STALE_BRACKET))
    confirmInfo()

    await screen.findByText(WARNING)
    // The password path is open. A hard stop here would turn a fully
    // recoverable file into a dead end.
    const input = screen.getByPlaceholderText(/Enter your escrow password/i)
    expect((input as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /Recover Key/i })).toBeTruthy()
  })

  it('does not warn on a password file in the platform shape', () => {
    loadFile(passwordJson("m/48'/1'/0'/2'", MODERN_DESCRIPTOR))
    confirmInfo()

    expect(screen.getByPlaceholderText(/Enter your escrow password/i)).toBeTruthy()
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('holds the warning back until the file details are confirmed', () => {
    loadFile(recoveryJson({ outputDescriptor: STALE_BRACKET }))

    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('does not carry one file warning onto the next file', async () => {
    // The tool tells people holding more than one copy of their recovery file
    // to open each one here, so this walk is the expected one.
    loadFile(recoveryJson({ outputDescriptor: STALE_BRACKET }))
    confirmInfo()
    await screen.findByText(WARNING)

    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Upload a different file/i }))
    fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
    fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
      target: { value: recoveryJson() },
    })
    fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
    confirmInfo()

    await screen.findByText(EXPECTED_ADDRESS)
    expect(screen.queryByText(WARNING)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task 3: every wallet type takes the hardware path and is named correctly
// ---------------------------------------------------------------------------

describe('wallet types', () => {
  const cases: Array<[string, string]> = [
    ['COLD_CARD', 'Coldcard hardware wallet'],
    ['LEDGER', 'Ledger hardware wallet'],
    ['TREZOR', 'Trezor hardware wallet'],
    ['OTHER', 'Hardware wallet'],
    ['BITBOX02', 'Hardware wallet'],
  ]

  for (const [keySource, label] of cases) {
    it(`names "${keySource}" as "${label}" on the file details step`, () => {
      loadFile(recoveryJson({ keySource }))
      expect(screen.getByText('Key Type').parentElement?.textContent).toContain(label)
    })

    it(`routes "${keySource}" to the hardware step with an address`, async () => {
      loadFile(recoveryJson({ keySource }))
      confirmInfo()

      expect(await screen.findByText(EXPECTED_ADDRESS)).toBeTruthy()
      expect(screen.queryByLabelText(/password/i)).toBeNull()
    })
  }

  it('never labels a non-Coldcard device as a Coldcard', () => {
    loadFile(recoveryJson({ keySource: 'LEDGER' }))
    expect(screen.queryByText(/ColdCard/i)).toBeNull()
  })

  it('still sends a password file to the password step', () => {
    const json = JSON.stringify({
      version: 1,
      network: 'testnet',
      outputDescriptor: MODERN_DESCRIPTOR,
      context: { contractId: 'c', role: 'lender', threshold: 2, totalKeys: 3 },
      userKey: {
        keySource: 'PASSWORD',
        derivationProfile: 'pbkdf2-v1',
        salt: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        derivationPath: "48'/1'/0'/2'",
        xpub: xpubs[1],
        fingerprint: 'BBBBBBBB',
      },
    })
    loadFile(json)
    expect(screen.getByText('Key Type').parentElement?.textContent).toContain('Password')
    confirmInfo()
    expect(screen.queryByText(EXPECTED_ADDRESS)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// A file that disagrees with itself must never be reported as a wrong password
//
// The defect this locks down: the wizard read the derivation error out of hook
// state inside a callback captured on the previous render, so on the first
// failure it was still null and a wrong-password fallback was shown instead.
// The one customer whose password is provably correct was told it was wrong.
// ---------------------------------------------------------------------------

describe('password path — a file that fails its own key check', () => {
  const PASSWORD = 'correct horse battery staple'
  const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  let inconsistentJson = ''

  beforeAll(async () => {
    const profile = getProfile('pbkdf2-v1')
    if (!profile) throw new Error('pbkdf2-v1 profile is missing')

    const seed = await deriveSeed(PASSWORD, SALT, profile)
    const fingerprint = computeFingerprint(seed, 'testnet')

    // The file records a key this password does not produce at this path, so
    // the fingerprint check passes and the xpub check fails. That is exactly
    // the case where the password is right and the file is wrong.
    const recordedXpub = xpubs[0]
    inconsistentJson = JSON.stringify({
      version: 1,
      network: 'testnet',
      outputDescriptor:
        `wsh(sortedmulti(2,[${fingerprint}/48'/1'/0'/2']${recordedXpub}/0/*,` +
        `[${fps[1]}/48'/1'/0'/2']${xpubs[1]}/0/*,` +
        `[${fps[2]}/48'/1'/0'/2']${xpubs[2]}/0/*))`,
      context: { contractId: 'contract-1', role: 'borrower', threshold: 2, totalKeys: 3 },
      userKey: {
        keySource: 'PASSWORD',
        derivationProfile: 'pbkdf2-v1',
        salt: SALT,
        derivationPath: "48'/1'/0'/2'",
        xpub: recordedXpub,
        fingerprint,
      },
    })
  }, 30_000)

  function submitPassword() {
    loadFile(inconsistentJson)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
  }

  it('tells the customer the password was correct, not that it was wrong', async () => {
    submitPassword()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/password is correct/i)
    expect(alert.textContent).not.toMatch(/does not match this recovery file/i)
  })

  it('carries the next steps through to the screen', async () => {
    submitPassword()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Bitcoin professional you trust/i)
  })
})

// ---------------------------------------------------------------------------
// Task 2: the import instructions
// ---------------------------------------------------------------------------

describe('import instructions', () => {
  async function openGuide() {
    loadFile(recoveryJson())
    confirmInfo()
    await screen.findByText(EXPECTED_ADDRESS)
    fireEvent.click(screen.getByRole('button', { name: /View Import Instructions/i }))
    await screen.findByRole('tablist')
  }

  it('tells the Sparrow user to compare the balance and the address', async () => {
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).toMatch(/balance must match the balance shown above/i)
    expect(panel?.textContent).toMatch(/first receive address is the escrow address/i)
  })

  it('names Nunchuk for phone users without promising it will work', async () => {
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).toMatch(/Nunchuk/)
    expect(panel?.textContent).toMatch(/expects a different file format/i)
  })

  it('warns that Sparrow can build a different wallet without saying so', async () => {
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).toMatch(/quietly build a different wallet/i)
  })

  it('says Sparrow needs a computer', async () => {
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).toMatch(/does not run on a phone/i)
  })

  it('no longer sends Sparrow users to a File then Import Wallet menu', async () => {
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).not.toMatch(/Import Wallet/i)
    expect(panel?.textContent).toMatch(/New Wallet/i)
  })

  it('tells the Specter user what its refusal means', async () => {
    await openGuide()
    fireEvent.click(screen.getByRole('tab', { name: 'Specter' }))
    const panel = document.getElementById('wallet-panel-specter')
    expect(panel?.textContent).toMatch(/derivation not being supported/i)
    expect(panel?.textContent).toMatch(/Nothing is wrong with your funds/i)
  })

  it('creates a Bitcoin Core wallet that accepts the descriptor', async () => {
    await openGuide()
    fireEvent.click(screen.getByRole('tab', { name: 'Bitcoin Core' }))
    const panel = document.getElementById('wallet-panel-bitcoin-core')
    // private keys must stay enabled, or importing a descriptor holding an
    // xprv is rejected outright
    expect(panel?.textContent).toContain('createwallet "btcbacked-recovery" false true')
    expect(panel?.textContent).not.toContain('createwallet "recovery" true true')
  })

  it('gives Bitcoin Core the range a wildcard descriptor requires', async () => {
    await openGuide()
    fireEvent.click(screen.getByRole('tab', { name: 'Bitcoin Core' }))
    const panel = document.getElementById('wallet-panel-bitcoin-core')
    expect(panel?.textContent).toContain('"range":[0,100]')
    expect(panel?.textContent).toContain('importdescriptors')
  })

  it('gives Bitcoin Core users a command that checks the address', async () => {
    await openGuide()
    fireEvent.click(screen.getByRole('tab', { name: 'Bitcoin Core' }))
    const panel = document.getElementById('wallet-panel-bitcoin-core')
    expect(panel?.textContent).toContain('deriveaddresses')
    expect(panel?.textContent).toContain('getbalance')
  })

  it('warns a hardware user to sign on the device, not in the wallet app', async () => {
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).toMatch(/approve it on the device/i)
  })

  it('does not claim the configuration holds a private key when it does not', async () => {
    await openGuide()
    expect(screen.queryByText(/contains your signing key in plain text/i)).toBeNull()
  })

  it('uses no dashes in the customer facing instructions', async () => {
    await openGuide()
    const card = screen.getByRole('tablist').parentElement
    expect(card?.textContent ?? '').not.toMatch(/[–—]/)
  })
})
