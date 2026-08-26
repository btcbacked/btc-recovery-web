/**
 * Every screen that prints the escrow configuration, tested against the string
 * it prints.
 *
 * The shipped defect: the warning on the wallet guide was gated on
 * `parsedDescriptor`, which is null exactly when the descriptor failed to
 * parse. So the screen a customer reaches after something has already gone
 * wrong printed their `xprv` in full with nothing telling them what it was.
 *
 * Every descriptor below is therefore one no parser will accept: `multi`
 * rather than `sortedmulti`, which `parseDescriptor` refuses outright. If a
 * screen can only warn about keys it could parse, it fails here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Buffer } from 'buffer'
import { BIP32Factory } from 'bip32'
import { ResultStep } from './ResultStep'
import { WalletGuideStep } from './WalletGuideStep'
import { HardwareStep } from './HardwareStep'
import { ActionChoiceStep } from './ActionChoiceStep'
import { PrivateKeyWarning } from '@/components/PrivateKeyWarning'
import { UnsupportedEscrowNotice } from '@/components/DerivationNotice'
import { bitcoin, ecc } from '@/crypto/bitcoin-lib'
import { parseDescriptor } from '@/crypto/descriptor-parser'
import { provablyPublicOnly } from '@/crypto'
import type { RecoveryFile } from '@/crypto'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet
const node = bip32.fromSeed(Buffer.alloc(32, 0x21), NET)
const TPRV = node.toBase58()
const TPUB = node.neutered().toBase58()

/** Carries the customer's key, and cannot be parsed. Both at once, on purpose. */
const UNREADABLE_WITH_KEY =
  `wsh(multi(2,[aaaaaaaa/48'/1'/0'/2']${TPRV}/0/1,` +
  `[bbbbbbbb/48'/1'/0'/2']${TPUB}/0/1))`

/** The device path's string: no key in it, and equally unparseable. */
const UNREADABLE_WITHOUT_KEY =
  `wsh(multi(2,[aaaaaaaa/48'/1'/0'/2']${TPUB}/0/1,` +
  `[bbbbbbbb/48'/1'/0'/2']${TPUB}/0/1))`

const WARNING = /Keep this secret/i

/** The premise every test here rests on, asserted rather than assumed. */
it('the fixture really is a descriptor the parser refuses', () => {
  expect(() => parseDescriptor(UNREADABLE_WITH_KEY)).toThrow()
  expect(() => parseDescriptor(UNREADABLE_WITHOUT_KEY)).toThrow()
})

afterEach(cleanup)

/** Was the key actually printed, in full, where a person could read it? */
function keyIsOnScreen(): boolean {
  return (document.body.textContent ?? '').includes(TPRV)
}

function warningIsOnScreen(): boolean {
  return screen.queryAllByText(WARNING).length > 0
}

/**
 * Defaults to the device path deliberately. A test that wants this screen to
 * claim the customer holds a signing file has to say so with a real keySource,
 * so the claim can never appear by accident in a fixture nobody re-read.
 */
const guideProps = {
  keySource: 'COLD_CARD',
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

const file: RecoveryFile = {
  version: 1,
  network: 'testnet',
  outputDescriptor: UNREADABLE_WITHOUT_KEY,
  // A file that predates both fields, which is what every customer holds today.
  escrowAddress: null,
  cosigners: null,
  context: { contractId: 'c', role: 'borrower', threshold: 2, totalKeys: 3 },
  userKey: {
    keySource: 'COLD_CARD',
    derivationPath: "m/48'/1'/0'/2'",
    xpub: TPUB,
    fingerprint: 'bbbbbbbb',
  },
}

const hardwareProps = {
  file,
  escrowAddress: '',
  balance: 0,
  depositCount: 0,
  isLoadingBalance: false,
  balanceError: null,
  isStandardDerivation: true,
  onLoadBalance: () => {},
  onContinue: () => {},
  onBack: () => {},
}

describe('WalletGuideStep', () => {
  it('warns whenever it prints the key, including when the escrow could not be read', () => {
    render(<WalletGuideStep {...guideProps} descriptor={UNREADABLE_WITH_KEY} />)

    expect(keyIsOnScreen()).toBe(true)
    expect(warningIsOnScreen()).toBe(true)
  })

  it('says the wallet will sign, not that a device is needed, on the password path', () => {
    // The same wrong source of truth, second symptom. A customer who recovered
    // by password and whose descriptor would not parse was told to connect a
    // hardware wallet they have never owned. The fix is the file's own record
    // of where the key lives, which a failed parse cannot take away.
    render(
      <WalletGuideStep {...guideProps} keySource="PASSWORD" descriptor={UNREADABLE_WITH_KEY} />,
    )

    const sparrow = document.getElementById('wallet-panel-sparrow')?.textContent ?? ''
    expect(sparrow).toMatch(/already holds your signing key/i)
    expect(sparrow).not.toMatch(/Connect your hardware wallet/i)
  })

  it('stays quiet on the device path, where the text holds no key', () => {
    render(<WalletGuideStep {...guideProps} descriptor={UNREADABLE_WITHOUT_KEY} />)

    expect(keyIsOnScreen()).toBe(false)
    expect(warningIsOnScreen()).toBe(false)
    expect(document.getElementById('wallet-panel-sparrow')?.textContent).toMatch(
      /Connect your hardware wallet/i,
    )
  })
})

describe('ResultStep', () => {
  it('warns whenever it prints the key, including when the escrow could not be read', () => {
    render(<ResultStep descriptor={UNREADABLE_WITH_KEY} onContinue={() => {}} />)

    expect(keyIsOnScreen()).toBe(true)
    expect(warningIsOnScreen()).toBe(true)
  })
})

describe('HardwareStep', () => {
  /**
   * No route reaches this screen holding a private key today: the password path
   * never lands here. It is covered anyway because it renders the same kind of
   * string through the same code block, and "unreachable" is a property of the
   * wizard's routing, not of this component.
   */
  it('warns if it is ever handed a string with the key in it', () => {
    render(<HardwareStep {...hardwareProps} descriptor={UNREADABLE_WITH_KEY} />)

    expect(keyIsOnScreen()).toBe(true)
    expect(warningIsOnScreen()).toBe(true)
  })

  it('stays quiet on the escrow file it actually shows', () => {
    render(<HardwareStep {...hardwareProps} descriptor={UNREADABLE_WITHOUT_KEY} />)

    expect(keyIsOnScreen()).toBe(false)
    expect(warningIsOnScreen()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Document order
//
// Every test above proves the warning is somewhere on the page. None of them
// proved it is above the key, so moving it under the code block passed the lot
// of them. Reading it after the key has already been read, copied or
// screenshotted is not a warning, it is a caption.
// ---------------------------------------------------------------------------

/** The warning element and the block printing the key, or a clear failure. */
function warningAndKeyBlock(descriptor: string) {
  const warning = screen.getAllByText(WARNING)[0]
  const keyBlock = Array.from(document.querySelectorAll('pre')).find(
    (pre) => pre.textContent === descriptor,
  )
  if (!warning) throw new Error('the warning is not on screen at all')
  if (!keyBlock) throw new Error('the block printing the key is not on screen at all')
  return { warning, keyBlock }
}

function warningComesFirst(descriptor: string): boolean {
  const { warning, keyBlock } = warningAndKeyBlock(descriptor)
  return Boolean(warning.compareDocumentPosition(keyBlock) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('the warning is read before the key, not after it', () => {
  it('sits above the key on ResultStep', () => {
    render(<ResultStep descriptor={UNREADABLE_WITH_KEY} onContinue={() => {}} />)
    expect(warningComesFirst(UNREADABLE_WITH_KEY)).toBe(true)
  })

  it('sits above the key on WalletGuideStep', () => {
    render(<WalletGuideStep {...guideProps} descriptor={UNREADABLE_WITH_KEY} />)
    expect(warningComesFirst(UNREADABLE_WITH_KEY)).toBe(true)
  })

  it('sits above the key on HardwareStep', () => {
    render(<HardwareStep {...hardwareProps} descriptor={UNREADABLE_WITH_KEY} />)
    expect(warningComesFirst(UNREADABLE_WITH_KEY)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Failing closed
//
// The regression this locks out was introduced by the fix above it. Making the
// warning conditional on a detector helped the two screens that had nothing and
// hurt the one that was previously unconditional: a key shape the pattern does
// not describe now prints with no warning at all. The gate is therefore hung on
// proof of absence, and ResultStep does not consult it.
// ---------------------------------------------------------------------------

describe('failing closed', () => {
  it('ResultStep warns even about a string the scan certifies as carrying no key', () => {
    // The premise, asserted rather than assumed: the scan really does clear
    // this string, and the other two screens really do go quiet on it.
    expect(provablyPublicOnly(UNREADABLE_WITHOUT_KEY)).toBe(true)

    render(<ResultStep descriptor={UNREADABLE_WITHOUT_KEY} onContinue={() => {}} />)

    expect(warningIsOnScreen()).toBe(true)
  })

  it('warns on a string the scan can prove nothing about either way', () => {
    // A WIF key: no extended key pattern describes it, and it is not provable
    // as public. Under the old rule this was silence. It is the shape of every
    // future miss.
    const wif = 'wsh(L1aW4aubDFB7yfras2S1mN3bqg9no1s2GBGjkYqZKKKKKKKKKKKK)'
    expect(provablyPublicOnly(wif)).toBe(false)

    render(<WalletGuideStep {...guideProps} descriptor={wif} />)

    expect(warningIsOnScreen()).toBe(true)
  })

  it('stays quiet only on positive proof, so an empty string still warns', () => {
    render(<HardwareStep {...hardwareProps} descriptor="" />)

    expect(warningIsOnScreen()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Telling the two notices apart
//
// On the refusal screen this warning sits beside UnsupportedEscrowNotice. That
// one says the customer's Bitcoin is safe. This one says it can be stolen. They
// shared the amber tokens and an icon each, so at a glance they read as one
// notice repeated. Order is deliberate and unchanged; only the weight differs.
// ---------------------------------------------------------------------------

describe('the key warning is visually separated from the safety notice', () => {
  function boxFor(text: RegExp): HTMLElement {
    const el = screen.getAllByText(text)[0]?.closest('div')
    if (!el) throw new Error('no container rendered for that notice')
    return el as HTMLElement
  }

  it('carries a destructive token and a border, not the amber of the safe notice', () => {
    render(<PrivateKeyWarning text={UNREADABLE_WITH_KEY} />)
    const warning = boxFor(WARNING)

    expect(warning.className).toMatch(/bg-destructive/)
    expect(warning.className).toMatch(/border-destructive/)
    expect(warning.className).toMatch(/\bborder\b/)
  })

  it('shares no colour token with the notice that says the funds are safe', () => {
    render(<PrivateKeyWarning text={UNREADABLE_WITH_KEY} />)
    const warning = boxFor(WARNING)
    cleanup()

    render(<UnsupportedEscrowNotice />)
    const safe = screen.getByRole('alert')

    expect(warning.className).not.toMatch(/warning/)
    expect(safe.className).not.toMatch(/destructive/)
  })
})

// ---------------------------------------------------------------------------
// Two objects, two names
//
// "Escrow file" is the watch only version and holds public information only.
// "Signing file" is the version that holds the customer's private key in plain
// text. One name was serving both, which hid the only distinction that decides
// whether the text on the page can spend their Bitcoin.
// ---------------------------------------------------------------------------

describe('the guide names the object for the path the customer is actually on', () => {
  it('calls it a signing file on the password path', () => {
    render(
      <WalletGuideStep {...guideProps} keySource="PASSWORD" descriptor={UNREADABLE_WITH_KEY} />,
    )
    const page = document.body.textContent ?? ''

    expect(page).toMatch(/Signing File/)
    expect(page).not.toMatch(/Escrow File/)
    expect(page).toMatch(/Paste the signing file into the box Sparrow labels/i)
    expect(screen.getByRole('button', { name: /Copy Signing File/i })).toBeDefined()
  })

  it('calls it an escrow file on every device path, whatever the device is', () => {
    for (const keySource of ['COLD_CARD', 'LEDGER', 'TREZOR', 'BITBOX02', 'OTHER']) {
      render(
        <WalletGuideStep
          {...guideProps}
          keySource={keySource}
          descriptor={UNREADABLE_WITHOUT_KEY}
        />,
      )
      const page = document.body.textContent ?? ''

      expect(page).toMatch(/Escrow File/)
      expect(page).not.toMatch(/Signing File/)
      expect(page).toMatch(/Paste the escrow file into the box Sparrow labels/i)
      cleanup()
    }
  })

  /**
   * No file loaded means no claim can be supported, so the screen makes the one
   * that cannot be false. The warning is not softened to match: it reads the
   * string and shows anyway. That split is the whole design.
   */
  it('falls back to the claim that cannot be false when the path is unknown', () => {
    render(<WalletGuideStep {...guideProps} keySource="" descriptor={UNREADABLE_WITH_KEY} />)
    const page = document.body.textContent ?? ''

    expect(page).toMatch(/Escrow File/)
    expect(page).not.toMatch(/Signing File/)
    expect(warningIsOnScreen()).toBe(true)
  })

  it('never calls it a wallet configuration on either path', () => {
    for (const keySource of ['PASSWORD', 'COLD_CARD']) {
      render(
        <WalletGuideStep
          {...guideProps}
          keySource={keySource}
          descriptor={UNREADABLE_WITH_KEY}
        />,
      )
      expect(document.body.textContent ?? '').not.toMatch(/wallet configuration/i)
      expect(document.body.textContent ?? '').not.toMatch(/the configuration/i)
      cleanup()
    }
  })

  /**
   * The names another app puts on its own controls are not ours to change. A
   * customer hunting for Sparrow's box has to be told the word Sparrow shows.
   */
  it('keeps other apps own labels rather than renaming them', () => {
    render(<WalletGuideStep {...guideProps} descriptor={UNREADABLE_WITH_KEY} />)
    const page = document.body.textContent ?? ''

    expect(page).toMatch(/box Sparrow labels\s*Descriptor/i)
    expect(page).toMatch(/Specter labels\s*import from a descriptor/i)
    expect(page).toMatch(/importdescriptors/)
  })
})

describe('ResultStep names the signing file', () => {
  it('calls the object a signing file, never a descriptor or a configuration', () => {
    render(<ResultStep descriptor={UNREADABLE_WITH_KEY} onContinue={() => {}} />)
    const page = document.body.textContent ?? ''

    expect(page).toMatch(/Signing File/)
    expect(page).toMatch(/What is this signing file\?/i)
    expect(page).not.toMatch(/descriptor/i)
    expect(page).not.toMatch(/configuration/i)
  })

  it('names the download after the signing file, the one download that always carries the key', () => {
    const downloaded: string[] = []
    const createObjectURL = URL.createObjectURL
    const revokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:test'
    URL.revokeObjectURL = () => {}
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded.push(this.download)
      })

    try {
      render(<ResultStep descriptor={UNREADABLE_WITH_KEY} onContinue={() => {}} />)

      // ResultStep releases the object URL on a 100ms timer, so Firefox has
      // time to start the download. Fake timers make that fire HERE, while the
      // two stubs above are still installed.
      //
      // Without this the timer lands AFTER the finally block below has put the
      // originals back, and in jsdom the original of both is `undefined`. The
      // run then reports `URL.revokeObjectURL is not a function` as an uncaught
      // exception and `npm test` exits 1 while every test still reads as
      // passing. The deploy workflow gates on that exit code, so it is the
      // difference between the tool shipping and not.
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: /Download as \.txt/i }))
      vi.runAllTimers()

      expect(downloaded).toEqual(['btcbacked-signing-file.txt'])
    } finally {
      vi.useRealTimers()
      click.mockRestore()
      URL.createObjectURL = createObjectURL
      URL.revokeObjectURL = revokeObjectURL
    }
  })
})

describe('ActionChoiceStep names the signing file', () => {
  it('offers to export a signing file, not a wallet configuration', () => {
    render(
      <ActionChoiceStep
        escrowAddress=""
        network="testnet"
        customEndpoint=""
        needsCustomEndpoint={false}
        onCustomEndpointChange={() => {}}
        onCreateTransaction={() => {}}
        onSignExisting={() => {}}
        onImportWallet={() => {}}
        onBack={() => {}}
      />,
    )
    const page = document.body.textContent ?? ''

    expect(page).toMatch(/Export your signing file to a wallet app/i)
    expect(page).not.toMatch(/wallet configuration/i)
  })
})

// ---------------------------------------------------------------------------
// The accessibility tree
//
// Document order above is necessary and was never sufficient. The warning had
// no role, so it reached a screen reader as an anonymous paragraph carrying its
// severity entirely in a colour, and a customer navigating by landmark or
// jumping to the code block met the key that spends their Bitcoin having heard
// nothing. The queries below are role and accessible name only: Testing Library
// excludes anything hidden from the accessibility tree, so a node that is
// merely in the DOM cannot satisfy them.
// ---------------------------------------------------------------------------

/** The two nodes as assistive technology sees them, or a clear failure. */
function warningAndKeyBlockForAT(keyBlockName: RegExp) {
  const warning = screen.getByRole('region', { name: WARNING })
  const keyBlock = screen.getByRole('group', { name: keyBlockName })
  return { warning, keyBlock }
}

/** Resolves `aria-describedby` the way a screen reader does, and reads it. */
function describedText(el: HTMLElement): string {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  return ids
    .map((id) => {
      const target = document.getElementById(id)
      if (!target) throw new Error(`aria-describedby points at "${id}", which is not on the page`)
      return target.textContent ?? ''
    })
    .join(' ')
}

/**
 * Announced before the key on the way down the page, and announced again on
 * arrival at the key for anyone who did not come down the page.
 */
function assertWarningReachesTheUserBeforeTheKey(keyBlockName: RegExp) {
  const { warning, keyBlock } = warningAndKeyBlockForAT(keyBlockName)

  expect(warning.compareDocumentPosition(keyBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(warning.contains(keyBlock)).toBe(false)

  const description = describedText(keyBlock)
  expect(description).toMatch(WARNING)
  expect(description).toMatch(/can spend your Bitcoin/i)

  const describedBy = keyBlock.getAttribute('aria-describedby') ?? ''
  const source = document.getElementById(describedBy)
  expect(source).not.toBeNull()
  expect(warning.contains(source)).toBe(true)
}

describe('the warning reaches assistive technology before the key does', () => {
  it('on ResultStep', () => {
    render(<ResultStep descriptor={UNREADABLE_WITH_KEY} onContinue={() => {}} />)
    assertWarningReachesTheUserBeforeTheKey(/Signing File/i)
  })

  it('on WalletGuideStep', () => {
    render(<WalletGuideStep {...guideProps} descriptor={UNREADABLE_WITH_KEY} />)
    assertWarningReachesTheUserBeforeTheKey(/Escrow File/i)
  })

  it('on HardwareStep', () => {
    render(<HardwareStep {...hardwareProps} descriptor={UNREADABLE_WITH_KEY} />)
    assertWarningReachesTheUserBeforeTheKey(/Escrow File/i)
  })

  /**
   * The name is the customer's own approved opening words, taken from the copy
   * by `aria-labelledby`. Nothing here may invent a label for screen readers,
   * because that is a second wording of an approved string that no one reviews.
   */
  it('is named by the approved copy and not by a label written for screen readers', () => {
    render(<PrivateKeyWarning text={UNREADABLE_WITH_KEY} />)
    const warning = screen.getByRole('region', { name: /^Keep this secret\.$/ })

    expect(warning.hasAttribute('aria-label')).toBe(false)
    const titleId = warning.getAttribute('aria-labelledby') ?? ''
    expect(document.getElementById(titleId)?.textContent).toBe('Keep this secret.')
  })

  /**
   * It labels text already on screen, so it must not interrupt. `UnsupportedEscrowNotice`
   * on these same screens holds the alert role because it is blocking; a second
   * alert would talk over the only explanation of why the buttons are dead.
   */
  it('does not take the alert role and talk over the blocking notice', () => {
    render(<PrivateKeyWarning text={UNREADABLE_WITH_KEY} />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  /** No warning on the page means no description to point at, ever. */
  it('leaves no dangling description on the escrow file that carries no key', () => {
    render(<HardwareStep {...hardwareProps} descriptor={UNREADABLE_WITHOUT_KEY} />)

    const keyBlock = screen.getByRole('group', { name: /Escrow File/i })
    expect(keyBlock.hasAttribute('aria-describedby')).toBe(false)
    expect(describedText(keyBlock)).toBe('')
  })
})
