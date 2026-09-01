/**
 * The Review Transaction screen: the last thing a customer sees before this
 * tool signs a transaction it built for them. Signing is irreversible.
 *
 * WHY THE WHOLE ADDRESS. The screen already showed the FIRST destination in
 * full, in larger semibold type, in the summary above the outputs table. The
 * table underneath it did not: every row went through
 * truncateHash(address, 10) inside an element that also carried Tailwind's
 * `truncate`, so each row was shortened twice over. Any destination after the
 * first, and the change output, were therefore head-and-tail only, and a
 * shortened address cannot rule out a substitution ground to match on exactly
 * those characters. That is the one attack this screen exists to catch. Every
 * row now renders the complete string, wrapped, with the shared CopyButton
 * beside it so the customer can paste it somewhere else and compare.
 *
 * WHY THE FIXTURE ADDRESSES ARE FULL LENGTH. A short stub renders identically
 * whether or not the component truncates, so a truncation regression would
 * sail straight through. These are 60-plus character bech32 strings, and the
 * head and tail guards below pin the shortened literal this test asserts is
 * gone, so that literal is not derived from the same helper the component used
 * to call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ReviewSignStep } from './ReviewSignStep'
import type { PsbtAnalysis } from '@/crypto/psbt-finalizer'

/** The first destination. Full length, so truncation is observable. */
const ADDRESS_1 = 'bcrt1qw3kf7v9x2ta5m0dqs8h4jn6ce2ua7lgzp5ry9x8gf2tvdw0s3jn54khcm'
/** What truncateHash(ADDRESS_1, 10) used to put on the screen. Written out by
 *  hand, not computed, so this test cannot agree with the bug by reusing the
 *  bug's own helper. The two guards in the first test pin it to ADDRESS_1. */
const SHORTENED_1 = 'bcrt1qw3kf...s3jn54khcm'

/** A second destination. This one never appeared in full anywhere. */
const ADDRESS_2 = 'bcrt1q9y8xt2vd0swjn354khce6mua7lqpzry9x8gf2tvdw0s3jn54khcezgr4'
/** The change output, coming back to the escrow. Also never shown in full. */
const ADDRESS_3 = 'bcrt1qm7ua6echkzgf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jnwt'

const writeText = vi.fn()

/**
 * The inputs are a parameter, not a figure derived from the outputs. They used
 * to be `inputValues: [totalInputValue]` with `inputCount` hard coded to 1, so
 * the input side of every fixture was the output side plus a fee, and the fee
 * block could not be asked anything the fixture had not already agreed to.
 * ReviewSignStep draws no inputs table, but it does total them, and the fee
 * block test below hands it two unequal inputs summing to a figure no output
 * on the screen carries.
 */
function analysisWith(
  outputs: PsbtAnalysis['outputs'],
  inputValues: (number | null)[] = [outputs.reduce((sum, o) => sum + o.value, 0) + 1_000],
): PsbtAnalysis {
  const totalOutputValue = outputs.reduce((sum, o) => sum + o.value, 0)
  const totalInputValue = inputValues.reduce<number>((sum, v) => sum + (v ?? 0), 0)
  return {
    inputCount: inputValues.length,
    outputCount: outputs.length,
    totalInputValue,
    totalOutputValue,
    fee: totalInputValue - totalOutputValue,
    feeRate: 2,
    outputs,
    inputValues,
    signatureCount: inputValues.map(() => 0),
    isFullySigned: false,
    requiredSignatures: 2,
  }
}

function renderStep(outputs: PsbtAnalysis['outputs'], inputValues?: (number | null)[]) {
  return render(
    <ReviewSignStep
      analysis={analysisWith(outputs, inputValues)}
      error={null}
      onSign={vi.fn()}
      onBack={vi.fn()}
    />,
  )
}

/**
 * The address cells of the outputs table. Scoped to <code>, which is what the
 * table rows draw: the summary above the table prints the first destination in
 * a <p>, so a screen-wide text query would report that one too.
 */
function addressCells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('code'))
}

/** The accessible name of every copy control on the screen, in order. */
function copyButtonNames(): string[] {
  return screen
    .getAllByRole('button', { name: /copy/i })
    .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
}

/**
 * The summary panel above the outputs table, found through its own "Sending"
 * heading. Scoped deliberately: the table below repeats the destination's
 * amount, so a screen-wide substring check cannot tell which of the two it
 * matched.
 */
function summaryPanel(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll('p')).find(
    (el) => el.textContent === 'Sending',
  )
  if (!heading) throw new Error('the screen renders no Sending summary')
  return heading.parentElement!
}

/**
 * The two amount lines the summary leads with: the large BTC figure directly
 * under the "Sending" heading, and the sats restatement under that. Read by
 * position rather than by class, so this does not pin the type scale.
 */
function summaryAmounts(container: HTMLElement): { btc: string; sats: string } {
  const heading = Array.from(container.querySelectorAll('p')).find(
    (el) => el.textContent === 'Sending',
  )
  if (!heading) throw new Error('the screen renders no Sending summary')
  const btc = heading.nextElementSibling
  const sats = btc?.nextElementSibling
  if (!btc || !sats) throw new Error('the Sending heading stands over nothing')
  return { btc: btc.textContent ?? '', sats: sats.textContent ?? '' }
}

const ONE: PsbtAnalysis['outputs'] = [{ address: ADDRESS_1, value: 250_000, isChange: false }]

const TWO: PsbtAnalysis['outputs'] = [
  { address: ADDRESS_1, value: 250_000, isChange: false },
  { address: ADDRESS_3, value: 40_000, isChange: true },
]

const THREE: PsbtAnalysis['outputs'] = [
  { address: ADDRESS_1, value: 250_000, isChange: false },
  { address: ADDRESS_2, value: 125_000, isChange: false },
  { address: ADDRESS_3, value: 40_000, isChange: true },
]

/**
 * The same two outputs as TWO, in the other order. The builder this screen is
 * fed by adds destinations before change, so today outputs[0] and the first
 * non-change output happen to be the same row. Nothing about a PSBT holds that
 * ordering: a wallet that sorts its outputs, BIP 69 among them, can put change
 * first, and then reading outputs[0] announces the change address as the
 * destination.
 */
const CHANGE_FIRST: PsbtAnalysis['outputs'] = [
  { address: ADDRESS_3, value: 40_000, isChange: true },
  { address: ADDRESS_1, value: 250_000, isChange: false },
]

/**
 * What the summary must read, and the two figures it must not.
 *
 * TWO sends 250,000 sats to ADDRESS_1 and returns 40,000 as change, so the
 * destination's own value, the change, and the sum of every output are three
 * different numbers. That is the only way a test can tell which of them the
 * screen read. These literals are written out rather than run through
 * formatBtc, so this file does not agree with the component by calling the
 * helper the component calls; the guards in the first test below tie them back
 * to the fixture.
 */
const DESTINATION_BTC = '0.00250000'
const DESTINATION_SATS = '250,000'
const CHANGE_SATS = '40,000'
const TOTAL_BTC = '0.00290000'
const TOTAL_SATS = '290,000'

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
})

describe('Review Transaction: the outputs table', () => {
  it('shows the address in full, and no longer the shortened form', () => {
    // The shortened literal really is this address head-and-tail, so the
    // absence assertion below is about THIS address and not about a string
    // that could never have appeared anyway.
    expect(ADDRESS_1.startsWith('bcrt1qw3kf')).toBe(true)
    expect(ADDRESS_1.endsWith('s3jn54khcm')).toBe(true)
    expect(SHORTENED_1.length).toBeLessThan(ADDRESS_1.length)
    expect(ADDRESS_1.length).toBeGreaterThan(50)

    const { container } = renderStep(ONE)

    // Positive partner: the row is on the screen, character for character. If
    // the cell vanished entirely this fails, so the absence assertion that
    // follows can never pass by the row simply not rendering.
    const cells = addressCells(container)
    expect(cells).toHaveLength(1)
    expect(cells[0]!.textContent).toBe(ADDRESS_1)

    // The shortened form is gone.
    expect(screen.queryByText(SHORTENED_1)).toBeNull()
    expect(container.textContent).not.toContain(SHORTENED_1)
    expect(container.textContent).not.toContain('...')
  })

  it('renders in a monospace cell that wraps instead of overflowing', () => {
    const { container } = renderStep(ONE)

    const cells = addressCells(container)
    // Positive partner for the class assertions: the cell exists at all.
    expect(cells).toHaveLength(1)
    const cell = cells[0]!
    expect(cell.textContent).toBe(ADDRESS_1)
    expect(cell.className).toContain('font-mono')
    // break-all is what lets a 60-character unbroken string wrap inside its
    // container rather than push the page sideways at 320px.
    expect(cell.className).toContain('break-all')
    // The old cell shortened the string and then relied on CSS to clip what
    // was left. Nothing may clip it now.
    expect(cell.className).not.toContain('truncate')
  })

  it('keeps the summary above the table showing the first destination in full', () => {
    // The mitigation that was already there. The table now shows the same
    // address too, so this pins the summary against being dropped as
    // duplicated: it is the large semibold copy a customer actually reads.
    const { container } = renderStep(TWO)

    expect(screen.getByText('To')).toBeTruthy()
    const summary = Array.from(container.querySelectorAll('p')).find(
      (el) => el.textContent === ADDRESS_1,
    )
    expect(summary).toBeTruthy()
    expect(summary!.className).toContain('font-semibold')
    expect(summary!.className).toContain('break-all')
    expect(summary!.className).not.toContain('truncate')
  })
})

describe('Review Transaction: the amount in the summary', () => {
  /**
   * The figure this pins is the largest thing on the screen, 2xl semibold, and
   * it sits directly above a checkbox reading "I have verified the destination
   * address and amount shown above". The address beside it was pinned and the
   * amount was not, so the summary could read the sum of every output instead
   * of the destination's own value and nothing failed. On any transaction with
   * change that shows the customer destination plus change as the amount being
   * sent, disagreeing with the table immediately below it, and asks them to
   * confirm it.
   */
  it('leads with the destination amount, never the sum of every output', () => {
    // The fixture has to be able to tell the two apart. A 40,000 sat change
    // output puts 40,000 between the destination and the total, so a summary
    // reading the total shows a different number rather than the right one by
    // luck.
    expect(TWO[0]!.value).toBe(250_000)
    expect(TWO.reduce((sum, o) => sum + o.value, 0)).toBe(290_000)
    expect(TWO[0]!.value).not.toBe(TWO.reduce((sum, o) => sum + o.value, 0))

    const { container } = renderStep(TWO)
    const { btc, sats } = summaryAmounts(container)

    // Positive partner: the summary prints the destination's own amount in
    // both units, so the absences below cannot pass on an empty panel.
    expect(btc).toBe(`${DESTINATION_BTC} BTC`)
    expect(sats).toBe(`${DESTINATION_SATS} sats`)

    // And the total appears nowhere in the panel, in either unit.
    expect(summaryPanel(container).textContent).not.toContain(TOTAL_BTC)
    expect(summaryPanel(container).textContent).not.toContain(TOTAL_SATS)

    // The total is genuinely on the screen, in the fee block where it belongs,
    // so the absence above is about the summary and not about a figure the
    // component never renders at all.
    expect(container.textContent).toContain(TOTAL_BTC)
  })

  it('reads the first destination even when the change output comes first', () => {
    // Latent while the builder emits destinations first. The filter that makes
    // it safe is one word, and deleting it costs nothing today, which is
    // exactly why it needs a guard before an output ordering changes under it.
    expect(CHANGE_FIRST[0]!.isChange).toBe(true)
    expect(CHANGE_FIRST[1]!.isChange).toBe(false)

    const { container } = renderStep(CHANGE_FIRST)
    const { btc, sats } = summaryAmounts(container)
    const panel = summaryPanel(container)

    // Positive partners: the summary names the destination and its amount.
    expect(btc).toBe(`${DESTINATION_BTC} BTC`)
    expect(sats).toBe(`${DESTINATION_SATS} sats`)
    expect(panel.textContent).toContain(ADDRESS_1)

    // Not the change output, which is what outputs[0] holds here. Announcing
    // change as the destination tells the customer their Bitcoin is going to
    // an address it is in fact coming back from.
    expect(panel.textContent).not.toContain(ADDRESS_3)
    expect(panel.textContent).not.toContain(CHANGE_SATS)
  })
})

describe('Review Transaction: the fee block', () => {
  /**
   * The inputs are the one part of this screen the outputs cannot imply. Two
   * unequal inputs sum to a figure that appears nowhere else on the screen, so
   * the Total Input row has to have read them rather than the output side.
   */
  it('totals the inputs the PSBT carries, and charges the difference as the fee', () => {
    const { container } = renderStep(TWO, [100_001, 200_000])

    // Positive partners: all three rows are labelled and carry a figure.
    const totalInput = screen.getByText('Total Input').nextElementSibling
    const totalOutput = screen.getByText('Total Output').nextElementSibling
    const fee = screen.getByText('Network Fee').nextElementSibling
    expect(totalInput?.textContent).toBe('0.00300001 BTC')
    expect(totalOutput?.textContent).toBe(`${TOTAL_BTC} BTC`)
    expect(fee?.textContent).toContain('10,001 sats')

    // The output side does not stand in for the input side. 0.00291000 is what
    // the old fixture would have made the inputs: the outputs plus a fee.
    expect(totalInput?.textContent).not.toBe(`${TOTAL_BTC} BTC`)
    expect(container.textContent).not.toContain('0.00291000')
  })
})

describe('Review Transaction: more than one output', () => {
  it('shows every address in full, none of them shortened', () => {
    const { container } = renderStep(THREE)

    const cells = addressCells(container)
    // Positive partner: three cells, one per output.
    expect(cells).toHaveLength(3)
    expect(cells.map((c) => c.textContent)).toEqual([ADDRESS_1, ADDRESS_2, ADDRESS_3])
    // No cell carries an ellipsis, whichever address it holds.
    for (const cell of cells) {
      expect(cell.textContent).not.toContain('...')
    }
    // The change output keeps its badge next to the full address.
    expect(screen.getByText('change')).toBeTruthy()
  })

  /**
   * The badge had no test of its own. Its only cover was one assertion parked
   * at the end of the truncation test above, so relaxing that test, which is
   * about address length and says so in its name, would have deleted the
   * change badge's only guard without anyone noticing.
   */
  it('badges the change output, and only the change output', () => {
    const { container } = renderStep(THREE)

    // Positive partner: three rows, so the count below is out of three and not
    // out of a table that failed to render.
    const cells = addressCells(container)
    expect(cells).toHaveLength(3)

    const badges = Array.from(container.querySelectorAll('span')).filter(
      (el) => el.textContent === 'change',
    )
    // Exactly one badge, and it sits in the row holding the change address
    // rather than beside either destination.
    expect(badges).toHaveLength(1)
    expect(badges[0]!.parentElement!.querySelector('code')!.textContent).toBe(ADDRESS_3)
  })

  it('shows the second destination in full, which nothing else on the screen does', () => {
    // ADDRESS_2 is the case the summary above the table never covered: it
    // shows the FIRST destination only, so before this fix the second one was
    // head-and-tail on the screen and nowhere else.
    const { container } = renderStep(THREE)

    expect(screen.getByText(ADDRESS_2).textContent).toBe(ADDRESS_2)
    expect(screen.getByText(ADDRESS_3).textContent).toBe(ADDRESS_3)
    // Positive partner already made above; these pin the two rows the summary
    // does not duplicate.
    expect(container.textContent).toContain(ADDRESS_2)
    expect(container.textContent).toContain(ADDRESS_3)
    expect(container.textContent).not.toContain('...')
  })

  it('gives each output its own copy control, copying that output', async () => {
    renderStep(THREE)

    const buttons = screen.getAllByRole('button', { name: /copy/i })
    // Positive partner: one control per output, not one for the screen.
    expect(buttons).toHaveLength(3)

    fireEvent.click(buttons[1]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    // The middle button copies the MIDDLE address, not the first one.
    expect(writeText).toHaveBeenCalledWith(ADDRESS_2)
    expect(writeText).not.toHaveBeenCalledWith(ADDRESS_1)

    fireEvent.click(buttons[2]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText).toHaveBeenLastCalledWith(ADDRESS_3)
  })

  it('copies the whole address, not the form the row used to display', async () => {
    renderStep(TWO)

    const buttons = screen.getAllByRole('button', { name: /copy/i })
    expect(buttons).toHaveLength(2)

    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(ADDRESS_1)
    expect(writeText.mock.calls[0]![0]).not.toBe(SHORTENED_1)
  })
})

describe('Review Transaction: an output with no address', () => {
  /**
   * analyzePsbt hands over null when the output script decodes to no address:
   * an OP_RETURN, or any other non standard script. This screen used to draw
   * the literal 'Unknown' in the address cell and put a copy control beside it
   * named "Copy destination address", so a customer copied the seven character
   * word Unknown, pasted it into a block explorer, got nothing back, and could
   * not tell whether the tool had failed or the address was bad.
   */
  it('shows Unknown with no copy control, and keeps the row and its amount', async () => {
    const { container } = renderStep([
      { address: ADDRESS_1, value: 250_000, isChange: false },
      { address: null, value: 3_000, isChange: false },
    ])

    // Positive partners: the decodable output keeps its cell and its named
    // control, so the absences below cannot pass on a screen rendering
    // nothing at all.
    // Read through addressCells, not getByText: the summary above the table
    // prints this same address in a <p>, so a screen-wide query matches twice.
    expect(addressCells(container)).toHaveLength(1)
    expect(addressCells(container)[0]!.textContent).toBe(ADDRESS_1)
    const buttons = screen.getAllByRole('button', { name: /copy/i })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.getAttribute('aria-label')).toBe(
      'Copy destination address, output 1 of 2',
    )

    // Nothing offers to copy the second output, under that name or any other.
    expect(screen.queryByRole('button', { name: /output 2 of 2/i })).toBeNull()

    // The row survives and still carries its amount: the customer has to see
    // that a second output exists.
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(container.textContent).toContain('3,000 sats')

    // And the one control there is copies the address it names, never the
    // placeholder word.
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(ADDRESS_1)
    expect(writeText).not.toHaveBeenCalledWith('Unknown')
  })

  it('says Unknown in the summary rather than leaving To standing over a blank', () => {
    // The first destination is the undecodable one, so it is what the large
    // "Sending ... To" summary above the table reads from.
    const { container } = renderStep([{ address: null, value: 3_000, isChange: false }])

    // Positive partners: the summary block is still rendered, headings and
    // amount and all, so the assertion on its value cannot pass by the whole
    // block disappearing.
    expect(screen.getByText('Sending')).toBeTruthy()
    expect(container.textContent).toContain('3,000 sats')
    const heading = Array.from(container.querySelectorAll('p')).find(
      (el) => el.textContent === 'To',
    )
    expect(heading).toBeTruthy()

    const value = heading!.nextElementSibling
    expect(value).toBeTruthy()
    expect(value!.textContent).toBe('Unknown')
    // Not dressed up as an address the customer could read off and check.
    expect(value!.className).not.toContain('font-mono')
    // And no copy control anywhere on a screen whose only output has no
    // address to copy.
    expect(screen.queryAllByRole('button', { name: /copy/i })).toHaveLength(0)
  })
})

describe('Review Transaction: telling the copy controls apart', () => {
  it('gives each one an accessible name naming the output it copies', () => {
    renderStep(THREE)

    const names = copyButtonNames()
    // Positive partner: three names, and every one of them is a real string.
    expect(names).toHaveLength(3)
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0)
    }

    // Each names its own row, so a screen reader no longer hears "Copy" three
    // times over with nothing to say which is which.
    expect(names[0]).toBe('Copy destination address, output 1 of 3')
    expect(names[1]).toBe('Copy destination address, output 2 of 3')
    expect(names[2]).toBe('Copy change address, output 3 of 3')
    expect(new Set(names).size).toBe(3)
  })

  it('renders as a bare icon control, not a call to action', () => {
    renderStep(THREE)

    const buttons = screen.getAllByRole('button', { name: /copy/i })
    // Positive partner: three controls, and each really draws an icon. If they
    // stopped rendering the absence assertions below could not fail.
    expect(buttons).toHaveLength(3)

    for (const button of buttons) {
      expect(button.querySelector('svg')).toBeTruthy()
      // The accessible name is the ONLY name now: no visible text is left, so
      // an unnamed control would announce as nothing but "button".
      expect(button.getAttribute('aria-label')).toBeTruthy()
      expect(button.textContent).toBe('')
      // None of the call to action styling. Beside a 62 character address a
      // full orange button is wider than the address can spare, which is what
      // squeezed the change row to a few characters per line.
      expect(button.className).toContain('text-muted-foreground')
      expect(button.className).not.toContain('btn-primary')
      expect(button.className).not.toContain('px-5')
    }
  })

  it('names a single-destination screen the same way', () => {
    renderStep(ONE)

    const names = copyButtonNames()
    expect(names).toHaveLength(1)
    expect(names[0]).toBe('Copy destination address, output 1 of 1')
  })
})
