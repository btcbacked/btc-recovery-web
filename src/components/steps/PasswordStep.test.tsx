// The eye button turns the password field into a text input, and a phone
// keyboard capitalises and autocorrects a text input. These pin the four
// attributes that stop it, revealed as well as obscured.
// autoComplete stays off because a saved site credential is never this password.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PasswordStep } from './PasswordStep'

afterEach(cleanup)

const GUARD = {
  spellcheck: 'false',
  autocorrect: 'off',
  autocapitalize: 'off',
  autocomplete: 'off',
} as const

const guardOf = (field: HTMLInputElement) =>
  Object.fromEntries(
    Object.keys(GUARD).map((name) => [name, field.getAttribute(name)]),
  )

function renderStep() {
  render(<PasswordStep onSubmit={() => {}} onBack={() => {}} />)
  const field = document.querySelector<HTMLInputElement>('input')
  // Guard: a selector matching nothing would let every assertion below pass.
  expect(field).not.toBeNull()
  return field as HTMLInputElement
}

describe('PasswordStep: iOS must not rewrite the recovery password', () => {
  it('carries all four while the password is obscured', () => {
    const field = renderStep()

    expect(field.type).toBe('password')
    expect(guardOf(field)).toEqual(GUARD)
  })

  it('still carries all four once the eye has been tapped', () => {
    const field = renderStep()
    fireEvent.click(screen.getByLabelText('Show password'))

    expect(field.type).toBe('text')
    expect(guardOf(field)).toEqual(GUARD)
  })

  it('keeps autoComplete off rather than asking for a stored credential', () => {
    const field = renderStep()

    expect(field.getAttribute('autocomplete')).toBe('off')
  })
})
