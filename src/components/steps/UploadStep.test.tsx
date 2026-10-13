/**
 * The upload screen's explanation of what the recovery file is. The file holds
 * the loan's public details and, for a password key, the salt. It holds no
 * password and no private key, so the copy must not describe it as encrypted
 * key material.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { UploadStep } from './UploadStep'

afterEach(cleanup)

describe('UploadStep recovery file explanation', () => {
  it('describes where the file comes from and what it holds', () => {
    const { container } = render(<UploadStep onFileLoaded={() => {}} />)

    const paragraph = screen.getByText('What is the recovery file?').nextElementSibling

    expect(paragraph?.tagName).toBe('P')
    expect(paragraph?.textContent).toBe(
      "This is the .json file you downloaded from your loan page in BTCBacked, or through the link in the email you received when your collateral was secured. It holds your loan's public details and, for a password key, the salt. It holds no password or private key. Check your Downloads folder or wherever you saved it.",
    )
    expect(paragraph?.querySelector('code')?.textContent).toBe('.json')
    expect(container.textContent).not.toMatch(/encrypted/i)
  })
})
