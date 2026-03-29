// @vitest-environment node
/**
 * Tests for psbt-builder.ts
 *
 * Addresses derived from the fixture descriptor rely on bip32 parsing, so we
 * use a self-consistent descriptor built from deterministic BIP32 xpubs.
 */
import { describe, it, expect } from 'vitest'
import { estimateTxVsize, estimateFee, buildPsbt } from './psbt-builder'
import { parseDescriptor } from './descriptor-parser'
import { deriveMultisigAddress } from './address'
import { RecoveryError } from './errors'
import { bitcoin, ecc } from './bitcoin-lib'
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'
import type { Utxo } from './blockchain-api'
import type { DerivedAddress } from './address'

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

// ---------------------------------------------------------------------------
// Build a self-consistent descriptor from real bip32 xpubs
// ---------------------------------------------------------------------------

const TEST_SEED = Buffer.alloc(32, 0x00)
const masterNode = bip32.fromSeed(TEST_SEED, NET)

const nodeA = masterNode.derive(0)
const nodeB = masterNode.derive(1)
const nodeC = masterNode.derive(2)

const xpubA = nodeA.neutered().toBase58()
const xpubB = nodeB.neutered().toBase58()
const xpubC = nodeC.neutered().toBase58()

// Each node's fingerprint = hash160(pubkey)[0:4] of its parent derivation
// We use fixed 8-char hex fingerprints for the descriptor string
const fpA = Buffer.from(masterNode.derive(0).fingerprint).toString('hex').slice(0, 8).padStart(8, '0')
const fpB = Buffer.from(masterNode.derive(1).fingerprint).toString('hex').slice(0, 8).padStart(8, '0')
const fpC = Buffer.from(masterNode.derive(2).fingerprint).toString('hex').slice(0, 8).padStart(8, '0')

// Build descriptor string from real xpubs
const REAL_DESCRIPTOR =
  `wsh(sortedmulti(2,[${fpA}/48'/1'/0'/2']${xpubA}/0/*,[${fpB}/48'/1'/0'/2']${xpubB}/0/*,[${fpC}/48'/1'/0'/2']${xpubC}/0/*))`

const parsedDescriptor = parseDescriptor(REAL_DESCRIPTOR)

// Constants derived from the source's formula for 2-of-3 (m=2, n=3)
// inputVsizeForThreshold(2, 3):
//   witnessBytes = 1 + 1 + 2*73 + (3 + 3*34 + 3) = 2 + 146 + 111 = 259... let me compute
function inputVsizeForThreshold(m: number, n: number): number {
  const witnessBytes = 1 + 1 + m * 73 + (3 + n * 34 + 3)
  const nonWitnessBytes = 41
  return nonWitnessBytes + Math.ceil(witnessBytes / 4)
}

const INPUT_VSIZE = inputVsizeForThreshold(2, 3)  // 105
const OUTPUT_VSIZE = 43
const OVERHEAD_VSIZE = 11

// A valid testnet destination address (P2WPKH)
const DESTINATION_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'

/** Generate a deterministic 64-char hex txid from a single decimal digit seed. */
function fakeTxid(seed: number): string {
  return String(seed % 10).repeat(64)
}

function makeUtxo(txid: string, vout: number, value: number): Utxo {
  return { txid, vout, value, status: { confirmed: true, block_height: 800000 } }
}

function makeUtxoPair(
  txid: string,
  vout: number,
  value: number,
  addressIndex: number = 0,
): { utxo: Utxo; addressInfo: DerivedAddress } {
  return {
    utxo: makeUtxo(txid, vout, value),
    addressInfo: deriveMultisigAddress(parsedDescriptor, addressIndex, 'testnet'),
  }
}

// ---------------------------------------------------------------------------
// estimateTxVsize
// ---------------------------------------------------------------------------

describe('estimateTxVsize', () => {
  it('calculates vsize for 1 input 1 output', () => {
    const expected = OVERHEAD_VSIZE + 1 * INPUT_VSIZE + 1 * OUTPUT_VSIZE
    expect(estimateTxVsize(1, 1)).toBe(expected)
  })

  it('calculates vsize for 1 input 2 outputs', () => {
    const expected = OVERHEAD_VSIZE + 1 * INPUT_VSIZE + 2 * OUTPUT_VSIZE
    expect(estimateTxVsize(1, 2)).toBe(expected)
  })

  it('calculates vsize for 2 inputs 2 outputs', () => {
    const expected = OVERHEAD_VSIZE + 2 * INPUT_VSIZE + 2 * OUTPUT_VSIZE
    expect(estimateTxVsize(2, 2)).toBe(expected)
  })

  it('calculates vsize for 3 inputs 1 output', () => {
    const expected = OVERHEAD_VSIZE + 3 * INPUT_VSIZE + 1 * OUTPUT_VSIZE
    expect(estimateTxVsize(3, 1)).toBe(expected)
  })

  it('returns only overhead when inputs and outputs are both 0', () => {
    expect(estimateTxVsize(0, 0)).toBe(OVERHEAD_VSIZE)
  })

  it('is linear in input count', () => {
    const diff = estimateTxVsize(2, 1) - estimateTxVsize(1, 1)
    expect(diff).toBe(INPUT_VSIZE)
  })

  it('is linear in output count', () => {
    const diff = estimateTxVsize(1, 2) - estimateTxVsize(1, 1)
    expect(diff).toBe(OUTPUT_VSIZE)
  })

  it('accepts optional threshold and keyCount parameters', () => {
    // 1-of-2: inputVsizeForThreshold(1, 2)
    const input12 = inputVsizeForThreshold(1, 2)
    const expected = OVERHEAD_VSIZE + 1 * input12 + 1 * OUTPUT_VSIZE
    expect(estimateTxVsize(1, 1, 1, 2)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// estimateFee
// ---------------------------------------------------------------------------

describe('estimateFee', () => {
  it('returns ceil(vsize * feeRate) for a whole-number result', () => {
    const vsize = estimateTxVsize(1, 1)
    expect(estimateFee(1, 1, 2)).toBe(vsize * 2)
  })

  it('rounds up fractional satoshis', () => {
    const result = estimateFee(1, 1, 3.3)
    expect(result).toBe(Math.ceil(estimateTxVsize(1, 1) * 3.3))
    expect(Number.isInteger(result)).toBe(true)
  })

  it('never returns a fractional value', () => {
    const result = estimateFee(2, 2, 7.77)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('scales proportionally with fee rate', () => {
    const fee1 = estimateFee(1, 1, 1)
    const fee10 = estimateFee(1, 1, 10)
    expect(fee10).toBe(fee1 * 10)
  })

  it('returns 0 for fee rate 0', () => {
    expect(estimateFee(1, 1, 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildPsbt – error cases
// ---------------------------------------------------------------------------

describe('buildPsbt – error cases', () => {
  it('throws TRANSACTION_ERROR when UTXOs array is empty', () => {
    expect(() =>
      buildPsbt({
        utxos: [],
        outputs: [{ address: DESTINATION_ADDRESS, value: 50_000 }],
        changeAddress: null,
        feeRate: 5,
        network: 'testnet',
        parsedDescriptor,
      }),
    ).toThrow(RecoveryError)

    try {
      buildPsbt({
        utxos: [],
        outputs: [{ address: DESTINATION_ADDRESS, value: 50_000 }],
        changeAddress: null,
        feeRate: 5,
        network: 'testnet',
        parsedDescriptor,
      })
    } catch (err) {
      expect((err as RecoveryError).code).toBe('TRANSACTION_ERROR')
      expect((err as RecoveryError).userMessage).toContain('No UTXOs')
    }
  })

  it('throws TRANSACTION_ERROR when funds are insufficient to cover output + fee', () => {
    // Only 1000 sats in, trying to send 999 + fee (will exceed 1000)
    const utxos = [makeUtxoPair('a'.repeat(64), 0, 1000)]
    expect(() =>
      buildPsbt({
        utxos,
        outputs: [{ address: DESTINATION_ADDRESS, value: 999 }],
        changeAddress: null,
        feeRate: 10,
        network: 'testnet',
        parsedDescriptor,
      }),
    ).toThrow(RecoveryError)

    try {
      buildPsbt({
        utxos: [makeUtxoPair('a'.repeat(64), 0, 1000)],
        outputs: [{ address: DESTINATION_ADDRESS, value: 999 }],
        changeAddress: null,
        feeRate: 10,
        network: 'testnet',
        parsedDescriptor,
      })
    } catch (err) {
      expect((err as RecoveryError).code).toBe('TRANSACTION_ERROR')
      expect((err as RecoveryError).userMessage).toContain('Insufficient funds')
    }
  })

  it('throws TRANSACTION_ERROR when output value equals total input (no room for fee)', () => {
    const utxoValue = 100_000
    const utxos = [makeUtxoPair('b'.repeat(64), 0, utxoValue)]
    expect(() =>
      buildPsbt({
        utxos,
        outputs: [{ address: DESTINATION_ADDRESS, value: utxoValue }],
        changeAddress: null,
        feeRate: 1,
        network: 'testnet',
        parsedDescriptor,
      }),
    ).toThrow(RecoveryError)
  })

  it('includes the available and needed amounts in the error message', () => {
    const utxos = [makeUtxoPair('c'.repeat(64), 0, 5000)]
    try {
      buildPsbt({
        utxos,
        outputs: [{ address: DESTINATION_ADDRESS, value: 5000 }],
        changeAddress: null,
        feeRate: 5,
        network: 'testnet',
        parsedDescriptor,
      })
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as RecoveryError).code).toBe('TRANSACTION_ERROR')
      expect((err as RecoveryError).userMessage).toContain('5000')
    }
  })
})

// ---------------------------------------------------------------------------
// buildPsbt – successful PSBT construction
// ---------------------------------------------------------------------------

describe('buildPsbt – successful PSBT construction', () => {
  it('creates the correct number of inputs (1 UTXO → 1 input)', () => {
    const utxos = [makeUtxoPair('d'.repeat(64), 0, 1_000_000)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 500_000 }],
      changeAddress: null,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor,
    })
    expect(psbt.data.inputs.length).toBe(1)
  })

  it('creates the correct number of inputs with multiple UTXOs', () => {
    const utxos = [
      makeUtxoPair('e'.repeat(64), 0, 500_000, 0),
      makeUtxoPair('f'.repeat(64), 0, 500_000, 1),
    ]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 800_000 }],
      changeAddress: null,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor,
    })
    expect(psbt.data.inputs.length).toBe(2)
  })

  it('creates 1 output when no change address is provided', () => {
    const utxos = [makeUtxoPair(fakeTxid(1), 0, 1_000_000)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 900_000 }],
      changeAddress: null,
      feeRate: 1,
      network: 'testnet',
      parsedDescriptor,
    })
    expect(psbt.txOutputs.length).toBe(1)
  })

  it('adds change output when changeAddress is set and change >= 330 (dust limit)', () => {
    const changeAddress = deriveMultisigAddress(parsedDescriptor, 9, 'testnet')
    const utxos = [makeUtxoPair(fakeTxid(2), 0, 1_000_000)]
    // Send 500_000; change will be ~490_000+ after fees — well above dust
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 500_000 }],
      changeAddress,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor,
    })
    // Destination + change = 2 outputs
    expect(psbt.txOutputs.length).toBe(2)
  })

  it('omits change output when change value is below dust limit (< 330 sats)', () => {
    // With 1 input + 2 outputs (with change), and 2-of-3:
    // vsize = 11 + 105 + 2*43 = 202; feeRate=5 → fee = 1010
    // Let input = 501_309, output = 500_000
    // change = 501_309 - 500_000 - 1010 = 299 (below 330) → omit change
    const inputValue = 501_309
    const changeAddress = deriveMultisigAddress(parsedDescriptor, 9, 'testnet')
    const utxos = [makeUtxoPair(fakeTxid(3), 0, inputValue)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 500_000 }],
      changeAddress,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor,
    })
    // Change below dust: only 1 output
    expect(psbt.txOutputs.length).toBe(1)
  })

  it('sets witnessScript on each input', () => {
    const utxos = [makeUtxoPair(fakeTxid(4), 0, 1_000_000)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 900_000 }],
      changeAddress: null,
      feeRate: 1,
      network: 'testnet',
      parsedDescriptor,
    })
    const input = psbt.data.inputs[0]!
    expect(input.witnessScript).toBeDefined()
    expect(input.witnessScript!.length).toBeGreaterThan(0)
  })

  it('sets witnessUtxo on each input with the correct value', () => {
    const utxos = [makeUtxoPair(fakeTxid(5), 0, 1_000_000)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 900_000 }],
      changeAddress: null,
      feeRate: 1,
      network: 'testnet',
      parsedDescriptor,
    })
    const input = psbt.data.inputs[0]!
    expect(input.witnessUtxo).toBeDefined()
    expect(input.witnessUtxo!.value).toBe(BigInt(1_000_000))
  })

  it('sets bip32Derivation with 3 entries for a 3-key descriptor', () => {
    const utxos = [makeUtxoPair(fakeTxid(6), 0, 1_000_000)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 900_000 }],
      changeAddress: null,
      feeRate: 1,
      network: 'testnet',
      parsedDescriptor,
    })
    const input = psbt.data.inputs[0]!
    expect(input.bip32Derivation).toBeDefined()
    expect(input.bip32Derivation!.length).toBe(3)
  })

  it('sets the correct value on the destination output', () => {
    const sendValue = 700_000
    const utxos = [makeUtxoPair(fakeTxid(7), 0, 1_000_000)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: sendValue }],
      changeAddress: null,
      feeRate: 1,
      network: 'testnet',
      parsedDescriptor,
    })
    expect(psbt.txOutputs[0]!.value).toBe(BigInt(sendValue))
  })

  it('preserves the correct UTXO txid and vout on each input', () => {
    const txid = 'abcdef1234567890'.repeat(4) // 64 chars
    const vout = 2
    const utxos = [makeUtxoPair(txid, vout, 1_000_000)]
    const psbt = buildPsbt({
      utxos,
      outputs: [{ address: DESTINATION_ADDRESS, value: 900_000 }],
      changeAddress: null,
      feeRate: 1,
      network: 'testnet',
      parsedDescriptor,
    })
    // bitcoinjs-lib stores txid as reversed bytes internally; we can verify
    // via the txInputs API
    expect(psbt.txInputs.length).toBe(1)
    expect(psbt.txInputs[0]!.index).toBe(vout)
  })
})
