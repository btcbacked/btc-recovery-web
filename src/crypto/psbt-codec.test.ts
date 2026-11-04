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
import { analyzePsbt } from './psbt-finalizer'
import type { Network } from './recovery-file'
import { SPARROW_BINARY_PSBT_BASE64 } from './__fixtures__/sparrow-binary-psbt'
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

// ---------------------------------------------------------------------------
// The import guard: the amounts shown are the amounts signed
//
// Each row is decoded both ways the import step decodes (pasted base64 and a
// binary file). A refused row must fail for its own reason, so the technical
// detail is matched too: a row refused by accident would let its guard
// condition be deleted with the suite still green.
// ---------------------------------------------------------------------------

/** The escrow's funding transaction: two outputs of different value. */
const FUNDING = new bitcoin.Transaction()
FUNDING.version = 2
FUNDING.addInput(Buffer.alloc(32, 9), 0)
FUNDING.addOutput(SCRIPT_OUTPUT, BigInt(1_000_000))
FUNDING.addOutput(SCRIPT_OUTPUT, BigInt(950_000))

/** A different transaction with the very same outputs, so only its txid differs. */
const DECOY = new bitcoin.Transaction()
DECOY.version = 2
DECOY.addInput(Buffer.alloc(32, 8), 0)
DECOY.addOutput(SCRIPT_OUTPUT, BigInt(1_000_000))
DECOY.addOutput(SCRIPT_OUTPUT, BigInt(950_000))

const PREV_TX = Buffer.from(FUNDING.toBuffer())
const SEND = BigInt(900_000)

/** The witnessUtxo a correct wallet writes for output `vout` of FUNDING. */
function honest(vout: number) {
  return { script: SCRIPT_OUTPUT, value: FUNDING.outs[vout]!.value }
}

/** A PSBT spending outputs of FUNDING with the given UTXO records. */
function spending(...inputs: Array<{ index: number; witnessUtxo?: object; nonWitnessUtxo?: Buffer }>) {
  const psbt = new bitcoin.Psbt({ network: NET })
  for (const input of inputs) {
    psbt.addInput({ hash: FUNDING.getHash(), witnessScript: WITNESS_SCRIPT, ...input } as any)
  }
  psbt.addOutput({ address: DESTINATION, value: SEND })
  return psbt
}

const DECODERS = [
  {
    form: 'pasted base64',
    decode: (psbt: bitcoin.Psbt, network: Network) => psbtFromBase64(psbt.toBase64(), network),
    refusal: 'Invalid PSBT data. Please check the input.',
  },
  {
    form: 'binary file',
    decode: (psbt: bitcoin.Psbt, network: Network) => psbtFromBuffer(psbtToBuffer(psbt), network),
    refusal: 'Invalid PSBT file. Please check the file format.',
  },
]

type Row =
  | { name: string; psbt: () => bitcoin.Psbt; reason: RegExp }
  | { name: string; psbt: () => bitcoin.Psbt; fee: number; network?: Network }

const ROWS: Row[] = [
  {
    name: 'GHSA-4mfv: the real previous transaction with a lower witnessUtxo',
    psbt: () => spending({ index: 0, witnessUtxo: { script: SCRIPT_OUTPUT, value: BigInt(900_200) }, nonWitnessUtxo: PREV_TX }),
    reason: /Input 0 witnessUtxo does not match output 0/,
  },
  {
    name: 'a witnessUtxo with the real value and another script',
    psbt: () => spending({ index: 0, witnessUtxo: { script: Buffer.from(bitcoin.address.toOutputScript(DESTINATION, NET)), value: BigInt(1_000_000) }, nonWitnessUtxo: PREV_TX }),
    reason: /Input 0 witnessUtxo does not match output 0/,
  },
  {
    name: 'a witnessUtxo copied from another output of the same transaction',
    psbt: () => spending({ index: 1, witnessUtxo: honest(0), nonWitnessUtxo: PREV_TX }),
    reason: /Input 0 witnessUtxo does not match output 1/,
  },
  {
    name: 'a nonWitnessUtxo that is not the transaction the input spends',
    psbt: () => spending({ index: 0, witnessUtxo: honest(0), nonWitnessUtxo: Buffer.from(DECOY.toBuffer()) }),
    reason: /Input 0 nonWitnessUtxo is not the transaction it spends/,
  },
  {
    name: 'an input carrying only nonWitnessUtxo, next to an honest one',
    psbt: () => spending({ index: 0, witnessUtxo: honest(0) }, { index: 1, nonWitnessUtxo: PREV_TX }),
    reason: /Input 1 has no witnessUtxo/,
  },
  {
    name: 'an input carrying neither record',
    psbt: () => spending({ index: 0, witnessUtxo: honest(0) }, { index: 1 }),
    reason: /Input 1 has no witnessUtxo/,
  },
  {
    name: 'a matching pair',
    psbt: () => spending({ index: 0, witnessUtxo: honest(0), nonWitnessUtxo: PREV_TX }),
    fee: 100_000,
  },
  {
    name: 'a witnessUtxo only input',
    psbt: () => spending({ index: 1, witnessUtxo: honest(1) }),
    fee: 50_000,
  },
  {
    name: 'two inputs, one a matching pair and one witnessUtxo only',
    psbt: () => spending({ index: 0, witnessUtxo: honest(0), nonWitnessUtxo: PREV_TX }, { index: 1, witnessUtxo: honest(1) }),
    fee: 1_050_000,
  },
  {
    name: 'the file Sparrow wrote (a real matching pair)',
    psbt: () => bitcoin.Psbt.fromBase64(SPARROW_BINARY_PSBT_BASE64, { network: bitcoin.networks.regtest }),
    fee: 146,
    network: 'regtest',
  },
]

/** What the inputs really hold, read from the previous transactions, not from witnessUtxo. */
function realFee(psbt: bitcoin.Psbt): number {
  const inputs = psbt.txInputs.reduce((sum, { index }, i) => {
    const prev = psbt.data.inputs[i]!.nonWitnessUtxo
    return sum + (prev ? bitcoin.Transaction.fromBuffer(prev).outs[index]!.value : FUNDING.outs[index]!.value)
  }, BigInt(0))
  return Number(inputs - psbt.txOutputs.reduce((sum, o) => sum + o.value, BigInt(0)))
}

describe('an imported PSBT must carry the amounts that get signed', () => {
  for (const { form, decode, refusal } of DECODERS) {
    describe(form, () => {
      for (const row of ROWS) {
        if ('reason' in row) {
          it(`refuses ${row.name}`, () => {
            let caught: unknown
            try {
              decode(row.psbt(), 'testnet')
            } catch (err) {
              caught = err
            }
            expect(caught).toBeInstanceOf(RecoveryError)
            const error = caught as RecoveryError
            expect(error.code).toBe('PSBT_ERROR')
            expect(error.userMessage).toBe(refusal)
            expect(error.detail).toMatch(row.reason)
          })
        } else {
          it(`accepts ${row.name}, showing the real fee`, () => {
            const psbt = row.psbt()
            const network = row.network ?? 'testnet'
            let analysis: ReturnType<typeof analyzePsbt> | undefined
            expect(() => {
              analysis = analyzePsbt(decode(psbt, network), network)
            }).not.toThrow()
            expect(analysis!.fee).toBe(row.fee)
            expect(analysis!.fee).toBe(realFee(psbt))
            expect(analysis!.inputValues).not.toContain(null)
          })
        }
      }
    })
  }

  it('the headline row is the advisory shape: unguarded, the screen would show 200 sats', () => {
    // The premise of the first row, measured. The library parses it, so the
    // refusal above is the guard's and not the parser's, and the fee the
    // screen would have shown is 200 sats against a real 100,000.
    const attack = ROWS[0]!.psbt()
    const parsed = bitcoin.Psbt.fromBase64(attack.toBase64(), { network: NET })
    expect(analyzePsbt(parsed, 'testnet').fee).toBe(200)
    expect(realFee(attack)).toBe(100_000)
  })
})
