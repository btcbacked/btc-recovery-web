import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import indexHtml from '../index.html?raw'
import { SecurityBadge } from './components/SecurityBadge'
import { PasswordStep } from './components/steps/PasswordStep'

/**
 * The privacy copy says what the tool sends and to whom. The tool contacts
 * mempool.space for the escrow balance, the fee rates and the broadcast, so no
 * text may claim that nothing leaves the browser.
 */

const BADGE = 'Runs locally. Your keys never leave your browser.'
const JS_SENTENCE = 'JavaScript is required to run the BTCBacked Key Recovery Tool.'
const NOSCRIPT =
  'All cryptographic operations run locally in your browser. Your password and keys are never sent anywhere. The tool only contacts mempool.space, to read the escrow balance and fee rates and to send the payment.'
const PASSWORD_NOTE = 'Your password never leaves this device.'

const OLD_CLAIMS = /no data (is ever sent|leaves)|sent to a server|all operations happen locally/i

// Every non-test script of the app, as text.
const APP_SOURCES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

afterEach(() => {
  cleanup()
})

describe('privacy copy', () => {
  it('the badge reads exactly the new sentence', () => {
    render(<SecurityBadge />)
    expect(screen.getByRole('note').textContent).toBe(BADGE)
  })

  it('the badge sets its font size to --text-body-sm, not its colour', () => {
    render(<SecurityBadge />)
    const { className } = screen.getByRole('note')
    expect(className.split(/\s+/)).toContain('text-[length:var(--text-body-sm)]')
    expect(className).not.toContain('text-[var(--text-body-sm)]')
  })

  it('the noscript text reads exactly the JavaScript sentence and the new sentence', () => {
    const m = indexHtml.match(/<noscript>([\s\S]*?)<\/noscript>/)
    const text = m?.[1]
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    expect(text).toBe(JS_SENTENCE + ' ' + NOSCRIPT)
  })

  it('the note under the password box reads exactly the new sentence', () => {
    render(<PasswordStep onSubmit={() => {}} onBack={() => {}} />)
    expect(screen.getByText(PASSWORD_NOTE).parentElement?.textContent).toBe(PASSWORD_NOTE)
  })

  it('scans the real sources, SecurityBadge.tsx and PasswordStep.tsx included', () => {
    expect(APP_SOURCES['./components/SecurityBadge.tsx']).toContain('role="note"')
    expect(APP_SOURCES['./components/steps/PasswordStep.tsx']).toContain('type="submit"')
    expect(Object.keys(APP_SOURCES).filter((file) => !APP_SOURCES[file])).toEqual([])
  })

  it('no shipped file repeats the old claims', () => {
    const files: [file: string, source: string][] = [
      ['index.html', indexHtml],
      ...Object.entries(APP_SOURCES),
    ]
    expect(files.filter(([, source]) => OLD_CLAIMS.test(source)).map(([file]) => file)).toEqual(
      [],
    )
  })
})
