/**
 * The Review Imported PSBT screen: the last thing a customer sees before they
 * add a signature to somebody else's transaction.
 *
 * WHY THE WHOLE ADDRESS. The screen tells the customer, in its own words, to
 * "Confirm the destination address and amount are correct". It used to render
 * that address through truncateHash(address, 10), so what it actually showed
 * was the first ten and the last ten characters. An attacker who substitutes a
 * destination can grind a vanity key that matches on exactly those characters,
 * which is the one attack this screen exists to catch, so the shortened form
 * satisfied the instruction and defeated it at the same time. It now renders
 * the complete string, wrapped, with the shared CopyButton beside it so the
 * customer can paste it somewhere else and compare.
 *
 * WHY THE FIXTURE ADDRESSES ARE FULL LENGTH. A short stub would render
 * identically whether or not the component truncates, so a truncation
 * regression would sail through. These are 60-plus character bech32 strings,
 * and the head and tail guards below pin the shortened literal this test
 * asserts is gone, so the literal is not derived from the same helper the
 * component used to call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ReviewPsbtStep } from './ReviewPsbtStep'
import type { PsbtAnalysis } from '@/crypto/psbt-finalizer'

/** The destination. Full length, so truncation is observable. */
const ADDRESS_1 = 'bcrt1q8uaaf4z0hgm7v3xq2ncdl5r8ytk6wpj9sedu4a2h0zxq7n83aevcvces'
/** What truncateHash(ADDRESS_1, 10) used to put on the screen. Written out by
 *  hand, not computed, so this test does not agree with the bug by reusing the
 *  bug's own helper. The two guards in the first test pin it to ADDRESS_1. */
const SHORTENED_1 = 'bcrt1q8uaa...83aevcvces'

const ADDRESS_2 = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4mzp2xn9rl6hqk4wrxu'
const ADDRESS_3 = 'bcrt1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv'

const writeText = vi.fn()

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
    signatureCount: inputValues.map(() => 1),
    isFullySigned: false,
    requiredSignatures: 2,
  }
}

function renderStep(outputs: PsbtAnalysis['outputs'], inputValues?: (number | null)[]) {
  return render(
    <ReviewPsbtStep
      analysis={analysisWith(outputs, inputValues)}
      onSign={vi.fn()}
      onBack={vi.fn()}
    />,
  )
}

/** Every <code> the screen renders. The addresses are the only ones on it. */
function addressCells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('code'))
}

/** The accessible name of every copy control on the screen, in order. */
function copyButtonNames(): string[] {
  return screen
    .getAllByRole('button', { name: /copy/i })
    .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
}

/** Two destinations and a change output. */
const THREE: PsbtAnalysis['outputs'] = [
  { address: ADDRESS_1, value: 250_000, isChange: false },
  { address: ADDRESS_2, value: 125_000, isChange: false },
  { address: ADDRESS_3, value: 40_000, isChange: true },
]

/**
 * The text of each row in the Inputs section, in order. Scoped deliberately:
 * the fee block further down the screen also renders sat figures, so a
 * container-wide substring check there would report the wrong element.
 */
function inputRows(container: HTMLElement): string[] {
  const label = Array.from(container.querySelectorAll('p')).find((el) =>
    (el.textContent ?? '').startsWith('Inputs ('),
  )
  if (!label) throw new Error('the screen renders no inputs section')
  const table = label.nextElementSibling
  if (!table) throw new Error('the inputs section renders no rows')
  return Array.from(table.children).map((row) => row.textContent ?? '')
}

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

describe('Review Imported PSBT: the destination address', () => {
  it('shows the address in full, and no longer the shortened form', () => {
    // The shortened literal really is this address head-and-tail, so the
    // absence assertion below is about THIS address and not about a string
    // that could never have appeared anyway.
    expect(ADDRESS_1.startsWith('bcrt1q8uaa')).toBe(true)
    expect(ADDRESS_1.endsWith('83aevcvces')).toBe(true)
    expect(SHORTENED_1.length).toBeLessThan(ADDRESS_1.length)
    expect(ADDRESS_1.length).toBeGreaterThan(50)

    const { container } = renderStep([
      { address: ADDRESS_1, value: 250_000, isChange: false },
    ])

    // Positive partner: the address is on the screen, character for character.
    // If the element vanished entirely this fails, so the absence assertion
    // that follows can never pass by the row simply not rendering.
    const cell = screen.getByText(ADDRESS_1)
    expect(cell.textContent).toBe(ADDRESS_1)

    // The shortened form is gone.
    expect(screen.queryByText(SHORTENED_1)).toBeNull()
    expect(container.textContent).not.toContain(SHORTENED_1)
    expect(container.textContent).not.toContain('...')
  })

  it('renders in a monospace cell that wraps instead of overflowing', () => {
    const { container } = renderStep([
      { address: ADDRESS_1, value: 250_000, isChange: false },
    ])

    const cells = addressCells(container)
    // Positive partner for the class assertions: the cell exists at all.
    expect(cells).toHaveLength(1)
    const cell = cells[0]!
    expect(cell.textContent).toBe(ADDRESS_1)
    expect(cell.className).toContain('font-mono')
    // break-all is what lets a 60-character unbroken string wrap inside its
    // container rather than push the page sideways.
    expect(cell.className).toContain('break-all')
    // The old cell relied on CSS clipping. Nothing may clip it now.
    expect(cell.className).not.toContain('truncate')
  })

  it('carries a copy control holding the full address, not the shortened one', async () => {
    renderStep([{ address: ADDRESS_1, value: 250_000, isChange: false }])

    const copy = screen.getByRole('button', { name: /copy/i })
    fireEvent.click(copy)

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(ADDRESS_1)
    // What went to the clipboard is the whole thing, not the display form.
    expect(writeText.mock.calls[0]![0]).not.toBe(SHORTENED_1)
  })
})

describe('Review Imported PSBT: more than one output', () => {
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
    expect(screen.getByText(ADDRESS_2).textContent).toBe(ADDRESS_2)
    expect(screen.getByText(ADDRESS_3).textContent).toBe(ADDRESS_3)
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
})

describe('Review Imported PSBT: telling the copy controls apart', () => {
  /**
   * The sibling screen pins this and this one did not. Both files render the
   * same expression, so a fixed "Copy destination address" here left the whole
   * suite green while telling a customer reading by ear that the change output
   * is a destination. Change against destination is the one distinction this
   * table draws, and the badge that draws it visually is not in the accessible
   * name unless this expression puts it there.
   */
  it('names the change output as change, not as another destination', () => {
    renderStep(THREE)

    const names = copyButtonNames()
    // Positive partner: three names, and every one of them is a real string.
    expect(names).toHaveLength(3)
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0)
    }

    // Each names its own row, and the third says which kind of output it is.
    expect(names[0]).toBe('Copy destination address, output 1 of 3')
    expect(names[1]).toBe('Copy destination address, output 2 of 3')
    expect(names[2]).toBe('Copy change address, output 3 of 3')
    expect(new Set(names).size).toBe(3)
  })
})

describe('Review Imported PSBT: an output with no address', () => {
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
    expect(addressCells(container)).toHaveLength(1)
    expect(screen.getByText(ADDRESS_1).textContent).toBe(ADDRESS_1)
    const buttons = screen.getAllByRole('button', { name: /copy/i })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.getAttribute('aria-label')).toBe(
      'Copy destination address, output 1 of 2',
    )

    // Nothing offers to copy the second output, under that name or any other.
    expect(screen.queryByRole('button', { name: /output 2 of 2/i })).toBeNull()

    // The row survives and still carries its amount: the customer has to see
    // that a second output exists.
    expect(screen.getByText('Outputs (2)')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(container.textContent).toContain('3,000 sats')

    // And the one control there is copies the address it names, never the
    // placeholder word.
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(ADDRESS_1)
    expect(writeText).not.toHaveBeenCalledWith('Unknown')
  })
})

describe('Review Imported PSBT: the inputs section', () => {
  it('names its inputs by position and shows no address for them', () => {
    const { container } = renderStep([
      { address: ADDRESS_1, value: 250_000, isChange: false },
    ])

    // Positive partner: the inputs section is rendered and labelled.
    expect(screen.getByText('Inputs (1)')).toBeTruthy()
    expect(screen.getByText('Input 1')).toBeTruthy()
    // The only address cell on the screen belongs to the output, so the inputs
    // section carries no address to give the same treatment to.
    expect(addressCells(container)).toHaveLength(1)
  })

  /**
   * Each row used to render totalInputValue / inputCount, which is the same
   * average on every row. Two unequal inputs made that visible: both rows read
   * a value neither input has, carrying a fraction of a satoshi.
   */
  it('gives each input its own value, not the average of all of them', () => {
    const { container } = renderStep(
      [{ address: ADDRESS_1, value: 149_001, isChange: false }],
      [100_001, 50_000],
    )

    // Positive partner: two rows, each carrying its own figure. If the rows
    // stopped rendering these fail, so the absence assertions below cannot
    // pass on an empty section.
    expect(screen.getByText('Inputs (2)')).toBeTruthy()
    const rows = inputRows(container)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('100,001 sats')
    expect(rows[1]).toContain('50,000 sats')

    // The average of 100,001 and 50,000 is 75,000.5. It is on no row now, and
    // satoshis have no fractional part to begin with.
    for (const row of rows) {
      expect(row).not.toContain('75,000.5')
      expect(row).not.toContain('.5 sats')
    }
  })

  it('says Unknown for an input whose value the PSBT does not carry', () => {
    const { container } = renderStep(
      [{ address: ADDRESS_1, value: 99_001, isChange: false }],
      [100_001, null],
    )

    // Positive partner: the known input still reports its own value, so this
    // test fails if the section stops rendering rather than passing silently.
    const rows = inputRows(container)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('100,001 sats')

    // The input the PSBT carries no value for says so.
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(rows[1]).toContain('Unknown')
    // Not a confident zero, and no sat figure at all on that row.
    expect(rows[1]).not.toContain('sats')
    expect(rows[1]).not.toContain('0 sats')
    // Nor the old average, which for this fixture would have been 50,000.5.
    expect(rows[0]).not.toContain('50,000.5')
    expect(rows[1]).not.toContain('50,000.5')
  })
})
