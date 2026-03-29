// @vitest-environment node
/**
 * Tests for psbt-codec.ts
 *
 * We build real PSBTs from deterministic BIP32 keys so that address derivation
 * does not fail on synthetic (fake) xpubs.
 */
import { describe, it, expect } from 'vitest'
import { psbtToBase64, psbtFromBase64, psbtToBuffer, psbtFromBuffer } from './psbt-codec'
import { bitcoin, ecc } from './bitcoin-lib'
import { BIP32Factory } from 'bip32'
import { RecoveryError } from './errors'
import { Buffer } from 'buffer'

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

// ---------------------------------------------------------------------------
// Deterministic 2-of-3 multisig setup (all-zero seed)
// ---------------------------------------------------------------------------

const TEST_SEED = Buffer.alloc(32, 0x00)
const masterNode = bip32.fromSeed(TEST_SEED, NET)

const nodeA = masterNode.derive(0)
const nodeB = masterNode.derive(1)
const nodeC = masterNode.derive(2)

const pubA = Buffer.from(nodeA.derive(0).derive(0).publicKey)
const pubB = Buffer.from(nodeB.derive(0).derive(0).publicKey)
const pubC = Buffer.from(nodeC.derive(0).derive(0).publicKey)
const sortedPubs = [pubA, pubB, pubC].sort(Buffer.compare)

// P2WSH 2-of-3 payment objects
const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sortedPubs, network: NET })
const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })

const SCRIPT_OUTPUT = Buffer.from(p2wsh.output!)
const WITNESS_SCRIPT = Buffer.from(p2ms.output!)

// Destination P2WPKH address (well-known testnet address)
const DESTINATION = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'

/**
 * Build a minimal valid PSBT with one input and one output.
 */
function buildTestPsbt(): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: NET })

  psbt.addInput({
    hash: 'a'.repeat(64),
    index: 0,
    witnessUtxo: { script: SCRIPT_OUTPUT, value: BigInt(100_000) },
    witnessScript: WITNESS_SCRIPT,
  } as any)

  psbt.addOutput({ address: DESTINATION, value: BigInt(90_000) })
  return psbt
}

// ---------------------------------------------------------------------------
// psbtToBase64
// ---------------------------------------------------------------------------

describe('psbtToBase64', () => {
  it('produces a non-empty base64 string', () => {
    const psbt = buildTestPsbt()
    const b64 = psbtToBase64(psbt)
    expect(typeof b64).toBe('string')
    expect(b64.length).toBeGreaterThan(0)
  })

  it('produces a valid base64 string (only base64 characters)', () => {
    const psbt = buildTestPsbt()
    const b64 = psbtToBase64(psbt)
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('produces a string that starts with the PSBT magic bytes when decoded', () => {
    const psbt = buildTestPsbt()
    const b64 = psbtToBase64(psbt)
    const decoded = Buffer.from(b64, 'base64')
    // PSBT magic: "psbt\xff"
    expect(decoded[0]).toBe(0x70) // 'p'
    expect(decoded[1]).toBe(0x73) // 's'
    expect(decoded[2]).toBe(0x62) // 'b'
    expect(decoded[3]).toBe(0x74) // 't'
    expect(decoded[4]).toBe(0xff)
  })

  it('is deterministic — same PSBT always yields same base64', () => {
    const b1 = psbtToBase64(buildTestPsbt())
    const b2 = psbtToBase64(buildTestPsbt())
    expect(b1).toBe(b2)
  })
})

// ---------------------------------------------------------------------------
// psbtFromBase64 round-trip
// ---------------------------------------------------------------------------

describe('psbtFromBase64', () => {
  it('round-trips: preserves input count', () => {
    const original = buildTestPsbt()
    const b64 = psbtToBase64(original)
    const restored = psbtFromBase64(b64, 'testnet')
    expect(restored.data.inputs.length).toBe(original.data.inputs.length)
  })

  it('round-trips: preserves output count', () => {
    const original = buildTestPsbt()
    const b64 = psbtToBase64(original)
    const restored = psbtFromBase64(b64, 'testnet')
    expect(restored.txOutputs.length).toBe(original.txOutputs.length)
  })

  it('round-trips: preserves output value', () => {
    const original = buildTestPsbt()
    const b64 = psbtToBase64(original)
    const restored = psbtFromBase64(b64, 'testnet')
    expect(restored.txOutputs[0]!.value).toBe(original.txOutputs[0]!.value)
  })

  it('round-trips: preserves witnessScript on the input', () => {
    const original = buildTestPsbt()
    const b64 = psbtToBase64(original)
    const restored = psbtFromBase64(b64, 'testnet')
    const origWs = original.data.inputs[0]!.witnessScript!
    const restWs = restored.data.inputs[0]!.witnessScript!
    expect(Buffer.compare(origWs, restWs)).toBe(0)
  })

  it('throws PSBT_ERROR when the input is not valid base64 PSBT', () => {
    expect(() => psbtFromBase64('not-valid-psbt-data!!', 'testnet')).toThrow(
      RecoveryError,
    )
    try {
      psbtFromBase64('not-valid-psbt-data!!', 'testnet')
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
    }
  })

  it('throws PSBT_ERROR for a base64 string that decodes to garbage bytes', () => {
    const garbage = Buffer.from('this is definitely not a psbt structure').toString('base64')
    expect(() => psbtFromBase64(garbage, 'testnet')).toThrow(RecoveryError)
    try {
      psbtFromBase64(garbage, 'testnet')
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
    }
  })

  it('throws PSBT_ERROR for an empty string', () => {
    expect(() => psbtFromBase64('', 'testnet')).toThrow(RecoveryError)
  })

  it('throws PSBT_ERROR for a string with only whitespace', () => {
    expect(() => psbtFromBase64('   ', 'testnet')).toThrow(RecoveryError)
  })
})

// ---------------------------------------------------------------------------
// psbtToBuffer
// ---------------------------------------------------------------------------

describe('psbtToBuffer', () => {
  it('returns a Buffer instance', () => {
    const psbt = buildTestPsbt()
    const buf = psbtToBuffer(psbt)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('returns a non-empty buffer', () => {
    const psbt = buildTestPsbt()
    const buf = psbtToBuffer(psbt)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('starts with PSBT magic bytes', () => {
    const psbt = buildTestPsbt()
    const buf = psbtToBuffer(psbt)
    expect(buf[0]).toBe(0x70) // 'p'
    expect(buf[1]).toBe(0x73) // 's'
    expect(buf[2]).toBe(0x62) // 'b'
    expect(buf[3]).toBe(0x74) // 't'
    expect(buf[4]).toBe(0xff)
  })
})

// ---------------------------------------------------------------------------
// psbtFromBuffer round-trip
// ---------------------------------------------------------------------------

describe('psbtFromBuffer', () => {
  it('round-trips: preserves input count', () => {
    const original = buildTestPsbt()
    const buf = psbtToBuffer(original)
    const restored = psbtFromBuffer(buf, 'testnet')
    expect(restored.data.inputs.length).toBe(original.data.inputs.length)
  })

  it('round-trips: preserves output count', () => {
    const original = buildTestPsbt()
    const buf = psbtToBuffer(original)
    const restored = psbtFromBuffer(buf, 'testnet')
    expect(restored.txOutputs.length).toBe(original.txOutputs.length)
  })

  it('round-trips: base64 and buffer encodings are consistent', () => {
    const original = buildTestPsbt()
    const fromBuffer = psbtFromBuffer(psbtToBuffer(original), 'testnet')
    const fromBase64 = psbtFromBase64(psbtToBase64(original), 'testnet')
    expect(psbtToBase64(fromBuffer)).toBe(psbtToBase64(fromBase64))
  })

  it('throws PSBT_ERROR with random bytes', () => {
    // Use fixed bytes to avoid non-determinism
    const randomBytes = Buffer.from('00'.repeat(64), 'hex')
    expect(() => psbtFromBuffer(randomBytes, 'testnet')).toThrow(RecoveryError)
    try {
      psbtFromBuffer(randomBytes, 'testnet')
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
    }
  })

  it('throws PSBT_ERROR with an empty buffer', () => {
    expect(() => psbtFromBuffer(Buffer.alloc(0), 'testnet')).toThrow(RecoveryError)
  })

  it('throws PSBT_ERROR with a truncated PSBT buffer', () => {
    const original = buildTestPsbt()
    const buf = psbtToBuffer(original)
    // Keep only the magic bytes — not a complete PSBT
    const truncated = Buffer.from(buf.subarray(0, 5))
    expect(() => psbtFromBuffer(truncated, 'testnet')).toThrow(RecoveryError)
  })
})
