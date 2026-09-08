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
import { deriveSeed, computeFingerprint, deriveXprv, neuterXprv } from '@/crypto/derivation'
import { getProfile } from '@/crypto/profiles'
import { ESCROW_UNSUPPORTED } from '@/crypto/errors'

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

/** Paste a file into a wizard that is already mounted and sitting on upload. */
function pasteFile(json: string) {
  fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
  fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
    target: { value: json },
  })
  fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
}

/** Drive the wizard from upload to the hardware step. */
function loadFile(json: string) {
  render(<RecoveryWizard />)
  pasteFile(json)
}

function confirmInfo() {
  fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
}

/**
 * The last Sparrow step, which is the one that differs by key source.
 *
 * Read whole rather than searched, so the assertions below can be equalities.
 * A substring match cannot see a sentence that has grown a wrong opening, and
 * that is exactly the defect this step was changed to fix: the password branch
 * used to be prefixed with "To move funds, use the Send tab.", pointing a
 * customer at a control that cannot spend from this file.
 */
function sparrowLastStep(): string {
  const steps = document.getElementById('wallet-panel-sparrow')?.querySelectorAll('li')
  return steps?.[steps.length - 1]?.textContent ?? ''
}

/** The Sparrow intro paragraph, verbatim. */
const SPARROW_INTRO =
  'Sparrow is the easiest option for most people. It runs on Windows, macOS and Linux. ' +
  'It does not run on a phone, so you need a computer for this.'

function sparrowIntro(): string {
  return document.getElementById('wallet-panel-sparrow')?.querySelector('p')?.textContent ?? ''
}

/** The whole of the password branch of that step, verbatim. */
const PASSWORD_LAST_STEP =
  'Sparrow opens this file as a watch-only wallet: it shows your balance and addresses, ' +
  'but it will not sign with the key inside, so its Send tab cannot move your funds. ' +
  'To move funds with this key, come back to this page and choose Create Transaction, ' +
  'or import the same file into Bitcoin Core, which keeps the key and can sign your part.'

/**
 * The same step for a customer whose escrow this page cannot derive.
 *
 * "Come back to this page and choose Create Transaction" is only true while the
 * page can build one. On a refusal `WalletViewStep` returns its refusal branch
 * and there is no such control, so the clause is dropped rather than sending a
 * frightened customer to a button that is not there. Bitcoin Core survives the
 * refusal because it holds the key itself.
 */
const PASSWORD_LAST_STEP_NO_ESCROW =
  'Sparrow opens this file as a watch-only wallet: it shows your balance and addresses, ' +
  'but it will not sign with the key inside, so its Send tab cannot move your funds. ' +
  'To move funds with this key, import the same file into Bitcoin Core, which keeps the ' +
  'key and can sign your part.'

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

  it('carries the address and balance through to the import instructions', async () => {
    loadFile(recoveryJson())
    confirmInfo()
    await screen.findByText(EXPECTED_ADDRESS)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))

    expect(await screen.findByText(EXPECTED_ADDRESS)).toBeTruthy()
    expect(await screen.findByText('Total Balance')).toBeTruthy()
    expect(await screen.findByText(/0\.00225000/)).toBeTruthy()
  })

  it('calls that destination an export on the button and on the chip alike', async () => {
    /*
     * Elie ruled the word EXPORT for what the customer does with their own
     * wallet. Three things point at this one screen and they have to agree, or
     * the tool contradicts itself between one click and the next:
     *
     *  - the password customer's link, "Export Your Signing File Instead"
     *  - the hardware customer's button, here
     *  - the progress chip ON the destination, which `StepIndicator` renders
     *    visibly and also puts in the aria-label of the step circle
     *
     * The chip was the one that was missed: clicking a button that said Export
     * landed on a screen whose chip, and whose screen reader announcement, both
     * said Import.
     */
    loadFile(recoveryJson())
    confirmInfo()
    await screen.findByText(EXPECTED_ADDRESS)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    const chip = screen.getByLabelText(/^Step 7: /i)
    expect(chip.getAttribute('aria-label')).toMatch(/^Step 7: Export/)
    expect(chip.getAttribute('aria-label')).not.toMatch(/Import/)

    // The positive control for that negative: 'Import' is still a real label in
    // this wizard, on Path B, where a file really is being pulled in from the
    // other signer. A sweep that renamed every chip would be wrong.
    expect(screen.getByLabelText(/^Step 1: Upload/i)).toBeTruthy()
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
// An escrow other wallet software will disagree with
//
// The keys are pinned to fixed children rather than ranged, so this tool's
// address is right and most wallet apps will show a different one. The old copy
// here said "Do not rely on the address or balance below", which was the
// opposite of true and is why these assertions changed: the address below is
// exactly what the customer should rely on.
// ---------------------------------------------------------------------------

const NOTICE = /Your Bitcoin is safe and this page has the right address for it/i
const REFUSAL = /This page cannot open this escrow/i

describe('an escrow other wallet software will disagree with', () => {
  const PINNED = descriptorWith(['/0/3', '/0/5', '/0/9'])
  const PINNED_ADDRESS = deriveMultisigAddress(parseDescriptor(PINNED), 0, 'testnet').address

  it('tells the customer this page has the right address, not that the address is doubtful', async () => {
    loadFile(recoveryJson({ outputDescriptor: PINNED }))
    confirmInfo()

    expect(await screen.findByText(NOTICE)).toBeTruthy()
    // The line this used to guard against, telling the reader to compare the
    // address against another wallet and to stop if the two differ, is gone
    // from `EscrowSummary`, which is what this screen renders. It still exists
    // in `WalletGuideStep`, and the two tests at the end of this block are
    // where both of its branches are asserted.
  })

  it('still shows the address and the balance, because both are correct', async () => {
    loadFile(recoveryJson({ outputDescriptor: PINNED }))
    confirmInfo()

    expect(await screen.findByText(PINNED_ADDRESS)).toBeTruthy()
    expect(await screen.findByText('Total Balance')).toBeTruthy()
  })

  it('says it once on a screen whose escrow summary already carries it', async () => {
    loadFile(recoveryJson({ outputDescriptor: PINNED }))
    confirmInfo()

    await screen.findByText(PINNED_ADDRESS)
    expect(screen.getAllByText(NOTICE)).toHaveLength(1)
  })

  it('does not warn for a normal descriptor', async () => {
    loadFile(recoveryJson())
    confirmInfo()

    await screen.findByText(EXPECTED_ADDRESS)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('does not tell the customer a difference means calling support, having just predicted one', async () => {
    loadFile(recoveryJson({ outputDescriptor: PINNED }))
    confirmInfo()
    await screen.findByText(NOTICE)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    const card = screen.getByRole('tablist').parentElement
    expect(card?.textContent).not.toMatch(/contact BTCBacked support/i)
    expect(card?.textContent).toMatch(/this wallet cannot open your escrow/i)
    expect(card?.textContent).toMatch(/Nothing is wrong with your funds/i)
  })

  it('still sends an ordinary escrow to support when the numbers disagree', async () => {
    loadFile(recoveryJson())
    confirmInfo()
    await screen.findByText(EXPECTED_ADDRESS)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    const card = screen.getByRole('tablist').parentElement
    expect(card?.textContent).toMatch(/contact BTCBacked support/i)
    expect(card?.textContent).not.toMatch(/this wallet cannot open your escrow/i)
  })
})

// ---------------------------------------------------------------------------
// The pinned-escrow notice on the screens that have no escrow summary
//
// `hardware` and `guide` render an `EscrowSummary`, which carries its own copy
// of the notice. Every OTHER screen depends on the wizard rendering it at card
// level, and that branch had no test: every pinned-escrow test above stops at
// one of the two screens that never needed the fix. A pinned escrow walking on
// to `result` or `action-choice` could have gone silent without one failure.
//
// Reaching those screens needs the password path, because the device path goes
// straight from `hardware` to `guide` and never touches either.
// ---------------------------------------------------------------------------

describe('the pinned-escrow notice past the screens that carry their own', () => {
  const PASSWORD = 'correct horse battery staple'
  const SALT = 'b2c3d4e5f60718293a4b5c6d7e8f9012'
  const ACCOUNT_PATH = "m/48'/1'/0'/2'"

  let pinnedJson = ''
  let pinnedAddress = ''

  beforeAll(async () => {
    const profile = getProfile('pbkdf2-v1')
    if (!profile) throw new Error('pbkdf2-v1 profile is missing')

    const seed = await deriveSeed(PASSWORD, SALT, profile)
    const userXprv = deriveXprv(seed, ACCOUNT_PATH, 'testnet')
    const userXpub = neuterXprv(userXprv, 'testnet')
    const fingerprint = computeFingerprint(seed, 'testnet')

    // The customer's own leg is pinned to a fixed child, the other two range.
    // Supported, so an address IS derived and it is the right one. What makes
    // it worth saying is that other wallet software will not find it.
    const pinnedDescriptor =
      `wsh(sortedmulti(2,[${fingerprint}/48'/1'/0'/2']${userXpub}/0/1,` +
      `[${fps[0]}/48'/1'/0'/2']${xpubs[0]}/0/*,` +
      `[${fps[2]}/48'/1'/0'/2']${xpubs[2]}/0/*))`

    pinnedAddress = deriveMultisigAddress(
      parseDescriptor(pinnedDescriptor),
      0,
      'testnet',
    ).address

    pinnedJson = JSON.stringify({
      version: 1,
      network: 'testnet',
      outputDescriptor: pinnedDescriptor,
      context: { contractId: 'c', role: 'borrower', threshold: 2, totalKeys: 3 },
      userKey: {
        keySource: 'PASSWORD',
        derivationProfile: 'pbkdf2-v1',
        salt: SALT,
        derivationPath: ACCOUNT_PATH,
        xpub: userXpub,
        fingerprint,
      },
    })
  }, 30_000)

  /** Password, then the screen that hands back the rebuilt key. */
  async function reachResult() {
    loadFile(pinnedJson)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
    await screen.findByRole('button', { name: /^Continue$/i })
  }

  it('derives an address the ranged reading would have missed', () => {
    // Guards the fixture itself. If the pinned leg ever collapsed back onto
    // `/0/*` the whole block would still pass while testing nothing.
    const ranged = pinnedJson.replace('/0/1,', '/0/*,')
    const rangedAddress = deriveMultisigAddress(
      parseDescriptor(JSON.parse(ranged).outputDescriptor),
      0,
      'testnet',
    ).address
    expect(pinnedAddress).not.toBe(rangedAddress)
  })

  it('warns on the screen that hands back the rebuilt key', async () => {
    await reachResult()
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  it('warns on the screen where the customer picks what to do next', async () => {
    await reachResult()
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }))

    // action-choice. No escrow summary renders here, so the wizard card is the
    // only thing that can carry it.
    expect(screen.getByRole('button', { name: /Sign Existing PSBT/i })).toBeTruthy()
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  it('says it once there, not twice', async () => {
    await reachResult()
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }))

    expect(screen.getAllByText(NOTICE)).toHaveLength(1)
  })

  it('is vouching for the address that screen shows', async () => {
    await reachResult()
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }))

    // The notice claims this page has the right address. That claim is only
    // worth anything if the address on the same screen is the pinned one.
    expect(screen.getByText(NOTICE)).toBeTruthy()
    expect(screen.getByText(/Escrow Address \(/i)).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('does not warn on the same walk for an ordinary escrow', async () => {
    await reachResult()
    cleanup()

    // Same path, same screens, unpinned descriptor: silence.
    loadFile(pinnedJson.replace('/0/1,', '/0/*,'))
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }))

    expect(screen.getByRole('button', { name: /Sign Existing PSBT/i })).toBeTruthy()
    expect(screen.queryByText(NOTICE)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// A recovery file this tool will not derive an address from at all
//
// `childIndices` refuses a child suffix that is not exactly two components,
// because `psbt-signer.ts` locates the key by the last two components of the
// PSBT path: a longer suffix would derive one key for the address and sign with
// another. The refusal is caught in the wizard and turns into a null address,
// which on its own is silent. These lock down that it is not silent, and that
// the screens which stop rendering an escrow summary do not thereby stop
// warning as well.
// ---------------------------------------------------------------------------

describe('a recovery file this tool refuses to derive an address from', () => {
  const UNSUPPORTED = descriptorWith(['/0/0/1', '/0/*', '/0/*'])

  it('says so on the device screen', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()

    expect(await screen.findByText(REFUSAL)).toBeTruthy()
  })

  it('says so even though no escrow summary renders to carry it', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()

    await screen.findByText(REFUSAL)
    // No address and no balance: the summary is what used to carry every
    // caveat, and on a refusal it is not on the screen at all.
    expect(screen.queryByText('Total Balance')).toBeNull()
    expect(screen.queryByText('Escrow Address')).toBeNull()
  })

  it('carries the refusal onto the screen that hands over the file to import', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()
    await screen.findByText(REFUSAL)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })

  it('does not also claim to have the right address', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()

    await screen.findByText(REFUSAL)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  /** Open the import instructions from the device screen, which is one route. */
  async function openGuideOnRefusal() {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()
    await screen.findByText(REFUSAL)
    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')
  }

  function panelFor(tab: string): HTMLElement {
    fireEvent.click(screen.getByRole('tab', { name: tab }))
    const panel = document.getElementById(`wallet-panel-${tab.replace(/\s+/g, '-').toLowerCase()}`)
    if (!panel) throw new Error(`no panel rendered for ${tab}`)
    return panel
  }

  it('does not send them to compare against an address and balance shown above', async () => {
    // The screen contradicted itself. Its own intro says there is no address
    // or balance here to compare against, and three lines later every tab told
    // the customer the balance "must match the balance shown above" and to
    // confirm the first receive address is "the escrow address shown above".
    // It was fixed on the intro and the mismatch line only, so all three tabs
    // kept saying it.
    await openGuideOnRefusal()

    for (const tab of ['Sparrow', 'Specter', 'Bitcoin Core']) {
      const text = panelFor(tab).textContent ?? ''
      expect(text).not.toMatch(/shown above/i)
      expect(text).not.toMatch(/balance above/i)
      expect(text).not.toMatch(/must match the balance/i)
      expect(text).not.toMatch(/address as the one shown/i)
    }
  })

  it('tells them what to read instead, on every tab', async () => {
    // The other half. Without this the block above passes for a change that
    // deletes the check step outright and leaves the customer importing a
    // wallet with nothing said about what to look at when it loads.
    await openGuideOnRefusal()

    for (const tab of ['Sparrow', 'Specter', 'Bitcoin Core']) {
      expect(panelFor(tab).textContent).toMatch(
        /no address and no balance for you to compare against/i,
      )
    }
  })

  it('does not promise this branch a single address either', async () => {
    // Both branches share one `deriveaddresses` command, so the index 0
    // assumption sat in the refusal copy too: "This prints the address:" over
    // `deriveaddresses "PASTE_HERE" [0,0]`. There is nothing here to compare
    // against, which is exactly why a customer reading out one address and
    // taking it for their escrow is the same wrong fact reached from the other
    // side.
    await openGuideOnRefusal()
    const text = panelFor('Bitcoin Core').textContent ?? ''

    expect(text).toContain('deriveaddresses "PASTE_HERE" [0,100]')
    expect(text).toMatch(/prints addresses 0 to 100/i)
    expect(text).not.toMatch(/prints the address:/i)
  })

  it('still tells an ordinary escrow to compare, on every tab', async () => {
    // And the third half, which is the one that matters most: the comparison
    // is the whole point of this screen for every customer whose file is fine.
    loadFile(recoveryJson())
    confirmInfo()
    await screen.findByText(EXPECTED_ADDRESS)
    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    for (const tab of ['Sparrow', 'Specter', 'Bitcoin Core']) {
      const text = panelFor(tab).textContent ?? ''
      expect(text).toMatch(/shown above|balance above/i)
      expect(text).not.toMatch(/no address and no balance/i)
    }
  })

  it('is an alert and not an ambient status, because the page is blocked', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()

    await screen.findByText(REFUSAL)
    expect(screen.getByRole('alert').textContent).toMatch(REFUSAL)
  })

  it('does not send them back to a page that has just said it cannot help', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()
    await screen.findByText(REFUSAL)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    // Three endings are possible here and only silence is true. Support is
    // wrong for the same reason it is wrong on a pinned escrow, and "come back
    // and move it from this page" contradicts the notice directly above it.
    const card = screen.getByRole('tablist').parentElement
    expect(card?.textContent).not.toMatch(/contact BTCBacked support/i)
    expect(card?.textContent).not.toMatch(/move your Bitcoin from this page/i)

    // POSITIVE PARTNER. Both negatives above were already true on this branch
    // before any of this copy was written, so on their own they are a pair of
    // permanent no ops: an empty card, a card that failed to render, and a card
    // that says the right thing all pass them identically. This asserts the
    // ending that IS true here, so the silence above is provably deliberate
    // silence in a populated card rather than nothing at all.
    expect(card?.textContent).toMatch(/read both from Sparrow itself/i)
  })

  it('does not promise an address and a balance it has not got', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNSUPPORTED }))
    confirmInfo()
    await screen.findByText(REFUSAL)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    expect(screen.queryByText(/Below is the address and balance your wallet must show/i)).toBeNull()
    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// A descriptor this tool cannot read AT ALL
//
// Same harm as the block above, reached a different way. `parseDescriptor`
// throwing leaves `parsedDescriptor` null, which is also what "no file opened
// yet" looks like, so the refusal used to be invisible: no address, no balance,
// no warning, and a sign button that did nothing and said nothing.
// ---------------------------------------------------------------------------

describe('a recovery file whose descriptor will not parse', () => {
  // `multi` rather than `sortedmulti`, which `parseDescriptor` refuses outright.
  const UNREADABLE = `wsh(multi(2,[${fps[0]}/48'/1'/0'/2']${xpubs[0]}/0/*,[${fps[1]}/48'/1'/0'/2']${xpubs[1]}/0/*))`

  it('says so rather than handing over the file in silence', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNREADABLE }))
    confirmInfo()

    expect(await screen.findByText(REFUSAL)).toBeTruthy()
  })

  it('shows no address and no balance to act on', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNREADABLE }))
    confirmInfo()

    await screen.findByText(REFUSAL)
    expect(screen.queryByText('Total Balance')).toBeNull()
    expect(screen.queryByText('Escrow Address')).toBeNull()
  })

  it('does not claim to have the right address either', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNREADABLE }))
    confirmInfo()

    await screen.findByText(REFUSAL)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('carries the refusal onto the import instructions', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNREADABLE }))
    confirmInfo()
    await screen.findByText(REFUSAL)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    expect(screen.getByText(REFUSAL)).toBeTruthy()
    expect(screen.queryByText(/Below is the address and balance your wallet must show/i)).toBeNull()
  })

  it('does not carry the refusal onto the next file in the same session', async () => {
    loadFile(recoveryJson({ outputDescriptor: UNREADABLE }))
    confirmInfo()
    await screen.findByText(REFUSAL)

    // Same mount throughout, which is the point: the flag is wizard state, so
    // it has to be cleared when the file it describes is replaced. A fresh
    // render would pass whether it is cleared or not.
    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')
    fireEvent.click(screen.getByRole('button', { name: /Start Over/i }))
    expect(screen.queryByText(REFUSAL)).toBeNull()

    pasteFile(recoveryJson())
    confirmInfo()

    expect(await screen.findByText(EXPECTED_ADDRESS)).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
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
      screen.getByRole('button', { name: /View Export Instructions/i }),
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
    expect(alert.textContent).toMatch(/Keep this file and your password/i)
    expect(alert.textContent).toMatch(/open each one here/i)
  })

  /**
   * The referral this used to assert was ruled out by the CEO. Asserted at the
   * screen and not only in the catalogue, because the catalogue is not what a
   * customer reads.
   */
  it('refers the customer to no one', async () => {
    submitPassword()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/professional/i)
    expect(alert.textContent).not.toMatch(/take (them|it) to/i)
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
    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')
  }

  it('tells the Sparrow user to compare the balance and the address', async () => {
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).toMatch(/balance must match the balance shown above/i)
    // Was: toMatch(/first receive address is the escrow address/i). That pinned
    // a claim which is false for every loan after the customer's first. The
    // descriptor handed out is ranged on all three legs, so a wallet lists
    // addresses from index 0 upward, but each loan sits at its own child index
    // under one shared account: a second loan is at index 1, a third at index
    // 2. The position claim is gone and the address is now looked for anywhere
    // in the tab.
    expect(panel?.textContent).toMatch(
      /escrow address shown above must appear in the Addresses tab/i,
    )
    expect(panel?.textContent).not.toMatch(/first receive address/i)
  })

  it('no longer names Nunchuk as the phone option', async () => {
    // Was: it('names Nunchuk for phone users without promising it will work')
    // asserting toMatch(/Nunchuk/) and /expects a different file format/. The
    // sentence named a wallet that cannot open this file and then asked the
    // reader to use a computer anyway, so it did no work the next sentence was
    // not already doing. Searched across the whole guide, not just the Sparrow
    // panel: all three panels stay mounted, so a sentence merely moved to
    // another tab would slip past a panel-scoped check.
    await openGuide()
    expect(document.body.textContent).not.toMatch(/Nunchuk/i)
    expect(document.body.textContent).not.toMatch(/expects a different file format/i)
    // POSITIVE PARTNER. Both negatives alone pass on a panel that failed to
    // render and on an intro paragraph deleted outright.
    expect(document.getElementById('wallet-panel-sparrow')?.textContent).toMatch(
      /does not run on a phone/i,
    )
  })

  it('no longer explains a mismatch as Sparrow having built a different wallet', async () => {
    // Was: it('warns that Sparrow can build a different wallet without saying
    // so') asserting toMatch(/quietly build a different wallet/i). The CEO cut
    // that sentence along with the position claim it backed up, and the two
    // belonged together: the addresses legitimately differ at index 0 for every
    // loan after the customer's first, so a sentence blaming the difference on
    // Sparrow turned a false alarm into a confirmed one.
    await openGuide()
    const panel = document.getElementById('wallet-panel-sparrow')
    expect(panel?.textContent).not.toMatch(/quietly build a different wallet/i)
    // POSITIVE PARTNER. The negative alone passes on an empty panel, on a panel
    // that failed to render, and on a check step deleted outright.
    expect(panel?.textContent).toMatch(
      /escrow address shown above must appear in the Addresses tab/i,
    )
  })

  it('says Sparrow needs a computer, and says only that', async () => {
    // Equality, so the paragraph cannot quietly regrow a sentence. It carried
    // one naming Nunchuk as the phone option, which pointed the reader at a
    // wallet that cannot open this file.
    await openGuide()
    expect(sparrowIntro()).toBe(SPARROW_INTRO)
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
    expect(panel?.textContent).toMatch(/cannot handle the way this wallet is set up/i)
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
    // Was: toContain('deriveaddresses') and nothing at all about its range, so
    // `deriveaddresses "PASTE_HERE" [0,0]` satisfied it. That command derives
    // index 0 only, under a line reading "This must print the same address as
    // the one shown above", and each loan sits at its own child index: a second
    // loan is at index 1. Every customer past their first loan was therefore
    // shown a mismatch, three words before copy telling them to stop and move
    // no Bitcoin. The range is the point of this test now, so it is pinned.
    expect(panel?.textContent).toContain('deriveaddresses "PASTE_HERE" [0,100]')
    expect(panel?.textContent).not.toContain('[0,0]')
    expect(panel?.textContent).toMatch(/prints addresses 0 to 100/i)
    expect(panel?.textContent).toMatch(/escrow address shown above must appear among them/i)
    expect(panel?.textContent).not.toMatch(/must print the same address/i)
    expect(panel?.textContent).toContain('getbalance')
  })

  it('prints exactly the range it scanned, so the two cannot drift apart', async () => {
    // Two commands, one fact. The import decides how far the node scans and the
    // derive decides what the customer is shown to compare against, so an
    // import wider than the print recreates this bug for anyone whose loan sits
    // past the printed window. Read off the screen rather than pinned to a
    // literal, so widening the scan later cannot leave the print behind.
    await openGuide()
    fireEvent.click(screen.getByRole('tab', { name: 'Bitcoin Core' }))
    const text = document.getElementById('wallet-panel-bitcoin-core')?.textContent ?? ''

    const scanned = text.match(/"range":\[0,(\d+)\]/)?.[1]
    const printed = text.match(/deriveaddresses "PASTE_HERE" \[0,(\d+)\]/)?.[1]
    expect(scanned).toBeDefined()
    expect(printed).toBe(scanned)
    // And the copy states that same number, so what the customer is told to
    // expect cannot drift from what the command actually prints either.
    expect(text).toContain(`addresses 0 to ${scanned}`)
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

// ---------------------------------------------------------------------------
// The refusal has to cover SIGNING, not only the address
//
// `childIndices` refuses a child suffix that is not exactly two components, and
// the whole point of that refusal is to stop a signature against the wrong key:
// `psbt-signer.ts` locates the key by the LAST TWO components of the PSBT's
// BIP32 path, so for a leg named `/0/0/1` it would derive and sign at `/0/1`
// instead. That key is not in the witness script this escrow actually uses.
//
// The refusal reaches the wizard as a null address, and a null address stops
// nothing on its own. The customer can still walk action-choice, import-psbt
// and review-psbt with a working xprv in hand, and the sign button at the end
// of that walk is the thing this locks down.
//
// The derivable file is in scope here too, and not incidentally. `supportedJson`
// differs from the refused files in one thing only, which is whether the
// descriptor parses, so it is what turns "the refusal did it" from an
// assumption into a measurement. Several tests below assert on that walk.
// ---------------------------------------------------------------------------

describe('signing for an escrow this tool refuses to derive, against one it can', () => {
  const PASSWORD = 'correct horse battery staple'
  const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const ACCOUNT_PATH = "m/48'/1'/0'/2'"

  let unsupportedJson = ''
  let supportedJson = ''
  /** A file whose descriptor `parseDescriptor` cannot read at all. */
  let unreadableJson = ''
  /** The key the password rebuilds, so a test can look for it on the page. */
  let userXprv = ''
  let signablePsbtBase64 = ''

  /**
   * The PSBT object the wizard is holding, captured as it is parsed.
   *
   * `signPsbtWithXprv` signs in place and hands the same object back, so if the
   * guard ever lets a signature through it lands on this exact instance. The
   * DOM cannot show that: without the guard the wizard also advances, so a test
   * that only checks which screen is showing passes while the escrow is signed
   * against a key that is not in its witness script.
   */
  let importedPsbt: bitcoin.Psbt | null = null

  function signatureCount(psbt: bitcoin.Psbt | null): number {
    if (psbt === null) throw new Error('no PSBT was parsed, so nothing was asserted')
    return psbt.data.inputs.reduce(
      (total, input) => total + (input.partialSig?.length ?? 0),
      0,
    )
  }

  beforeEach(() => {
    importedPsbt = null
    const realFromBase64 = bitcoin.Psbt.fromBase64.bind(bitcoin.Psbt)
    vi.spyOn(bitcoin.Psbt, 'fromBase64').mockImplementation((base64, opts) => {
      const parsed = realFromBase64(base64, opts)
      importedPsbt = parsed
      return parsed
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeAll(async () => {
    const profile = getProfile('pbkdf2-v1')
    if (!profile) throw new Error('pbkdf2-v1 profile is missing')

    const seed = await deriveSeed(PASSWORD, SALT, profile)
    userXprv = deriveXprv(seed, ACCOUNT_PATH, 'testnet')
    const userXpub = neuterXprv(userXprv, 'testnet')
    const fingerprint = computeFingerprint(seed, 'testnet')

    // The customer's own leg names a three component child. Everything else
    // about this file is correct: the password rebuilds the recorded key, so
    // the wizard reaches the action screens with a usable xprv.
    const unsupportedDescriptor =
      `wsh(sortedmulti(2,[${fingerprint}/48'/1'/0'/2']${userXpub}/0/0/1,` +
      `[${fps[0]}/48'/1'/0'/2']${xpubs[0]}/0/*,` +
      `[${fps[2]}/48'/1'/0'/2']${xpubs[2]}/0/*))`

    // The same file with the customer's leg written the way `childIndices`
    // accepts: two components, pinned to the very child the PSBT below names.
    // Everything else is identical, so the only difference between the two
    // walks is whether an escrow address can be derived.
    const supportedDescriptor = unsupportedDescriptor.replace('/0/0/1,', '/0/1,')

    function fileWith(outputDescriptor: string): string {
      return JSON.stringify({
        version: 1,
        network: 'testnet',
        outputDescriptor,
        context: { contractId: 'c', role: 'borrower', threshold: 2, totalKeys: 3 },
        userKey: {
          keySource: 'PASSWORD',
          derivationProfile: 'pbkdf2-v1',
          salt: SALT,
          derivationPath: ACCOUNT_PATH,
          xpub: userXpub,
          fingerprint,
        },
      })
    }

    // The third refusal cause, and the only one that never had a walk. Plain
    // `multi` rather than `sortedmulti`, which `parseDescriptor` refuses
    // outright, so `parsedDescriptor` stays null for the whole session. The
    // customer's leg is untouched, so `replaceKeyByFingerprint` still splices
    // the rebuilt key in and the wizard still reaches the action screens: this
    // is a file that recovers a key and cannot open its escrow.
    const unreadableDescriptor = supportedDescriptor.replace(
      'wsh(sortedmulti(',
      'wsh(multi(',
    )

    unsupportedJson = fileWith(unsupportedDescriptor)
    supportedJson = fileWith(supportedDescriptor)
    unreadableJson = fileWith(unreadableDescriptor)

    // A PSBT built the way every other wallet would build it: pinned at `/0/1`,
    // which is the child the positional signer takes and NOT the child this
    // escrow's leg names. The witness script holds that `/0/1` key, so signing
    // it succeeds if it is ever attempted. That is the failure being prevented.
    const userChild = bip32.fromBase58(userXprv, NET).derive(0).derive(1)
    const coSigners = [master.derive(0), master.derive(2)].map((node) =>
      Buffer.from(node.derive(0).derive(1).publicKey),
    )
    const pubkeys = [Buffer.from(userChild.publicKey), ...coSigners].sort(Buffer.compare)
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network: NET })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })

    const psbt = new bitcoin.Psbt({ network: NET })
    psbt.addInput({
      hash: 'a'.repeat(64),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: 150_000n },
      witnessScript: p2ms.output!,
      bip32Derivation: [
        {
          masterFingerprint: Buffer.from(fingerprint, 'hex'),
          pubkey: Buffer.from(userChild.publicKey),
          path: `${ACCOUNT_PATH}/0/1`,
        },
      ],
    })
    psbt.addOutput({ address: p2wsh.address!, value: 100_000n })
    signablePsbtBase64 = psbt.toBase64()
  }, 30_000)

  /** Password, then the walk a customer takes to reach the sign button. */
  async function reachTheSignButton(json: string = unsupportedJson) {
    loadFile(json)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))

    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Sign Existing PSBT/i }))
    fireEvent.change(screen.getByPlaceholderText(/cHNidP8BAH/), {
      target: { value: signablePsbtBase64 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Import from Paste/i }))
    await screen.findByText('Review Imported PSBT')
  }

  it('lets the customer walk all the way to the sign button', async () => {
    await reachTheSignButton()
    expect(screen.getByRole('button', { name: /Add Your Signature/i })).toBeTruthy()
  })

  it('refuses to sign when the escrow address could not be derived', async () => {
    await reachTheSignButton()
    expect(signatureCount(importedPsbt)).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /Add Your Signature/i }))

    // The assertion that is about the money. The witness script in this PSBT
    // holds the `/0/1` key the positional signer reaches for, so an unguarded
    // click succeeds and leaves a real signature on this object. Asserting the
    // screen alone would pass for a refactor that signs and then fails to
    // advance, which is the worse of the two failures.
    expect(signatureCount(importedPsbt)).toBe(0)

    // Still on the review screen. Without the guard the wizard moves on to
    // sign-finalize.
    expect(screen.getByText('Review Imported PSBT')).toBeTruthy()
  })

  it('says why the sign button did nothing, where the customer is still standing', async () => {
    await reachTheSignButton()

    fireEvent.click(screen.getByRole('button', { name: /Add Your Signature/i }))

    // The refusal renders at card level on EVERY step, sign-finalize included,
    // so finding it on screen proves nothing on its own. What has to be true is
    // that it is next to the button that just did nothing.
    expect(screen.getByText('Review Imported PSBT')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add Your Signature/i })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(REFUSAL)
  })

  /** The walk to `action-choice`, the Choose screen, which now shows a balance. */
  async function reachChooseScreen(json: string = unsupportedJson) {
    loadFile(json)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }))
  }

  /** The walk on to `wallet-view`, which is Path A's first screen. */
  async function reachWalletView(json: string = unsupportedJson) {
    await reachChooseScreen(json)
    fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))
  }

  it('does not turn the refusal into a failure report on the screen that would spend', async () => {
    // `wallet-view` renders on `parsedDescriptor` alone, so a refusal reaches
    // it, `loadWallet` throws again on mount, and the screen used to fill with
    // a red "Failed to Load Wallet" box sitting directly under the calm alert.
    // Its Retry repeats a derivation that is exact and refuses every time, so
    // the one action offered to a frightened customer could never work.
    //
    // Checked on the Choose screen FIRST, and that half is not decoration. This
    // block was written when only `wallet-view` fetched a balance. The Choose
    // screen now does too, and reinstating the original defect at that new
    // location left all three of these tests green, because none of them had
    // ever looked at the screen the customer sees on the way.
    await reachChooseScreen()

    expect(screen.queryByText(/Failed to Load Wallet/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))

    expect(screen.queryByText(/Failed to Load Wallet/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull()
  })

  it('does not tell them to fund an address it has just refused to show', async () => {
    // The worst line on the page, and the reason this is not cosmetic: below
    // the failure box the screen said "No spendable balance. Send Bitcoin to
    // your escrow address first." to a customer holding no address.
    //
    // The Choose screen now carries its own zero-balance line, so it can tell
    // the same lie one screen earlier. It must not: with no address there is
    // no balance to report, empty or otherwise.
    await reachChooseScreen()

    expect(screen.queryByText(/Send Bitcoin to your escrow address/i)).toBeNull()
    expect(screen.queryByText(/No spendable balance/i)).toBeNull()
    expect(screen.queryByText(/Escrow Balance/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))

    expect(screen.queryByText(/Send Bitcoin to your escrow address/i)).toBeNull()
    expect(screen.queryByText(/No spendable balance/i)).toBeNull()
  })

  it('gives one calm account of the refusal there, and only one', async () => {
    // Two accounts of one fact read as two problems. The wizard's own notice
    // is the account, and the step adds nothing to it.
    await reachWalletView()

    expect(screen.getAllByText(REFUSAL).length).toBe(1)
    expect(screen.getByRole('alert').textContent).toMatch(REFUSAL)

    // And no technical wording reached the customer along the way.
    const card = document.querySelector('div.glass-card') ?? document.body
    expect(card.textContent).not.toMatch(/fingerprint/i)
    expect(card.textContent).not.toMatch(/address layout/i)
    expect(card.textContent).not.toMatch(/an address that might be wrong/i)
  })

  it('leaves the customer a way off that screen', async () => {
    await reachWalletView()
    expect(screen.getByRole('button', { name: /^Back$/i })).toBeTruthy()
  })

  /**
   * The same screen, reached by the refusal cause that used to strand people.
   *
   * A descriptor `parseDescriptor` cannot read leaves `parsedDescriptor` null,
   * and `wallet-view` used to require it. Create Transaction therefore moved
   * the wizard to a step that rendered nothing: the customer was left holding
   * the refusal notice, a step indicator, and not one button in either
   * direction. This walk is the route they actually take to get there.
   */
  it('does not strand the customer when the descriptor cannot be read at all', async () => {
    await reachWalletView(unreadableJson)

    // The refusal is on screen, which is what makes the missing exit so bad.
    expect(screen.getByRole('alert').textContent).toMatch(REFUSAL)

    // And there is a way out of it.
    const back = screen.getByRole('button', { name: /^Back$/i })
    fireEvent.click(back)
    expect(screen.getByText(/Key Recovered Successfully/i)).toBeTruthy()
  })

  it('gives that customer the calm screen too, not a failure report', async () => {
    // The unreadable descriptor now reaches the same branch as the other
    // refusal, so it must reach the same treatment: no red failure box, no
    // Retry that cannot work, and no instruction to fund an unshown address.
    // On the Choose screen on the way there as well as on `wallet-view`.
    await reachChooseScreen(unreadableJson)

    expect(screen.queryByText(/Failed to Load Wallet/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull()
    expect(screen.queryByText(/Escrow Balance/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))

    expect(screen.queryByText(/Failed to Load Wallet/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull()
    expect(screen.queryByText(/Send Bitcoin to your escrow address/i)).toBeNull()
  })

  /**
   * The refusal copy itself, pinned to the words that were approved.
   *
   * Written out here rather than compared against the constant it renders
   * from. A test that imports `ESCROW_UNSUPPORTED` proves the notice and the
   * error agree, which is worth having, but it agrees just as happily with
   * wording nobody approved. This is the assertion that fails if the sentence
   * changes.
   */
  it('reads exactly the way the refusal was approved to read', async () => {
    await reachWalletView()

    expect(screen.getByRole('alert').textContent).toBe(
      'This page cannot open this escrow. Your recovery file was set up in a ' +
        'way this page does not handle, so it will not show you an address. ' +
        'Your Bitcoin has not moved and your key is still yours.',
    )
  })

  it('says the same thing when it throws as when it renders', async () => {
    // The other half. The notice above is one of two places this copy reaches
    // a customer; `useWalletState` renders a thrown `userMessage` verbatim.
    // Sourcing both from one constant is the fix, and this is what holds it.
    await reachWalletView()

    expect(screen.getByRole('alert').textContent).toBe(ESCROW_UNSUPPORTED)
  })

  /**
   * The live defect, walked the way the customer walks it.
   *
   * Password recovery succeeds, so the rebuilt `xprv` is spliced into the
   * descriptor and printed in full. The descriptor then fails to parse, which
   * leaves `parsedDescriptor` null, and the warning used to be gated on that:
   * the one screen a customer reaches after something has already gone wrong
   * was the one screen that showed their private key with nothing beside it
   * saying what it was. A screenshot of that screen sent to a stranger
   * offering help is their Bitcoin gone.
   *
   * Asserted on both screens that print it, and each assertion is made only
   * after checking the key really is on that screen, so this cannot quietly
   * become a test that passes because nothing was rendered.
   */
  it('warns the customer their key is on screen even when the escrow cannot be read', async () => {
    loadFile(unreadableJson)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
    await screen.findByRole('button', { name: /^Continue$/i })

    // The result screen.
    expect(document.body.textContent).toContain(userXprv)
    expect(screen.getAllByText(/Keep this secret/i).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Export Your Signing File Instead/i }))
    await screen.findByRole('tablist')

    // The guide screen, which is where it was missing.
    expect(document.body.textContent).toContain(userXprv)
    expect(screen.getAllByText(/Keep this secret/i).length).toBeGreaterThan(0)

    // And the same wrong gate governed this line, so it is pinned here too.
    // Equality, not a substring: the whole step is compared, so a reappearing
    // "To move funds, use the Send tab." opening fails it rather than hiding
    // behind a passing search for the rest of the sentence.
    //
    // This fixture cannot derive an escrow, so it is the variant that must not
    // offer this page's own Create Transaction. The named absence below is
    // implied by the equality, and is kept because it is the specific
    // regression: the screen would be sending the customer to a control that
    // `WalletViewStep` does not render on a refusal.
    expect(sparrowLastStep()).toBe(PASSWORD_LAST_STEP_NO_ESCROW)
    expect(sparrowLastStep()).not.toMatch(/Create Transaction/)
  })

  it('does offer Create Transaction to a password customer whose escrow it can derive', async () => {
    // The partner to the assertion above, and the reason it is not simply the
    // sentence being deleted. `supportedJson` differs from `unreadableJson` in
    // one thing only, which is whether the descriptor parses, so the pair
    // isolates the gate rather than the copy.
    await reachChooseScreen(supportedJson)
    fireEvent.click(screen.getByRole('button', { name: /Export Your Signing File Instead/i }))
    await screen.findByRole('tablist')

    expect(sparrowLastStep()).toBe(PASSWORD_LAST_STEP)
  })

  /**
   * The wiring, walked rather than assumed.
   *
   * The component decides both claims from a `keySource` prop, and every test
   * of that is a unit test that hands it the value directly. What none of them
   * can catch is the wizard passing the wrong thing: a stale boolean, the
   * descriptor, an empty string. Two routes reach this screen and they read
   * different state, so both are walked.
   */
  it('names the signing file on the route a password customer walks', async () => {
    loadFile(unsupportedJson)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Export Your Signing File Instead/i }))
    await screen.findByRole('tablist')

    expect(document.body.textContent).toMatch(/Signing File/)
    expect(document.body.textContent).not.toMatch(/Escrow File/)
  })

  it('says escrow file, and never signing file, on the route a device customer walks', async () => {
    loadFile(recoveryJson({ keySource: 'COLD_CARD' }))
    confirmInfo()
    fireEvent.click(await screen.findByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    expect(document.body.textContent).toMatch(/Escrow File/)
    expect(document.body.textContent).not.toMatch(/Signing File/)
    expect(document.getElementById('wallet-panel-sparrow')?.textContent).toMatch(
      /Connect your hardware wallet/i,
    )
  })

  it('keeps the import instructions clean on the other route to them', async () => {
    // The guide is reachable twice over: from the device screen, covered
    // above, and from action-choice after a password recovery. Both land on
    // the same component, but only one of them was ever walked in a test.
    loadFile(unsupportedJson)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Export Your Signing File Instead/i }))
    await screen.findByRole('tablist')

    for (const tab of ['Sparrow', 'Specter', 'Bitcoin Core']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      const id = `wallet-panel-${tab.replace(/\s+/g, '-').toLowerCase()}`
      const text = document.getElementById(id)?.textContent ?? ''
      expect(text).not.toMatch(/shown above/i)
      expect(text).not.toMatch(/balance above/i)
      expect(text).toMatch(/no address and no balance for you to compare against/i)
    }
  })

  it('still shows the balance on the Choose screen for an escrow it can derive', async () => {
    // The positive partner for the three `queryByText(/Escrow Balance/i)`
    // absence checks above. Without it they all pass for a Choose screen that
    // shows nobody a balance, which is the state this change exists to end.
    await reachChooseScreen(supportedJson)

    expect(await screen.findByText('Escrow Balance')).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('says Unknown on the Choose screen until the fetch has actually come back', async () => {
    // The wizard half of the guard, and the half no component test can hold.
    // `ActionChoiceStep` cannot tell "asked, and there is nothing there" from
    // "nobody has asked yet": at mount `balance` is 0, `isLoadingBalance` is
    // false and `balanceError` is null, which is exactly an empty escrow. The
    // wizard is what supplies the difference, so a `balanceChecked` wired to a
    // constant passes every test in `ActionChoiceStep.test.tsx` while this
    // screen goes on reporting the initial 0 as an empty escrow.
    //
    // Read immediately, with real timers. The fetch is debounced, so at this
    // point nothing has been asked on ANY network, testnet here included.
    await reachChooseScreen(supportedJson)

    // Scoped to the row the "Escrow Balance" label sits in. This screen can
    // carry a second live region, the pinned-escrow notice, and it comes first
    // in the document. Both queries throw rather than return nothing, so a
    // screen that stopped rendering the balance at all fails here.
    //
    // `closest`, because the live region is the row: it has to announce the
    // label as well as the value, or a screen reader user hears a bare number
    // with nothing saying what it is. A region wrapping the value alone is not
    // reachable from the label and fails here.
    const line = () => {
      const label = screen.getByText('Escrow Balance')
      const status = label.closest('[role="status"]')
      if (!status) throw new Error('the Choose screen renders no balance live region')
      return status.textContent ?? ''
    }

    expect(line()).toMatch(/Unknown/i)
    expect(line()).not.toMatch(/0\.00000000/)
    expect(line()).not.toMatch(/No spendable balance/i)

    // The positive partner. Unknown is a stage, not the end state: the same
    // line carries the real balance once the fetch returns, so a screen stuck
    // on Unknown forever fails here.
    await waitFor(() => expect(line()).toMatch(/0\.00225000 BTC/))
  })

  it('still shows the balance and the spend button for an escrow it can derive', async () => {
    // Without this the block above passes for a step that renders nothing for
    // anybody, which would break Path A for every customer whose file is fine.
    await reachWalletView(supportedJson)

    expect(await screen.findByText('Total Balance')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Create Transaction$/i })).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('signs the same PSBT once the escrow address can be derived', async () => {
    // The other half of the guard. Without this the block passes for a wizard
    // that never signs anything at all, which is not the behaviour being
    // locked down: the refusal has to be about THIS escrow.
    await reachTheSignButton(supportedJson)
    expect(signatureCount(importedPsbt)).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /Add Your Signature/i }))

    expect(signatureCount(importedPsbt)).toBe(1)
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('carries the refusal across every screen on the way to it', async () => {
    loadFile(unsupportedJson)
    confirmInfo()
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))

    // result
    expect(await screen.findByText(REFUSAL)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }))
    // action-choice, which must not offer an empty address to copy either
    expect(screen.getByText(REFUSAL)).toBeTruthy()
    expect(screen.queryByText(/Escrow Address \(/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Sign Existing PSBT/i }))
    // import-psbt
    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// The step indicator on the export guide
// ---------------------------------------------------------------------------

/**
 * The guide path's labels are the six shared ones plus 'Export', so the guide
 * is step SEVEN. Numbered six, the chip that lit up was 'Choose', the step the
 * customer had already left, and 'Export' sat there as a future step nobody had
 * reached. The chips carry that in their aria-label as well as their colour, so
 * a screen reader user was told the same wrong thing.
 */
describe('the step indicator on the export guide', () => {
  it('marks Export as the step being shown', async () => {
    loadFile(recoveryJson({ keySource: 'COLD_CARD' }))
    confirmInfo()
    fireEvent.click(await screen.findByRole('button', { name: /View Export Instructions/i }))

    expect(screen.getByLabelText('Step 7: Export (current)')).toBeTruthy()
    expect(screen.queryByLabelText('Step 7: Export')).toBeNull()
  })

  it('marks Choose as a step already behind them', async () => {
    loadFile(recoveryJson({ keySource: 'COLD_CARD' }))
    confirmInfo()
    fireEvent.click(await screen.findByRole('button', { name: /View Export Instructions/i }))

    expect(screen.getByLabelText('Step 6: Choose (completed)')).toBeTruthy()
    expect(screen.queryByLabelText('Step 6: Choose (current)')).toBeNull()
  })

  it('does not drag the rest of the walk along with it', async () => {
    // The positive partner for the change above. Moving the guide to seven must
    // not drag the screen that really is step six along with it.
    // Moving the guide to seven must move only the guide. The screen before
    // it is still step three, on a walk of six that has no Export chip at all.
    loadFile(recoveryJson({ keySource: 'COLD_CARD' }))
    confirmInfo()

    expect(await screen.findByLabelText('Step 3: Authenticate (current)')).toBeTruthy()
    expect(screen.queryByLabelText(/Export/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The device name on the hardware step
// ---------------------------------------------------------------------------

/**
 * The heading on that screen already reads "Hardware Wallet Key". Underneath it
 * the tool printed the key source in words, and for every escrow created now
 * that is the generic "Hardware wallet", which is the heading over again. The
 * device name is shown when the file records one and nothing is shown when it
 * does not. No new fact about the customer's wallet is recorded or inferred to
 * make that decision.
 */
describe('the device name on the hardware step', () => {
  const named: Array<[string, string]> = [
    ['COLD_CARD', 'Coldcard hardware wallet'],
    ['LEDGER', 'Ledger hardware wallet'],
    ['TREZOR', 'Trezor hardware wallet'],
  ]

  for (const [keySource, deviceName] of named) {
    it(`names the device for "${keySource}", which the file records`, async () => {
      loadFile(recoveryJson({ keySource }))
      confirmInfo()

      expect(await screen.findByRole('heading', { name: 'Hardware Wallet Key' })).toBeTruthy()
      expect(screen.getByText(deviceName)).toBeTruthy()
    })
  }

  for (const keySource of ['OTHER', 'BITBOX02']) {
    it(`says nothing beyond the heading for "${keySource}", which names no device`, async () => {
      loadFile(recoveryJson({ keySource }))
      confirmInfo()

      // The positive partner. The screen has to be the one under test, and it
      // has to have rendered, or "the words are absent" is absent for the
      // wrong reason.
      expect(await screen.findByRole('heading', { name: 'Hardware Wallet Key' })).toBeTruthy()
      expect(await screen.findByText(EXPECTED_ADDRESS)).toBeTruthy()

      expect(screen.queryByText('Hardware wallet')).toBeNull()
    })
  }

  it('keeps naming a Coldcard, which two live escrows still use', async () => {
    loadFile(recoveryJson({ keySource: 'COLD_CARD' }))
    confirmInfo()
    expect(await screen.findByText('Coldcard hardware wallet')).toBeTruthy()
  })
})
