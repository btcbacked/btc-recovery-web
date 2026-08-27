/**
 * The upload seam, which was untested by construction until this file existed.
 *
 * Nothing in the other 28 test files exercises a `FileReader`. Every PSBT
 * fixture in the repo is built in process by `buildTestPsbt()` from an all zero
 * seed, and `psbtFromBuffer` was only ever fed `psbtToBuffer()` output, i.e.
 * bytes this tool produced itself. The only import that was covered at all goes
 * through the paste box. The codec is well tested; the seam where the bug lived
 * was not tested at all.
 *
 * THE BUG: Sparrow saves a PSBT as RAW BINARY (magic `70 73 62 74 ff`) and this
 * step read the file with `readAsText`, so a perfectly valid signed file came
 * back as "Invalid PSBT data. Please check the input." Sparrow is the wallet
 * this tool's own guide sends people to, so in the doomsday scenario the most
 * likely combination of all failed at the last step.
 *
 * WHY EVERY ASSERTION BELOW IS ABOUT THE DECODED RESULT AND NEVER ABOUT WHICH
 * READER WAS CALLED. Measured: swapping to `readAsArrayBuffer` while leaving
 * the old `typeof result === 'string'` guard in place makes the upload do
 * NOTHING AT ALL, with no error, no file name and no change of screen, and the
 * full suite still passes 867/867. A test that asserted `readAsArrayBuffer` was
 * called would have signed that off. Asserting what comes out the other end
 * fails on the real bug and fails on that botched fix too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Buffer } from 'buffer'
import { ImportPsbtStep } from './ImportPsbtStep'
import { psbtFromBase64, psbtFromBuffer } from '@/crypto/psbt-codec'
import { RecoveryError } from '@/crypto/errors'
import {
  SPARROW_BINARY_PSBT_BASE64,
  SPARROW_BINARY_PSBT_BYTES,
} from '@/crypto/__fixtures__/sparrow-binary-psbt'

// bitcoinjs-lib expects a global Buffer, which main.tsx normally supplies.
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

/** The real bytes Sparrow wrote, rebuilt from the committed fixture. */
const SPARROW_BYTES = Buffer.from(SPARROW_BINARY_PSBT_BASE64, 'base64')

/** The same PSBT written the way every other wallet writes it. */
const SPARROW_BASE64 = SPARROW_BYTES.toString('base64')

/**
 * The routing `usePsbtWorkflow.importPsbt` performs on whatever this step
 * hands it: a string goes to `psbtFromBase64`, an ArrayBuffer to
 * `psbtFromBuffer`.
 *
 * Mirrored here in three lines rather than driving the whole wizard, so that
 * these tests fail for one reason only. The two decoders themselves are the
 * repo's real ones, imported above, so nothing about the parse is faked.
 */
function decodeAsTheWizardWould(data: string | ArrayBuffer) {
  return typeof data === 'string'
    ? psbtFromBase64(data, 'regtest')
    : psbtFromBuffer(Buffer.from(data), 'regtest')
}

/**
 * A `Buffer`'s bytes in a standalone `ArrayBuffer`.
 *
 * Copied rather than handed `.buffer` directly: Node pools small Buffers into a
 * shared allocation, so `.buffer` is usually much larger than the Buffer itself
 * and a `File` built from it would carry the whole pool.
 */
function bytesOf(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.length)
  copy.set(buffer)
  return copy.buffer
}

/** Drop a file on the step and hand back whatever `onImport` received. */
async function upload(content: ArrayBuffer | string, name = 'we.psbt') {
  const onImport = vi.fn()
  const { container } = render(
    <ImportPsbtStep error={null} onImport={onImport} onBack={() => {}} />,
  )
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('the step rendered no file input')

  const file = new File([content], name, { type: 'application/octet-stream' })
  fireEvent.change(input, { target: { files: [file] } })

  // FileReader is asynchronous, so nothing has been delivered yet.
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
  return onImport.mock.calls[0]![0] as string | ArrayBuffer
}

afterEach(cleanup)

describe('the file Sparrow actually writes', () => {
  it('is raw binary, which is the whole reason this file exists', () => {
    // The premise, asserted rather than assumed. If the fixture were ever
    // regenerated into base64 the three tests below would still pass while
    // proving nothing, because they would no longer be testing binary input.
    expect([...SPARROW_BYTES.subarray(0, 5)]).toEqual([0x70, 0x73, 0x62, 0x74, 0xff])
    expect(SPARROW_BYTES.length).toBe(SPARROW_BINARY_PSBT_BYTES)
  })

  it('reaches the decoder byte for byte', async () => {
    const delivered = await upload(bytesOf(SPARROW_BYTES))

    // Not "an ArrayBuffer was delivered", which a truncated or re-encoded read
    // would also satisfy. The bytes have to be the file's own bytes.
    expect(typeof delivered).not.toBe('string')
    expect(Buffer.from(delivered as ArrayBuffer).equals(SPARROW_BYTES)).toBe(true)
  })

  it('decodes to the very same transaction as its base64 form', async () => {
    const delivered = await upload(bytesOf(SPARROW_BYTES))

    // Compared against the base64 spelling of the SAME bytes, never against a
    // round trip through `psbt.toBase64()`. Measured: `toBase64()` does not
    // reproduce this file (the two first differ at offset 198), so a round trip
    // comparison would be asserting that the tool agrees with itself.
    expect(decodeAsTheWizardWould(delivered).toBase64()).toBe(
      psbtFromBase64(SPARROW_BASE64, 'regtest').toBase64(),
    )
  })

  it('arrives with the counterparty signature still on it', async () => {
    // What the customer came here for. The file carries one partial signature
    // from the other signer, and this tool exists to add the second.
    const psbt = decodeAsTheWizardWould(await upload(bytesOf(SPARROW_BYTES)))
    const signatures = psbt.data.inputs.reduce(
      (total, input) => total + (input.partialSig?.length ?? 0),
      0,
    )
    expect(signatures).toBe(1)
  })
})

describe('base64 files keep working, which is the other half of the fix', () => {
  it('imports a plain base64 file as text', async () => {
    const delivered = await upload(SPARROW_BASE64)

    expect(typeof delivered).toBe('string')
    expect(decodeAsTheWizardWould(delivered).toBase64()).toBe(
      psbtFromBase64(SPARROW_BASE64, 'regtest').toBase64(),
    )
  })

  it('imports a base64 file a text editor has been through', async () => {
    // A byte order mark, CRLF line endings, 64 column wrapping and a trailing
    // newline: what a base64 PSBT looks like after a round trip through Windows
    // or a mail client. The BOM is why the decoder is left at its default
    // `ignoreBOM: false`; ignoring it would leave a character base64 cannot
    // read at the front of the string.
    const body = SPARROW_BASE64.match(/.{1,64}/g)!.join('\r\n')
    const wrapped = '﻿' + body + '\r\n'
    const delivered = await upload(wrapped)

    expect(typeof delivered).toBe('string')
    // STRENGTHENED, because this test did not test what its name says. It held
    // only the two assertions around this one, and both pass with the step's
    // `.trim()` deleted: `psbtFromBase64` tolerates trailing whitespace on its
    // own, so the decode result was never evidence about the trim. This asserts
    // what the STEP handed on. The BOM is gone (the decoder strips it), the
    // trailing CRLF is gone (the trim), and the interior line breaks stay,
    // because trimming the ends is all that was asked for.
    expect(delivered).toBe(body)
    expect(delivered).not.toBe(wrapped)
    expect(decodeAsTheWizardWould(delivered).toBase64()).toBe(
      psbtFromBase64(SPARROW_BASE64, 'regtest').toBase64(),
    )
  })

  it('does not mistake a base64 file that happens to begin "psbt" for binary', async () => {
    // `p`, `s`, `b` and `t` are all valid base64 characters, so a four byte
    // sniff would route this to the binary decoder. Only the fifth byte, which
    // base64 text cannot contain, separates the two.
    const spoof = 'psbt' + SPARROW_BASE64
    expect(Buffer.from(spoof, 'utf8').toString('hex').slice(0, 8)).toBe('70736274')

    const delivered = await upload(spoof)
    expect(typeof delivered).toBe('string')
  })
})

describe('a file that is neither still fails the way it always did', () => {
  it('reaches the decoder as text and is refused there', async () => {
    const delivered = await upload('this is not a psbt at all')

    expect(typeof delivered).toBe('string')
    expect(() => decodeAsTheWizardWould(delivered)).toThrow(RecoveryError)
    expect(() => decodeAsTheWizardWould(delivered)).toThrow(
      /Invalid PSBT data\. Please check the input\./,
    )
  })

  it('and the real file does not throw, so the check above means something', () => {
    // The positive partner. Without it the assertions above pass for a decoder
    // that refuses everything, including the file this whole change is for.
    expect(() => psbtFromBuffer(SPARROW_BYTES, 'regtest')).not.toThrow()
  })
})

describe('a reader that delivers nothing usable says so', () => {
  it('reports the failure instead of leaving a dead screen', async () => {
    // The old code returned silently on anything that was not a string, so a
    // reader that produced something unexpected left the customer looking at an
    // upload that had produced no error, no file name and no change of screen.
    const onImport = vi.fn()
    const { container } = render(
      <ImportPsbtStep error={null} onImport={onImport} onBack={() => {}} />,
    )
    const input = container.querySelector('input[type="file"]')!

    const readAsArrayBuffer = FileReader.prototype.readAsArrayBuffer
    FileReader.prototype.readAsArrayBuffer = function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: null, configurable: true })
      this.dispatchEvent(new Event('load'))
    }
    try {
      fireEvent.change(input, { target: { files: [new File(['x'], 'we.psbt')] } })
      expect(await screen.findByText(/Failed to read the file\./i)).toBeTruthy()
      expect(onImport).not.toHaveBeenCalled()
    } finally {
      FileReader.prototype.readAsArrayBuffer = readAsArrayBuffer
    }
  })
})

/**
 * A file too short to carry the five byte magic at all.
 *
 * The sniff reads a fixed five bytes off the front, and `new Uint8Array(buf, 0,
 * 5)` on a shorter buffer does not return a short array, it throws
 * `RangeError: Invalid typed array length: 5`. That throw happens inside
 * `reader.onload`, where nothing catches it: `onImport` is never called, no
 * error is shown, and the screen sits on "File loaded. Parsing..." forever.
 * That is the dead upload the non-ArrayBuffer guard three lines above it was
 * written to prevent, reached by a different route.
 *
 * Reachable without anything exotic. A .psbt truncated by a failed download or
 * a mail client, or an empty file created by a save that went wrong, is exactly
 * what somebody in this scenario ends up holding.
 */
describe('a file too short to carry the binary magic', () => {
  it('hands a truncated file on as text rather than dying on the sniff', async () => {
    // Two bytes, against a five byte magic.
    const delivered = await upload(bytesOf(Buffer.from('ab', 'utf8')), 'truncated.psbt')

    // Delivered at all is the point: this is what does not happen when the
    // sniff throws. The value is asserted too, so a step that delivered some
    // other thing entirely could not pass either.
    expect(typeof delivered).toBe('string')
    expect(delivered).toBe('ab')
  })

  it('hands an empty file on as text too', async () => {
    // Zero bytes. Same throw, and the shortest possible case.
    const delivered = await upload(new ArrayBuffer(0), 'empty.psbt')

    expect(typeof delivered).toBe('string')
    expect(delivered).toBe('')
    // The route out the other side, which is the refusal the customer should
    // get: an empty file is not a PSBT, and the decoder is what says so.
    expect(() => decodeAsTheWizardWould(delivered)).toThrow(RecoveryError)
  })

  it('and a file that IS five bytes long is still sniffed as binary', async () => {
    // The positive partner for the pair above, and the boundary itself. Without
    // it, "short files go to the text branch" is satisfied by a step that sent
    // every file to the text branch, which would break Sparrow again.
    const magicOnly = Buffer.from(SPARROW_BYTES.subarray(0, 5))
    const delivered = await upload(bytesOf(magicOnly), 'magic-only.psbt')

    expect(typeof delivered).not.toBe('string')
    expect([...Buffer.from(delivered as ArrayBuffer)]).toEqual([0x70, 0x73, 0x62, 0x74, 0xff])
  })
})
