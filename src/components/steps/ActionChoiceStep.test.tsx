/**
 * The Choose screen: the four balance states, and the word this tool uses for
 * what the customer does with their own wallet.
 *
 * WHY THE BALANCE IS HERE AT ALL. Until now a customer had to click "Create
 * Transaction" before finding out whether there was anything to move. In the
 * scenario this tool exists for, "is my money still there" is the first
 * question anyone has, and the answer sat one screen further in behind a button
 * that sounds irreversible.
 *
 * WHY "NOT ASKED YET" IS A PROP. It cannot be read off the three balance props:
 * at mount `balance` is 0, `isLoadingBalance` is false and `balanceError` is
 * null, which is character for character the state of an escrow that was asked
 * about and is genuinely empty. `needsCustomEndpoint` cannot stand in for it
 * either, because it is false on mainnet, testnet and signet by definition. So
 * `balanceChecked` says whether a fetch has actually come back, and the tests
 * below drive the two states apart.
 *
 * WHY THE REGTEST FIELD IS STILL ITS OWN STATE. There is no such thing as "no
 * endpoint yet" measured from the URL: `useNetworkConfig` falls back to
 * `getMempoolApiBase(network)` and regtest returns a localhost default, so the
 * API base is NEVER empty. The only honest signal is the customer's own field
 * being blank, and it is what withholds the fetch. The last state is an escrow
 * whose address could not be derived at all, where there is nothing to report a
 * balance for.
 *
 * Tested at component level because every one of these states is a prop
 * combination. Driving the wizard into "the fetch failed" or "the endpoint is
 * blank on regtest" would mean faking the very thing under test.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { ActionChoiceStep } from './ActionChoiceStep'

const ADDRESS = 'bcrt1qxyzabcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmn'

type Overrides = Partial<Parameters<typeof ActionChoiceStep>[0]>

function renderStep(overrides: Overrides = {}) {
  const props = {
    escrowAddress: ADDRESS,
    network: 'regtest',
    customEndpoint: 'http://localhost:8999/api',
    needsCustomEndpoint: false,
    balance: 0,
    isLoadingBalance: false,
    balanceError: null,
    // The default is a fetch that HAS come back, so every case below reads as
    // the state it names. The mount state, where no fetch has returned, is a
    // case of its own and passes this false.
    balanceChecked: true,
    onLoadBalance: vi.fn(),
    onCustomEndpointChange: vi.fn(),
    onCreateTransaction: vi.fn(),
    onSignExisting: vi.fn(),
    onImportWallet: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  }
  render(<ActionChoiceStep {...props} />)
  return props
}

/** The balance line's own text, read from the live region that carries it. */
function balanceLine(): string {
  const status = document.querySelector('[role="status"]')
  if (!status) throw new Error('the screen renders no balance live region')
  return status.textContent ?? ''
}

afterEach(cleanup)

describe('the balance the customer came to see', () => {
  it('shows the amount once it has loaded', () => {
    renderStep({ balance: 123_456_789 })

    expect(screen.getByText('Escrow Balance')).toBeTruthy()
    expect(balanceLine()).toMatch(/1\.23456789 BTC/)
  })

  it('says so while it is still being fetched', () => {
    renderStep({ isLoadingBalance: true, balance: 0 })

    // And it must NOT read as a zero balance in the meantime, which is the
    // whole failure mode: a customer told their escrow is empty when the tool
    // simply has not finished asking.
    expect(balanceLine()).toMatch(/Checking the balance/i)
    expect(balanceLine()).not.toMatch(/0\.00000000/)
    expect(balanceLine()).not.toMatch(/No spendable balance/i)
  })

  it('says Unknown before the customer has given an endpoint to ask', () => {
    // Regtest only, and the one state that cannot be read off the API base URL
    // because that URL always has a value.
    renderStep({ needsCustomEndpoint: true, customEndpoint: '', balance: 0 })

    expect(balanceLine()).toMatch(/Unknown/i)
    expect(balanceLine()).not.toMatch(/0\.00000000/)
    expect(balanceLine()).not.toMatch(/No spendable balance/i)
  })

  it('says Unknown rather than zero when the fetch failed', () => {
    // A failed lookup is not an empty escrow, and on this screen of all screens
    // the difference is the whole point.
    renderStep({ balanceError: 'Network request failed', balance: 0 })

    expect(balanceLine()).toMatch(/Unknown/i)
    expect(balanceLine()).not.toMatch(/0\.00000000/)
    // STRENGTHENED. The two lines above were the whole test, and they pass
    // while the screen renders "Unknown" and "No spendable balance." together
    // inside the same live region, so a screen reader announces that the escrow
    // is empty when the tool has no idea. The not-yet-asked test three cases up
    // already carries this line; the failed-fetch case omitted it.
    expect(balanceLine()).not.toMatch(/No spendable balance/i)
  })

  it('does not turn a failure into an error box on this screen', () => {
    // The failure, its explanation and its Retry live on the screen behind
    // Create Transaction. Repeating them here would put a warning box under a
    // half typed URL, on the screen for someone who fears their money is gone.
    renderStep({ balanceError: 'Network request failed' })

    expect(screen.queryByText(/could not be loaded/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Try again/i })).toBeNull()
  })

  it('states the fact when the escrow is empty, and stops there', () => {
    // A fetch that came back with nothing in it, which is the ONLY state that
    // may be shown as a zero. `balanceChecked` is explicit rather than left to
    // the default: without it this fixture is also the mount state, and the
    // test then certifies the bug it is supposed to guard against.
    renderStep({ balance: 0, balanceChecked: true })

    expect(balanceLine()).toMatch(/0\.00000000 BTC/)
    expect(balanceLine()).toMatch(/No spendable balance/i)

    // The second sentence of the `WalletViewStep` line is deliberately absent.
    // It tells someone who opened this tool to WITHDRAW that they should
    // DEPOSIT, and nothing on this screen is disabled for it to explain.
    expect(document.body.textContent).not.toMatch(/Send Bitcoin to your escrow address/i)
  })

  it('says Unknown before any fetch has come back, on every network', () => {
    // THE MOUNT STATE, and the reason `balanceChecked` exists. The fetch is
    // debounced, so for the first 400ms on mainnet, testnet and signet the
    // three balance props sit at exactly the values an empty escrow produces.
    // Reported as a zero, in a live region a screen reader may announce, that
    // tells a customer their Bitcoin is gone when nobody has looked yet.
    //
    // `needsCustomEndpoint` is false here on purpose: that is the real network
    // case, and it is where the endpoint signal can never help.
    renderStep({ balanceChecked: false, balance: 0, needsCustomEndpoint: false })

    expect(balanceLine()).toMatch(/Unknown/i)
    expect(balanceLine()).not.toMatch(/0\.00000000/)
    expect(balanceLine()).not.toMatch(/No spendable balance/i)
  })

  it('drops a balance that belongs to an endpoint the customer has changed', () => {
    // Same root cause, on regtest. The old endpoint's balance was still on
    // screen while the debounce ran for the new one, so an amount fetched from
    // somewhere the customer has already moved off read as current.
    renderStep({
      balanceChecked: false,
      balance: 123_456_789,
      needsCustomEndpoint: true,
      customEndpoint: 'http://localhost:9999/api',
    })

    expect(balanceLine()).toMatch(/Unknown/i)
    expect(balanceLine()).not.toMatch(/1\.23456789/)
  })

  it('does not disable Create Transaction at a zero balance', () => {
    // Showing the number is enough. The disabled button, and the line that
    // explains it, belong on `WalletViewStep` where spending actually happens.
    renderStep({ balance: 0 })

    const button = screen.getByRole('button', { name: /^Create Transaction$/i })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('reports nothing at all when no escrow address could be derived', () => {
    // The fourth state. The address block is already absent here, and a balance
    // for an address this tool has refused to show would be a balance for
    // nothing.
    renderStep({ escrowAddress: '', balance: 500_000 })

    expect(screen.queryByText('Escrow Balance')).toBeNull()
    // The label, not the phrase: "from your escrow address" appears in the
    // Create Transaction description and is correct there.
    expect(screen.queryByText(/^Escrow Address \(/i)).toBeNull()
    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  it('does show both of those for an escrow it can derive', () => {
    // The positive partner for the absence checks above, which a component
    // rendering nothing at all would otherwise satisfy.
    renderStep({ balance: 500_000 })

    expect(screen.getByText('Escrow Balance')).toBeTruthy()
    expect(screen.getByText(/^Escrow Address \(/i)).toBeTruthy()
  })

  it('announces the number, because it arrives after the screen does', () => {
    // Without a live region the balance simply appears and a screen reader user
    // is never told. Asserted as a role rather than an attribute so it stays
    // true if the element changes.
    renderStep({ balance: 1 })
    expect(screen.getByRole('status')).toBeTruthy()
  })
})

describe('fetching the balance without a fetch per keystroke', () => {
  it('asks once, after the endpoint stops changing', async () => {
    vi.useFakeTimers()
    try {
      const onLoadBalance = vi.fn()
      // A fresh identity per render, exactly as `handleLoadWallet` produces when
      // the endpoint changes. A plain mount effect would call it every time.
      const { rerender } = render(
        <ActionChoiceStep
          escrowAddress={ADDRESS}
          network="regtest"
          customEndpoint="h"
          needsCustomEndpoint={true}
          balance={0}
          isLoadingBalance={false}
          balanceError={null}
          balanceChecked={false}
          onLoadBalance={() => onLoadBalance('h')}
          onCustomEndpointChange={() => {}}
          onCreateTransaction={() => {}}
          onSignExisting={() => {}}
          onImportWallet={() => {}}
          onBack={() => {}}
        />,
      )

      for (const typed of ['ht', 'htt', 'http', 'http:']) {
        rerender(
          <ActionChoiceStep
            escrowAddress={ADDRESS}
            network="regtest"
            customEndpoint={typed}
            needsCustomEndpoint={true}
            balance={0}
            isLoadingBalance={false}
            balanceError={null}
            balanceChecked={false}
            onLoadBalance={() => onLoadBalance(typed)}
            onCustomEndpointChange={() => {}}
            onCreateTransaction={() => {}}
            onSignExisting={() => {}}
            onImportWallet={() => {}}
            onBack={() => {}}
          />,
        )
      }

      // Nothing has been fetched yet: five endpoints, five callback identities.
      expect(onLoadBalance).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // One fetch, and for the endpoint the customer stopped on rather than the
      // first fragment they typed.
      expect(onLoadBalance).toHaveBeenCalledTimes(1)
      expect(onLoadBalance).toHaveBeenCalledWith('http:')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does ask when there is an endpoint and an address', async () => {
    // The positive partner. Without it the debounce test above passes for a
    // screen that never fetches a balance at all.
    const { onLoadBalance } = renderStep()
    await waitFor(() => expect(onLoadBalance).toHaveBeenCalled())
  })

  it('does not ask before the customer has supplied a regtest endpoint', async () => {
    const { onLoadBalance } = renderStep({ needsCustomEndpoint: true, customEndpoint: '' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(onLoadBalance).not.toHaveBeenCalled()
  })

  it('does not ask when there is no escrow address to ask about', async () => {
    const { onLoadBalance } = renderStep({ escrowAddress: '' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(onLoadBalance).not.toHaveBeenCalled()
  })
})

describe('one word for what the customer does with their own wallet', () => {
  /*
   * Elie ruled the word EXPORT: "they're exporting into their own wallet."
   *
   * The screen already used "export" for something else, at two different
   * places: Create Transaction's description exports a PSBT to the OTHER
   * signer, and Path A's final step chip is called Export for the same thing.
   * So the link names its object, "Your Signing File", which is what separates
   * it from the transaction file that goes to a co-signer, and it matches the
   * sentence directly underneath it word for word.
   */
  it('calls the link an export and names what is exported', () => {
    renderStep()

    expect(screen.getByRole('button', { name: /Export Your Signing File Instead/i })).toBeTruthy()
    expect(document.body.textContent).toMatch(/Export your signing file to a wallet app/i)
  })

  it('never calls that action an import', () => {
    renderStep()
    const link = screen.getByRole('button', { name: /Export Your Signing File Instead/i })

    expect(link.textContent).not.toMatch(/import/i)

    // The positive partner and the live control in one: "import" is still on
    // this screen, correctly, for the OTHER action. Sign Existing PSBT really
    // does pull a file in from another signer, so a sweep that renamed every
    // "import" on the screen would be wrong and this catches it.
    expect(document.body.textContent).toMatch(/Import a PSBT/i)
  })

  it('still routes to the guide when that link is clicked', () => {
    // Renaming a control is only safe if it still does its job.
    const { onImportWallet } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: /Export Your Signing File Instead/i }))
    expect(onImportWallet).toHaveBeenCalledTimes(1)
  })
})

/**
 * What a customer who cannot see the screen is told.
 *
 * The number arrives after the page does, so it sits in a live region and is
 * announced when it lands. The region used to hold the value alone, with the
 * words "Escrow Balance" in a sibling outside it, so the announcement was
 * "Unknown", or "0.05000000 BTC", with nothing saying what the number was OF.
 * On the screen where somebody finds out whether their Bitcoin is still there,
 * a bare number is not an answer.
 */
describe('the balance announcement', () => {
  /** The live region the balance is announced from, found FROM the label. */
  function announcement(): string {
    const label = screen.getByText('Escrow Balance')
    const region = label.closest('[role="status"]')
    if (!region) throw new Error('the balance label is not inside the live region')
    return region.textContent ?? ''
  }

  it('carries the label as well as the value', () => {
    renderStep({ balance: 123_456_789 })

    expect(announcement()).toMatch(/Escrow Balance/)
    expect(announcement()).toMatch(/1\.23456789 BTC/)
  })

  it('carries it for Unknown too, which is the state that says least on its own', () => {
    renderStep({ balanceChecked: false })

    expect(announcement()).toMatch(/Escrow Balance/)
    expect(announcement()).toMatch(/Unknown/i)
  })

  it('says it once on screen, not twice', () => {
    // The label is brought inside the region rather than duplicated into it, so
    // a sighted customer still reads it exactly once.
    renderStep({ balance: 123_456_789 })

    expect(screen.getAllByText('Escrow Balance')).toHaveLength(1)
  })
})

/**
 * The escrow address in the box at the top of the Choose screen.
 *
 * It used to be shortened TWICE. `truncateHash(escrowAddress, 12)` cut it to a
 * head, three dots and a tail, and the element it went into also carried
 * Tailwind's `truncate`, which clips whatever is left and appends an ellipsis
 * of its own. On a narrow phone that hid most of the address, and because the
 * CSS ellipsis renders in the same monospace font right next to the helper's
 * own three dots, nothing on screen said that more had been removed.
 *
 * The `CopyButton` always copied the whole address, so what was on screen and
 * what went to the clipboard disagreed. The address is now shown in full and
 * wrapped, and the tests below pin both halves of that.
 */
describe('the escrow address is readable in full', () => {
  /** What the two layers of shortening used to leave on screen. Written out by
   *  hand, not computed, so this does not agree with the bug by reusing the
   *  bug's own helper. The guards in the first test pin it to ADDRESS. */
  const SHORTENED = 'bcrt1qxyzabc...cdefghijklmn'

  /** The single <code> on this screen, which is the address cell. */
  function addressCell(): HTMLElement {
    const cells = document.querySelectorAll('code')
    if (cells.length !== 1) {
      throw new Error(`expected one address cell, found ${cells.length}`)
    }
    return cells[0] as HTMLElement
  }

  it('shows the whole address, not the shortened form', () => {
    // The shortened literal really is this address head-and-tail, so the
    // absence assertions below are about THIS address.
    expect(ADDRESS.startsWith('bcrt1qxyzabc')).toBe(true)
    expect(ADDRESS.endsWith('cdefghijklmn')).toBe(true)
    expect(ADDRESS.length).toBeGreaterThan(50)
    expect(SHORTENED.length).toBeLessThan(ADDRESS.length)

    renderStep()

    // Positive partner: the address is on screen character for character, so
    // these cannot pass by the box simply not rendering.
    const cell = addressCell()
    expect(cell.textContent).toBe(ADDRESS)
    expect(screen.getByText(ADDRESS)).toBeTruthy()

    expect(screen.queryByText(SHORTENED)).toBeNull()
    expect(cell.textContent).not.toContain('...')
  })

  it('wraps the address instead of clipping it', () => {
    renderStep()

    const cell = addressCell()
    // Positive partner for the class assertions below.
    expect(cell.textContent).toBe(ADDRESS)
    expect(cell.className).toContain('font-mono')
    // break-all lets a 59 character unbroken string wrap inside the box rather
    // than push the page sideways at a narrow width.
    expect(cell.className).toContain('break-all')
    // `truncate` is what clipped the already-shortened string a second time.
    expect(cell.className).not.toContain('truncate')
  })

  it('copies the complete address, matching what is now on screen', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })

    renderStep()

    // Positive partner: what is on screen is the full address, so the clipboard
    // assertion below is a match rather than a coincidence.
    expect(addressCell().textContent).toBe(ADDRESS)

    fireEvent.click(screen.getByRole('button', { name: /copy/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(ADDRESS)
    expect(writeText).not.toHaveBeenCalledWith(SHORTENED)
  })

  it('keeps the balance line in the same box as the full address', () => {
    renderStep({ balance: 123_456_789 })

    // Both halves of the box are present together: the wrapped address has not
    // displaced the balance line that sits under it.
    const cell = addressCell()
    expect(cell.textContent).toBe(ADDRESS)
    expect(screen.getByText('Escrow Balance')).toBeTruthy()
    expect(screen.getByText(/1\.23456789 BTC/)).toBeTruthy()

    // The balance row is a sibling inside the same box as the address, not a
    // panel that has broken out of it.
    const box = cell.closest('div.rounded-\\[var\\(--radius-base\\)\\]')
    expect(box).not.toBeNull()
    expect(box!.textContent).toContain('Escrow Balance')
  })
})
