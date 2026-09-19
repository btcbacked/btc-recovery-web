/**
 * What the Recover button will and will not accept.
 *
 * An escrow password is whatever the customer typed when they set their
 * contract up, and the apps that set one ask only that it be long enough.
 * A password made entirely of spaces is therefore one somebody can be holding
 * today, and this screen has to open for them. So the button opens on anything
 * at all in the field, and closes only on a field with nothing in it.
 *
 * The value is then handed on exactly as it was typed. Nothing here may strip
 * the ends of it, because the password that opens the file is the one that was
 * chosen, spaces included, and a shortened copy is simply a different password.
 * The first test below pins the whole string arriving at `onSubmit` rather than
 * only that the button could be clicked, so a trim added later fails here.
 *
 * The second test submits the form itself instead of clicking the button, so
 * the empty case is pinned on the handler as well as on the disabled state.
 * Checking the button alone would leave the keyboard route to submitting an
 * empty field untested.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PasswordStep } from './PasswordStep'

afterEach(cleanup)

/** Eight spaces: long enough to have been accepted, and nothing but spaces. */
const ALL_SPACES = '        '

function renderStep() {
  const onSubmit = vi.fn()
  const { container } = render(
    <PasswordStep onSubmit={onSubmit} onBack={() => {}} />,
  )
  const field = container.querySelector('input')
  const form = container.querySelector('form')
  // Guard: selectors matching nothing would let every assertion below pass.
  expect(field).not.toBeNull()
  expect(form).not.toBeNull()
  return {
    onSubmit,
    field: field as HTMLInputElement,
    form: form as HTMLFormElement,
    button: screen.getByRole('button', { name: 'Recover Key' }) as HTMLButtonElement,
  }
}

describe('PasswordStep: a password of spaces is still a password', () => {
  it('lets an all whitespace password through, character for character', () => {
    const { onSubmit, field, button } = renderStep()

    fireEvent.change(field, { target: { value: ALL_SPACES } })
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(ALL_SPACES)
  })

  it('keeps a password with spaces around it whole', () => {
    const { onSubmit, field, button } = renderStep()

    fireEvent.change(field, { target: { value: '  correct horse  ' } })
    fireEvent.click(button)

    expect(onSubmit).toHaveBeenCalledWith('  correct horse  ')
  })

  it('still refuses an empty field, by button and by form', () => {
    const { onSubmit, button, form } = renderStep()

    expect(button.disabled).toBe(true)

    fireEvent.submit(form)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
