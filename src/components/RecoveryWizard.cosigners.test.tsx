/**
 * The wizard reading the cosigner positions the platform records.
 *
 * The crypto suite proves the resolution rules. This proves the wizard is
 * wired to them: that the address on screen is the escrow's address, that the
 * balance is fetched for THAT address and not another, and that a file whose
 * recorded address disagrees with what this page derives is refused rather
 * than displayed.
 *
 * Everything is real except the network. The descriptor, the keys, the
 * addresses and the derivation all run for real, and the fetch stub records
 * which address it was asked about so a balance shown for the wrong wallet
 * cannot pass.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { RecoveryWizard } from './RecoveryWizard'
import { bitcoin, ecc } from '@/crypto/bitcoin-lib'
import { parseDescriptor } from '@/crypto/descriptor-parser'
import { deriveMultisigAddress } from '@/crypto/address'
import { resolveCosignerPositions } from '@/crypto/child-derivation'
import { deriveSeed, computeFingerprint, deriveXprv, neuterXprv } from '@/crypto/derivation'
import { getProfile } from '@/crypto/profiles'
import type { RecoveryFileCosigner } from '@/crypto/recovery-file'
import {
  BORROWER_FINGERPRINT,
  LENDER_FINGERPRINT,
  PLATFORM_FINGERPRINT,
  LEGS,
  MISMATCHED_CHILD_DESCRIPTOR,
  RANGED_EQUIVALENT_DESCRIPTOR,
} from '@/crypto/__fixtures__/fixed-child'

// bitcoinjs-lib and bip32 expect a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const REFUSAL = /This page cannot open this escrow/i
/** `DerivationNotice`: this escrow is one other wallet apps will disagree with. */
const NOTICE = /Your Bitcoin is safe and this page has the right address for it/i
const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

/** Where the money is: the descriptor that states every position explicitly. */
const ESCROW_ADDRESS = deriveMultisigAddress(
  parseDescriptor(MISMATCHED_CHILD_DESCRIPTOR),
  0,
  'testnet',
).address

/** The wallet the tool used to land on: every leg read as ranged, at index 0. */
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

const UTXOS = [{ txid: 'a'.repeat(64), vout: 0, value: 150_000, status: { confirmed: true } }]

let fetchedUrls: string[] = []

function stubFetch() {
  fetchedUrls = []
  vi.stubGlobal(
    'fetch',
    // Observes what it is handed. A stub that answered the same way whatever
    // address it was given would let a balance for the wrong wallet pass.
    vi.fn(async (url: string) => {
      fetchedUrls.push(String(url))
      const body = String(url).includes('/v1/fees/recommended')
        ? { fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }
        : UTXOS
      return { ok: true, json: async () => body } as unknown as Response
    }),
  )
}

function fileJson(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    network: 'testnet',
    outputDescriptor: RANGED_EQUIVALENT_DESCRIPTOR,
    context: { contractId: 'c', role: 'borrower', threshold: 2, totalKeys: 3 },
    userKey: {
      keySource: 'COLD_CARD',
      derivationPath: "m/48'/1'/0'/2'",
      xpub: 'tpubunused',
      fingerprint: BORROWER_FINGERPRINT.toUpperCase(),
    },
    ...overrides,
  })
}

/** Upload a file and walk on to the screen that shows the escrow address. */
function reachHardwareStep(json: string) {
  render(<RecoveryWizard />)
  fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
  fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
    target: { value: json },
  })
  fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
  fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
}

beforeEach(stubFetch)
afterEach(() => vi.unstubAllGlobals())

describe('an escrow whose legs sit at different positions', () => {
  const json = fileJson({ escrowAddress: ESCROW_ADDRESS, cosigners: POSITIONS })

  it('is a file the ranged reading gets wrong', () => {
    // Guards the fixture. If these two ever became the same address the whole
    // block would pass while proving nothing at all.
    expect(WRONG_ADDRESS).not.toBe(ESCROW_ADDRESS)
  })

  it('shows the escrow address, not the one every leg at index 0 gives', async () => {
    reachHardwareStep(json)

    expect(await screen.findByText(ESCROW_ADDRESS)).toBeTruthy()
    expect(screen.queryByText(WRONG_ADDRESS)).toBeNull()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('fetches the balance for the escrow address and for no other', async () => {
    reachHardwareStep(json)
    await screen.findByText(ESCROW_ADDRESS)

    await waitFor(() => {
      expect(fetchedUrls.some((url) => url.includes(ESCROW_ADDRESS))).toBe(true)
    })
    expect(fetchedUrls.some((url) => url.includes(WRONG_ADDRESS))).toBe(false)
  })
})

describe('a file whose recorded address disagrees with what this page derives', () => {
  // The positions are missing, so the tool reads every leg as ranged and lands
  // on the wrong wallet. The recorded address is the only thing that can catch
  // that, and this is what it has to do about it.
  const json = fileJson({ escrowAddress: ESCROW_ADDRESS })

  it('refuses instead of showing the address it derived', async () => {
    reachHardwareStep(json)

    expect(await screen.findByText(REFUSAL)).toBeTruthy()
    expect(screen.queryByText(WRONG_ADDRESS)).toBeNull()
    expect(screen.queryByText(ESCROW_ADDRESS)).toBeNull()
  })

  it('asks the blockchain nothing about a wallet it has refused', async () => {
    reachHardwareStep(json)
    await screen.findByText(REFUSAL)

    // Nothing at all, not merely nothing about the wrong address. The summary
    // that would load a balance is gated on there being an address to load one
    // for, so on a refusal no request of any kind is made.
    expect(fetchedUrls).toHaveLength(0)
  })
})

describe('a file that records no address', () => {
  // What every customer holds today. There is nothing to check against, so the
  // check is removed rather than passed, and the tool behaves as it always has.
  const json = fileJson({})

  it('still shows the address it derives', async () => {
    reachHardwareStep(json)

    expect(await screen.findByText(WRONG_ADDRESS)).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })
})

describe('an ordinary escrow with every leg at zero', () => {
  const allZero: RecoveryFileCosigner[] = POSITIONS.map((cosigner) => ({
    ...cosigner,
    keyIndex: 0,
  }))
  const address = deriveMultisigAddress(
    parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
    0,
    'testnet',
  ).address

  it('is unchanged by positions that place every leg where it already was', async () => {
    reachHardwareStep(fileJson({ escrowAddress: address, cosigners: allZero }))

    expect(await screen.findByText(address)).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('is not announced as a shape other wallet apps will disagree with', async () => {
    // The regression guard. Resolution rewrites `0/*` to `0/0` on every leg, so
    // a predicate measured on the RESOLVED descriptor calls this escrow non
    // standard. The backend records `keyIndex: 0` on all three legs for every
    // ordinary escrow, so that is the whole default population being told other
    // wallet apps will show a different address or a zero balance, which is
    // false: the string it hands them is still ranged on every leg.
    reachHardwareStep(fileJson({ escrowAddress: address, cosigners: allZero }))

    await screen.findByText(address)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('still tells the customer to stop and ask if their wallet shows something else', async () => {
    // The half that is about the money. Predicting a difference switches the
    // guide's advice from "stop and contact BTCBacked support" to "this wallet
    // cannot open your escrow. Nothing is wrong with your funds", so the one
    // instruction that catches a genuinely botched import is turned off for the
    // whole default population, and a customer whose import really did fail is
    // told nothing is wrong.
    reachHardwareStep(fileJson({ escrowAddress: address, cosigners: allZero }))
    await screen.findByText(address)

    fireEvent.click(screen.getByRole('button', { name: /View Export Instructions/i }))
    await screen.findByRole('tablist')

    const card = screen.getByRole('tablist').parentElement
    expect(card?.textContent).toMatch(/contact BTCBacked support/i)
    expect(card?.textContent).not.toMatch(/this wallet cannot open your escrow/i)
  })
})

describe('a second file loaded over a first', () => {
  it('is not judged against the descriptor the first one left behind', async () => {
    // `parsedDescriptor` belongs to the file it was parsed from. Carried across
    // an upload it is compared against the NEW file's recorded escrow address,
    // which is one escrow's descriptor judged against another escrow's address:
    // a mismatch between two unrelated files, and the refusal on screen for a
    // file that is perfectly fine.
    const ordinary = deriveMultisigAddress(
      parseDescriptor(RANGED_EQUIVALENT_DESCRIPTOR),
      0,
      'testnet',
    ).address
    const second = fileJson({
      escrowAddress: ordinary,
      cosigners: POSITIONS.map((cosigner) => ({ ...cosigner, keyIndex: 0 })),
    })

    function loadFile(json: string) {
      fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
      fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
        target: { value: json },
      })
      fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
    }

    render(<RecoveryWizard />)
    loadFile(fileJson({ escrowAddress: ESCROW_ADDRESS, cosigners: POSITIONS }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await screen.findByText(ESCROW_ADDRESS)

    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Upload a different file/i }))
    loadFile(second)

    expect(screen.queryByText(REFUSAL)).toBeNull()

    // And the second file goes on to derive its own address, not the first's.
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    expect(await screen.findByText(ordinary)).toBeTruthy()
    expect(screen.queryByText(ESCROW_ADDRESS)).toBeNull()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The password path
//
// The two paths parse a descriptor in two different places, and the password
// path parses the REBUILT one, which carries the customer's private key. That
// is the path where a wrong position does not just show a wrong balance, it
// signs with a key that is not in the witness script. It had no test.
// ---------------------------------------------------------------------------

describe('a password customer whose leg sits away from zero', () => {
  const PASSWORD = 'correct horse battery staple'
  const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const ACCOUNT_PATH = "m/48'/1'/0'/2'"

  let json = ''
  /** The same file with the positions stripped, so the escrow will not resolve. */
  let mismatchJson = ''
  let escrowAddress = ''
  let rangedAddress = ''
  /**
   * A genuine spend of the real escrow, built at the positions the file
   * records, exactly as a counterparty's wallet would send it.
   *
   * Its witness script holds the customer's `/0/1` key, which is the child the
   * positional signer reaches for, so an unguarded click leaves a real
   * signature on it. That is what the refusal has to prevent.
   */
  let signablePsbtBase64 = ''

  /**
   * The PSBT the wizard is holding, captured as it is parsed.
   *
   * `signPsbtWithXprv` signs in place and returns the same object, so a
   * signature that slips past the guard lands on this instance. The DOM cannot
   * show that: without the guard the wizard also advances, so a test that only
   * checks which screen is showing passes while the escrow is signed.
   */
  let importedPsbt: bitcoin.Psbt | null = null

  function signatureCount(psbt: bitcoin.Psbt | null): number {
    if (psbt === null) throw new Error('no PSBT was parsed, so nothing was asserted')
    return psbt.data.inputs.reduce((total, input) => total + (input.partialSig?.length ?? 0), 0)
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

  afterEach(() => vi.restoreAllMocks())

  beforeAll(async () => {
    const profile = getProfile('pbkdf2-v1')
    if (!profile) throw new Error('pbkdf2-v1 profile is missing')

    const seed = await deriveSeed(PASSWORD, SALT, profile)
    const userXprv = deriveXprv(seed, ACCOUNT_PATH, 'testnet')
    const userXpub = neuterXprv(userXprv, 'testnet')
    const fingerprint = computeFingerprint(seed, 'testnet')

    const lender = LEGS.find((leg) => leg.fingerprint === LENDER_FINGERPRINT)!
    const platform = LEGS.find((leg) => leg.fingerprint === PLATFORM_FINGERPRINT)!

    // Every leg ranged, which is what the platform writes for every escrow.
    const descriptor =
      `wsh(sortedmulti(2,[${fingerprint}/48'/1'/0'/2']${userXpub}/0/*,` +
      `[${lender.fingerprint}/48'/1'/0'/2']${lender.node.neutered().toBase58()}/0/*,` +
      `[${platform.fingerprint}/88'/1'/0'/0']${platform.node.neutered().toBase58()}/0/*))`

    const cosigners: RecoveryFileCosigner[] = [
      { role: 'borrower', fingerprint: fingerprint.toLowerCase(), keyIndex: 1 },
      { role: 'lender', fingerprint: LENDER_FINGERPRINT, keyIndex: 2 },
      { role: 'platform', fingerprint: PLATFORM_FINGERPRINT, keyIndex: 0 },
    ]

    const parsed = parseDescriptor(descriptor)
    rangedAddress = deriveMultisigAddress(parsed, 0, 'testnet').address
    escrowAddress = deriveMultisigAddress(
      resolveCosignerPositions(parsed, cosigners),
      0,
      'testnet',
    ).address

    json = JSON.stringify({
      version: 1,
      network: 'testnet',
      outputDescriptor: descriptor,
      escrowAddress,
      cosigners,
      context: { contractId: 'c', role: 'borrower', threshold: 2, totalKeys: 3 },
      userKey: {
        keySource: 'PASSWORD',
        derivationProfile: 'pbkdf2-v1',
        salt: SALT,
        derivationPath: ACCOUNT_PATH,
        xpub: userXpub,
        // Uppercase, as every file the platform writes has it, and never
        // comparable to the lowercase fingerprints in `cosigners`.
        fingerprint,
      },
    })

    // The same file with the positions gone, which is every file a customer
    // holds today. The rebuilt descriptor then reads as ranged and lands on the
    // wrong wallet, and the recorded address is the only thing that catches it.
    const { cosigners: _dropped, ...withoutPositions } = JSON.parse(json) as Record<
      string,
      unknown
    >
    mismatchJson = JSON.stringify(withoutPositions)

    // A real spend of the real escrow: every leg at the child the file records.
    const userChildPubkey = Buffer.from(
      bip32.fromBase58(userXprv, NET).derive(0).derive(1).publicKey,
    )
    const pubkeys = [
      userChildPubkey,
      Buffer.from(lender.node.derive(0).derive(2).publicKey),
      Buffer.from(platform.node.derive(0).derive(0).publicKey),
    ].sort(Buffer.compare)
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network: NET })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })

    // The fixture has to be the escrow itself, or the refusal below is being
    // asserted against a PSBT for some other wallet and proves nothing.
    expect(p2wsh.address).toBe(escrowAddress)

    const psbt = new bitcoin.Psbt({ network: NET })
    psbt.addInput({
      hash: 'a'.repeat(64),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: 150_000n },
      witnessScript: p2ms.output!,
      bip32Derivation: [
        {
          masterFingerprint: Buffer.from(fingerprint, 'hex'),
          pubkey: userChildPubkey,
          path: `${ACCOUNT_PATH}/0/1`,
        },
      ],
    })
    psbt.addOutput({ address: p2wsh.address!, value: 100_000n })
    signablePsbtBase64 = psbt.toBase64()
  }, 30_000)

  /** Password, then the screen that hands back the rebuilt key. */
  async function reachResult(fileJson: string = json) {
    render(<RecoveryWizard />)
    fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
    fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
      target: { value: fileJson },
    })
    fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
      target: { value: PASSWORD },
    })
    fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
    await screen.findByRole('button', { name: /^Continue$/i })
  }

  it('is a file the ranged reading gets wrong', () => {
    expect(rangedAddress).not.toBe(escrowAddress)
  })

  it('resolves the positions onto the rebuilt descriptor, not just the file one', async () => {
    await reachResult()
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }))

    expect(screen.getByText(escrowAddress)).toBeTruthy()
    expect(screen.queryByText(rangedAddress)).toBeNull()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('is refused, not shown, when the same walk cannot reach the recorded address', async () => {
    await reachResult(mismatchJson)

    expect(screen.getByText(REFUSAL)).toBeTruthy()
    expect(screen.queryByText(rangedAddress)).toBeNull()
    expect(screen.queryByText(escrowAddress)).toBeNull()
  })

  // -------------------------------------------------------------------------
  // The sign button under the fourth refusal cause
  //
  // The guards are shared with the three older causes, but nothing drove one
  // under a mismatch. This is the doomsday tool and a dead sign button is the
  // whole point of the refusal, so the button is clicked for real and the
  // assertion is on the PSBT, not on the screen.
  // -------------------------------------------------------------------------

  /** Password, then the walk a customer takes to reach the sign button. */
  async function reachTheSignButton(fileJson: string) {
    await reachResult(fileJson)
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Sign Existing PSBT/i }))
    fireEvent.change(screen.getByPlaceholderText(/cHNidP8BAH/), {
      target: { value: signablePsbtBase64 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Import from Paste/i }))
    await screen.findByText('Review Imported PSBT')
  }

  it('lets the customer walk all the way to the sign button on a mismatch', async () => {
    await reachTheSignButton(mismatchJson)

    expect(screen.getByRole('button', { name: /Add Your Signature/i })).toBeTruthy()
    expect(signatureCount(importedPsbt)).toBe(0)
  })

  it('does not sign an escrow whose address it could not corroborate', async () => {
    await reachTheSignButton(mismatchJson)

    fireEvent.click(screen.getByRole('button', { name: /Add Your Signature/i }))

    // The assertion that is about the money. This PSBT is a genuine spend of
    // the real escrow and its witness script holds the key the positional
    // signer reaches for, so an unguarded click succeeds and leaves a real
    // signature on this object. Asserting the screen alone would pass for a
    // refactor that signs and then fails to advance.
    expect(signatureCount(importedPsbt)).toBe(0)
    // Still on the review screen, with the refusal beside the button that just
    // did nothing.
    expect(screen.getByText('Review Imported PSBT')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(REFUSAL)
  })

  it('signs the same PSBT once the file states where the legs are', async () => {
    // The other half, and what stops the test above from passing for a wizard
    // that never signs anything. Same PSBT, same key, same walk; the only
    // difference is that this file carries the positions, so the address
    // corroborates and the guard opens.
    await reachTheSignButton(json)

    fireEvent.click(screen.getByRole('button', { name: /Add Your Signature/i }))

    expect(signatureCount(importedPsbt)).toBe(1)
  })
})
