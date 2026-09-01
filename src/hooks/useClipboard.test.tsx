/**
 * useClipboard, both ways it can end.
 *
 * WHY THIS FILE EXISTS. The failure path had no test at all. Deleting the
 * `toast.error(...)` out of the catch left all 968 tests green, which is how a
 * silent failure could have shipped: a customer clicks copy on the screen
 * before an irreversible signature, the write is refused, and nothing on the
 * page says so. They paste whatever was on the clipboard before.
 *
 * This is also the channel CopyButton now relies on for its announcement, after
 * the duplicate live region inside the button was removed, so the toast has to
 * be pinned on both paths rather than assumed.
 *
 * The messages are written out by hand here rather than imported from the hook,
 * so a test cannot agree with a change to the copy by construction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { Toaster } from 'sonner'
import { useClipboard } from './useClipboard'

const SUCCESS = 'Copied to clipboard'
const FAILURE = 'Failed to copy to clipboard'
const PAYLOAD = 'bcrt1qw3kf7v9x2ta5m0dqs8h4jn6ce2ua7lgzp5ry9x8gf2tvdw0s3jn54khcm'

const writeText = vi.fn()

/**
 * A probe that calls the hook the way a component does and records what it
 * returned, so the boolean the callers branch on is checked as well as the
 * toast. `result.ok` is deliberately not rendered, so nothing this component
 * draws can satisfy the message assertions below.
 */
const result: { ok: boolean | null; threw: unknown } = { ok: null, threw: null }
let runCopy: (text: string) => Promise<void>

function Probe() {
  const { copy } = useClipboard()
  runCopy = async (text: string) => {
    try {
      result.ok = await copy(text)
    } catch (e) {
      result.threw = e
    }
  }
  return null
}

/** The regions a screen reader is watching, found by the attribute that makes
 *  them announcements at all. */
function announcing(message: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-live]')).filter((r) =>
    (r.textContent ?? '').includes(message),
  )
}

/** The one region saying it, insisting there is exactly one. */
function soleAnnouncing(message: string): HTMLElement {
  const found = announcing(message)
  if (found.length !== 1) {
    throw new Error(`${found.length} live regions say ${JSON.stringify(message)}, expected 1`)
  }
  return found[0]!
}

beforeEach(() => {
  result.ok = null
  result.threw = null
  writeText.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
  render(
    <>
      <Probe />
      <Toaster position="top-center" richColors />
    </>,
  )
})

afterEach(() => {
  cleanup()
})

describe('useClipboard', () => {
  it('announces the copy and reports success when the write goes through', async () => {
    writeText.mockResolvedValue(undefined)

    // Positive partner: nothing is being announced before the call.
    expect(announcing(SUCCESS)).toHaveLength(0)

    await act(async () => {
      await runCopy(PAYLOAD)
    })

    expect(writeText).toHaveBeenCalledWith(PAYLOAD)
    expect(result.threw).toBeNull()
    expect(result.ok).toBe(true)
    await waitFor(() => expect(announcing(SUCCESS)).toHaveLength(1))
    expect(soleAnnouncing(SUCCESS).getAttribute('aria-live')).toBe('polite')
    // And it did not report the failure at the same time.
    expect(announcing(FAILURE)).toHaveLength(0)
  })

  it('announces the failure and reports it when the write is rejected', async () => {
    writeText.mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))

    // Positive partner: nothing is being announced before the call.
    expect(announcing(FAILURE)).toHaveLength(0)

    await act(async () => {
      await runCopy(PAYLOAD)
    })

    // The rejection is handled rather than left to escape into the caller.
    expect(writeText).toHaveBeenCalledWith(PAYLOAD)
    expect(result.threw).toBeNull()
    expect(result.ok).toBe(false)

    // The customer is told. This is the assertion that was missing: without it
    // the whole catch body could be emptied and the suite stayed green.
    await waitFor(() => expect(announcing(FAILURE)).toHaveLength(1))
    expect(soleAnnouncing(FAILURE).getAttribute('aria-live')).toBe('polite')

    // And it is not quietly claiming the copy worked, which is the worse of
    // the two ways this can go wrong on a screen before a signature.
    expect(announcing(SUCCESS)).toHaveLength(0)
  })
})
