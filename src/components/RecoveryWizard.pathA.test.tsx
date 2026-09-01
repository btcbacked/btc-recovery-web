/**
 * Path A signing: the transaction this page builds and signs itself.
 *
 * `handleSign_PathA` carries the same refusal as `handleSign_PathB` and had no
 * test of any kind. Both halves of it were free to move: the guard could be
 * deleted in a type clean way (`escrowAddressObj?.address ?? ''`) and the
 * escrow address handed to the signer could be replaced with a hardcoded
 * string, and the whole suite stayed green. Path B was pinned twice over. The
 * asymmetry is the defect these tests close.
 *
 * Everything here is real: a real seed run through the real password profile, a
 * real xprv, a real descriptor and a PSBT whose witness script holds the key
 * that is about to sign. Nothing about the signing is faked.
 *
 * One thing is arranged rather than driven, and it is called out where it
 * happens. `review-sign` cannot be reached through the UI while the escrow
 * address is missing: `wallet-view` will not load a balance without an address,
 * its Create Transaction button is disabled at a zero balance, `build-tx`
 * disables Review Transaction, and `handleBuildTxReview` returns early. Four
 * layers, each tested elsewhere. `handleSign_PathA` is the fifth, and a guard
 * that nothing can reach today is exactly the guard a later change deletes
 * without noticing. So that one step is performed through the wizard's own
 * `setStep`, which is what a fifth layer failing would do, and the sign button
 * is then a real click on the real handler.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { RecoveryWizard } from './RecoveryWizard'
import { bitcoin, ecc } from '@/crypto/bitcoin-lib'
import { parseDescriptor } from '@/crypto/descriptor-parser'
import { deriveMultisigAddress, type DerivedAddress } from '@/crypto/address'
import { deriveSeed, computeFingerprint, deriveXprv, neuterXprv } from '@/crypto/derivation'
import { getProfile } from '@/crypto/profiles'
import type { WizardStep } from '@/hooks/useRecoveryWizard'

/**
 * A handle on the wizard's own step setter, so a test can put the wizard on a
 * screen its guards currently prevent. The hook itself is untouched: this is a
 * passthrough that keeps a reference to what the component is already using.
 */
const harness = vi.hoisted(() => ({
  setStep: null as ((step: string) => void) | null,
}))

vi.mock('@/hooks/useRecoveryWizard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useRecoveryWizard')>()
  return {
    ...actual,
    useRecoveryWizard: () => {
      const api = actual.useRecoveryWizard()
      harness.setStep = (step: string) => api.setStep(step as WizardStep)
      return api
    },
  }
})

// bitcoinjs-lib and bip32 expect a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet
const REFUSAL = /This page cannot open this escrow/i
const DESTINATION = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'

const PASSWORD = 'correct horse battery staple'
const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ACCOUNT_PATH = "m/48'/1'/0'/2'"

const cosignerMaster = bip32.fromSeed(Buffer.alloc(32, 0x07), NET)
const cosignerXpubs = [0, 2].map((i) => cosignerMaster.derive(i).neutered().toBase58())
const cosignerFps = ['aaaaaaaa', 'cccccccc']

// The escrow's two deposits, served to whichever address is asked for.
const UTXOS = [
  { txid: 'a'.repeat(64), vout: 0, value: 150_000, status: { confirmed: true } },
  { txid: 'b'.repeat(64), vout: 1, value: 75_000, status: { confirmed: true } },
]

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = String(url).includes('/v1/fees/recommended')
        ? { fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }
        : UTXOS
      return { ok: true, json: async () => body } as unknown as Response
    }),
  )
}

let supportedJson = ''
let unsupportedJson = ''
let userXprv = ''
let escrow: DerivedAddress
/** The child key the escrow's witness script actually holds for the customer. */
let userChildPubkey: Buffer
/** A PSBT for the unsupported escrow, for the walk that has to refuse. */
let importablePsbtBase64 = ''

beforeAll(async () => {
  const profile = getProfile('pbkdf2-v1')
  if (!profile) throw new Error('pbkdf2-v1 profile is missing')

  const seed = await deriveSeed(PASSWORD, SALT, profile)
  userXprv = deriveXprv(seed, ACCOUNT_PATH, 'testnet')
  const userXpub = neuterXprv(userXprv, 'testnet')
  const fingerprint = computeFingerprint(seed, 'testnet')

  /** The customer's leg pinned to a contract branch, the cosigners ranged. */
  function fileWith(userChild: string): string {
    const outputDescriptor =
      `wsh(sortedmulti(2,[${fingerprint}/48'/1'/0'/2']${userXpub}${userChild},` +
      `[${cosignerFps[0]}/48'/1'/0'/2']${cosignerXpubs[0]}/0/*,` +
      `[${cosignerFps[1]}/48'/1'/0'/2']${cosignerXpubs[1]}/0/*))`
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

  supportedJson = fileWith('/0/1')
  // Three components, which `childIndices` refuses: the positional signer would
  // take the last two and sign with a key that is not in the witness script.
  unsupportedJson = fileWith('/0/0/1')

  const supportedDescriptor = JSON.parse(supportedJson).outputDescriptor as string
  escrow = deriveMultisigAddress(parseDescriptor(supportedDescriptor), 0, 'testnet')
  userChildPubkey = Buffer.from(bip32.fromBase58(userXprv, NET).derive(0).derive(1).publicKey)

  // A PSBT built the way any other wallet would build it, pinned at `/0/1`.
  // Its witness script holds the customer's key, so a signature attempted
  // against it succeeds. That is what the refusal has to prevent.
  const coSigners = [0, 2].map((i) =>
    Buffer.from(cosignerMaster.derive(i).derive(0).derive(1).publicKey),
  )
  const pubkeys = [userChildPubkey, ...coSigners].sort(Buffer.compare)
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
        pubkey: userChildPubkey,
        path: `${ACCOUNT_PATH}/0/1`,
      },
    ],
  })
  psbt.addOutput({ address: p2wsh.address!, value: 100_000n })
  importablePsbtBase64 = psbt.toBase64()
}, 30_000)

/**
 * The PSBT the wizard is holding, captured as it is parsed on import.
 *
 * `signPsbtWithXprv` signs in place, so a signature that slips past a guard
 * lands on this exact object. The DOM cannot show that on its own: without the
 * guard the wizard also advances, so a test that only reads the screen passes
 * while the escrow is signed against the wrong key.
 */
let importedPsbt: bitcoin.Psbt | null = null

function signatureCount(psbt: bitcoin.Psbt | null): number {
  if (psbt === null) throw new Error('no PSBT was parsed, so nothing was asserted')
  return psbt.data.inputs.reduce((total, input) => total + (input.partialSig?.length ?? 0), 0)
}

beforeEach(() => {
  stubFetch()
  importedPsbt = null
  harness.setStep = null
  const realFromBase64 = bitcoin.Psbt.fromBase64.bind(bitcoin.Psbt)
  vi.spyOn(bitcoin.Psbt, 'fromBase64').mockImplementation((base64, opts) => {
    const parsed = realFromBase64(base64, opts)
    importedPsbt = parsed
    return parsed
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Upload, confirm, password: the walk every Path A test starts with. */
async function recoverKey(json: string) {
  render(<RecoveryWizard />)
  fireEvent.click(screen.getByRole('button', { name: /paste the JSON directly/i }))
  fireEvent.change(screen.getByPlaceholderText(/Paste your recovery file JSON here/i), {
    target: { value: json },
  })
  fireEvent.click(screen.getByRole('button', { name: /Load JSON/i }))
  fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
  fireEvent.change(screen.getByPlaceholderText(/Enter your escrow password/i), {
    target: { value: PASSWORD },
  })
  fireEvent.click(screen.getByRole('button', { name: /Recover Key/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }))
}

/** The whole of Path A, driven through the UI, up to the sign button. */
async function buildATransaction(amountBtc = '0.001') {
  await recoverKey(supportedJson)
  fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))

  // wallet-view loads the balance on mount, and will not offer to spend a zero.
  await screen.findByText(`Deposits (${UTXOS.length})`)
  fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))

  fireEvent.change(screen.getByLabelText(/Destination Address/i), {
    target: { value: DESTINATION },
  })
  fireEvent.change(screen.getByLabelText(/Amount \(BTC\)/i), { target: { value: amountBtc } })
  fireEvent.click(screen.getByRole('button', { name: /Review Transaction/i }))

  await screen.findByText('Review Transaction')
  fireEvent.click(screen.getByRole('checkbox'))
}

/** The finished PSBT as the customer would copy it off the export screen. */
function exportedPsbt(): bitcoin.Psbt {
  const pre = Array.from(document.querySelectorAll('pre')).find((el) =>
    (el.textContent ?? '').startsWith('cHNidP'),
  )
  if (!pre) throw new Error('no PSBT was offered for export')
  return bitcoin.Psbt.fromBase64(pre.textContent!, { network: NET })
}

// ---------------------------------------------------------------------------
// The transaction this page builds, and the key it is signed with
// ---------------------------------------------------------------------------

describe('Path A — signing a transaction this page built', () => {
  it('signs the escrow input with the key that escrow holds', async () => {
    await buildATransaction()

    fireEvent.click(screen.getByRole('button', { name: /Sign Transaction/i }))
    await screen.findByText(/Signature Added/i)

    const input = exportedPsbt().data.inputs[0]!
    expect(input.partialSig?.length).toBe(1)

    // The signature is by the customer's own pinned child, and that key is in
    // the witness script of the input being spent. A signature by any other
    // key is worthless and the customer would not find out until broadcast.
    expect(Buffer.from(input.partialSig![0]!.pubkey).equals(userChildPubkey)).toBe(true)
    expect(Buffer.from(input.witnessScript!).includes(userChildPubkey)).toBe(true)

    // And the input being spent belongs to this escrow, not some other address.
    expect(
      bitcoin.address.fromOutputScript(Buffer.from(input.witnessUtxo!.script), NET),
    ).toBe(escrow.address)
  })

  it('signs every deposit the escrow holds, not just the first', async () => {
    await buildATransaction()

    fireEvent.click(screen.getByRole('button', { name: /Sign Transaction/i }))
    await screen.findByText(/Signature Added/i)

    const psbt = exportedPsbt()
    expect(psbt.data.inputs.length).toBe(UTXOS.length)
    for (const input of psbt.data.inputs) {
      expect(input.partialSig?.length).toBe(1)
    }
  })

  /**
   * Sign, then come back to the review screen.
   *
   * The escrow address is handed to the signing call, and the only thing it
   * does there is decide which output the customer is told is coming back to
   * them. The screen below is redrawn from the summary that signing call
   * produced, which is why the walk returns to it: the summary the customer
   * read on the way in was built by a different call with a different argument.
   */
  async function signAndReturnToReview() {
    await buildATransaction()

    fireEvent.click(screen.getByRole('button', { name: /Sign Transaction/i }))
    await screen.findByText(/Signature Added/i)
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }))
    await screen.findByText('Review Transaction')
  }

  /**
   * The row in the Outputs table holding this address.
   *
   * This used to look the row up by truncateHash(address, 10), which is the
   * form the table rendered. The table now renders the whole address, so the
   * selector changed and the assertions did not. It is scoped to the <code>
   * cells the table draws rather than to the screen, because the summary above
   * the table also prints the first destination in full, and an unscoped
   * getByText would now match both of them.
   */
  function outputRow(address: string): HTMLElement {
    const cell = Array.from(document.querySelectorAll('code')).find(
      (el) => el.textContent === address,
    )
    if (!cell) throw new Error(`the outputs table renders no row for ${address}`)
    return cell.parentElement!
  }

  it('still names the escrow as the owner of the change once it is signed', async () => {
    await signAndReturnToReview()

    const escrowRow = outputRow(escrow.address)
    expect(escrowRow.textContent).toContain('change')

    const destinationRow = outputRow(DESTINATION)
    expect(destinationRow.textContent).not.toContain('change')
  })

  it('does not say everything was sent while most of it is coming back', async () => {
    // The other half, and the more dangerous reading. A customer told "all
    // funds sent" over a transaction returning most of the money to the escrow
    // has been given the wrong picture of where their Bitcoin went.
    await signAndReturnToReview()

    expect(screen.queryByText(/No change output/i)).toBeNull()
  })

  it('sends everything and claims no change when the customer asks for that', async () => {
    // The other reading of the same screen. Without this, a signing call that
    // labelled nothing as change would still satisfy the test above by never
    // producing change at all.
    await recoverKey(supportedJson)
    fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))
    await screen.findByText(`Deposits (${UTXOS.length})`)
    fireEvent.click(screen.getByRole('button', { name: /^Create Transaction$/i }))

    fireEvent.change(screen.getByLabelText(/Destination Address/i), {
      target: { value: DESTINATION },
    })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: /Review Transaction/i }))
    await screen.findByText('Review Transaction')

    expect(screen.getByText(/No change output/i)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// The refusal, on the path that never had one
// ---------------------------------------------------------------------------

describe('Path A — signing for an escrow this tool refuses to derive', () => {
  /**
   * Put the wizard on Path A's review screen holding a real PSBT.
   *
   * The PSBT arrives through the import screen, which is a real walk and works
   * without an escrow address by design. The step change afterwards is the part
   * the UI will not do today, and is the whole point: it stands in for the four
   * earlier guards failing, so that the fifth is the one under test.
   */
  async function reachPathAReview(json: string) {
    await recoverKey(json)
    fireEvent.click(screen.getByRole('button', { name: /Sign Existing PSBT/i }))
    fireEvent.change(screen.getByPlaceholderText(/cHNidP8BAH/), {
      target: { value: importablePsbtBase64 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Import from Paste/i }))
    await screen.findByText('Review Imported PSBT')

    act(() => harness.setStep!('review-sign'))
    await screen.findByText('Review Transaction')
    fireEvent.click(screen.getByRole('checkbox'))
  }

  it('refuses to sign, and leaves the PSBT unsigned', async () => {
    await reachPathAReview(unsupportedJson)
    expect(signatureCount(importedPsbt)).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /Sign Transaction/i }))

    // The assertion that is about the money. This PSBT's witness script holds
    // the key the signer reaches for, so an unguarded click leaves a real
    // signature on this object. Reading the screen alone would pass for a
    // change that signs and then fails to advance, which is the worse failure.
    expect(signatureCount(importedPsbt)).toBe(0)

    // And the wizard has not moved on.
    expect(screen.getByText('Review Transaction')).toBeTruthy()
    expect(screen.queryByText(/Signature Added/i)).toBeNull()
  })

  it('says why the sign button did nothing, where the customer is standing', async () => {
    await reachPathAReview(unsupportedJson)

    fireEvent.click(screen.getByRole('button', { name: /Sign Transaction/i }))

    expect(screen.getByRole('button', { name: /Sign Transaction/i })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(REFUSAL)
  })

  it('signs the same PSBT on the same screen once the address can be derived', async () => {
    // Without this the block above passes for a wizard that never signs at all,
    // and for a harness that never reaches the handler. The refusal has to be
    // about this escrow, not about this screen.
    await reachPathAReview(supportedJson)
    expect(signatureCount(importedPsbt)).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /Sign Transaction/i }))

    expect(signatureCount(importedPsbt)).toBe(1)
    expect(await screen.findByText(/Signature Added/i)).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })
})
