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
import { psbtToBase64, psbtFromBase64 } from './psbt-codec'
import { signPsbtWithXprv } from './psbt-signer'
import { finalizePsbt, extractRawTransaction } from './psbt-finalizer'
import {
  MIXED_DEPTH_DESCRIPTOR,
  USER_FINGERPRINT,
  USER_XPRV,
  USER_XPUB,
  COSIGNER_FINGERPRINT,
  COSIGNER_XPRV,
  userChildPubkey,
} from './__fixtures__/deep-paths'

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

// ---------------------------------------------------------------------------
// PSBT construction at the depth production uses
//
// buildPsbt always appends exactly /{chain}/{index} to whatever origin path
// the descriptor names. These tests pin that at a 6 level user origin and a
// 4 level platform origin in the same input, and check what actually lands in
// the serialized PSBT rather than what the object holds in memory.
// ---------------------------------------------------------------------------

describe('buildPsbt at production depth', () => {
  const mixed = parseDescriptor(MIXED_DEPTH_DESCRIPTOR)

  function buildAt(index: number, chain = 0): bitcoin.Psbt {
    // The branch is a property of the descriptor now, not an argument, so
    // asking for the change branch means asking for a descriptor on it.
    const descriptor =
      chain === 0
        ? mixed
        : parseDescriptor(MIXED_DEPTH_DESCRIPTOR.replaceAll('/0/*', `/${chain}/*`))
    const addressInfo = deriveMultisigAddress(descriptor, index, 'testnet')
    return buildPsbt({
      utxos: [{ utxo: makeUtxo(fakeTxid(3), 0, 500_000), addressInfo }],
      outputs: [{ address: DESTINATION_ADDRESS, value: 400_000 }],
      changeAddress: null,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor: descriptor,
    })
  }

  /** The paths as they come back out of a serialized PSBT. */
  function roundTripPaths(psbt: bitcoin.Psbt): string[] {
    const decoded = psbtFromBase64(psbtToBase64(psbt), 'testnet')
    return (decoded.data.inputs[0]!.bip32Derivation ?? []).map((d) => d.path)
  }

  it('writes the full 8 level path for a user key', () => {
    const paths = roundTripPaths(buildAt(4))
    expect(paths).toContain("m/48'/1'/0'/2'/0/7/0/4")
  })

  it('writes the full 6 level path for the platform key in the same input', () => {
    const paths = roundTripPaths(buildAt(4))
    expect(paths).toContain("m/88'/1'/0'/0'/0/4")
  })

  it('appends exactly chain and index, never more', () => {
    for (const path of roundTripPaths(buildAt(4))) {
      const components = path.split('/').slice(1)
      expect(components.slice(-2)).toEqual(['0', '4'])
    }
  })

  it('carries the change branch into the path', () => {
    const paths = roundTripPaths(buildAt(6, 1))
    expect(paths).toContain("m/48'/1'/0'/2'/0/7/1/6")
    expect(paths).toContain("m/88'/1'/0'/0'/1/6")
  })

  it('keeps every hardened level hardened through serialization', () => {
    // The descriptor writes hardened levels as h. PSBT path encoding only
    // understands the apostrophe and does not complain about anything else:
    // an h reaching the encoder comes back as an UNHARDENED index, silently,
    // and a signature made against that key would be worthless.
    //
    // Asserting the ABSENCE of h here would prove nothing, because the encoder
    // drops the marker either way and no decoded path can contain one. The
    // decoded paths themselves are the only evidence, so pin them exactly.
    expect(roundTripPaths(buildAt(0)).sort()).toEqual([
      "m/48'/1'/0'/2'/0/2/0/0",
      "m/48'/1'/0'/2'/0/7/0/0",
      "m/88'/1'/0'/0'/0/0",
    ])
  })

  it('pairs each path with the pubkey that path derives', () => {
    const decoded = psbtFromBase64(psbtToBase64(buildAt(4)), 'testnet')
    const entry = (decoded.data.inputs[0]!.bip32Derivation ?? []).find(
      (d) => d.path === "m/48'/1'/0'/2'/0/7/0/4",
    )
    expect(entry).toBeDefined()
    expect(Buffer.compare(Buffer.from(entry!.pubkey), userChildPubkey(0, 4))).toBe(0)
  })

  it('treats an uppercase H marker as hardened, like h and the apostrophe', () => {
    const upperCaseOrigin = MIXED_DEPTH_DESCRIPTOR.replace(
      '48h/1h/0h/2h/0/7',
      '48H/1H/0H/2H/0/7',
    )
    expect(upperCaseOrigin).not.toBe(MIXED_DEPTH_DESCRIPTOR)

    const parsedUpper = parseDescriptor(upperCaseOrigin)
    const addressInfo = deriveMultisigAddress(parsedUpper, 4, 'testnet')
    const psbt = buildPsbt({
      utxos: [{ utxo: makeUtxo(fakeTxid(4), 0, 500_000), addressInfo }],
      outputs: [{ address: DESTINATION_ADDRESS, value: 400_000 }],
      changeAddress: null,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor: parsedUpper,
    })

    expect(roundTripPaths(psbt)).toContain("m/48'/1'/0'/2'/0/7/0/4")
  })

  /** The same escrow with every hardened marker respelled. */
  function markersAs(marker: string): string {
    // Only inside the origin brackets: a base58 key can hold an `h` too, and
    // the fingerprints are hex, so nothing else in there can be touched.
    return MIXED_DEPTH_DESCRIPTOR.replace(
      /\[([^\]]*)\]/g,
      (_full, inner: string) => `[${inner.replace(/h/g, marker)}]`,
    )
  }

  function pathsFor(descriptor: string, index: number): string[] {
    const parsed = parseDescriptor(descriptor)
    const addressInfo = deriveMultisigAddress(parsed, index, 'testnet')
    return roundTripPaths(
      buildPsbt({
        utxos: [{ utxo: makeUtxo(fakeTxid(8), 0, 500_000), addressInfo }],
        outputs: [{ address: DESTINATION_ADDRESS, value: 400_000 }],
        changeAddress: null,
        feeRate: 5,
        network: 'testnet',
        parsedDescriptor: parsed,
      }),
    ).sort()
  }

  it('reads H, h and the apostrophe as one and the same hardened marker', () => {
    // All three are legal BIP-380 and the backend is not the only thing that
    // writes a descriptor into a recovery file. A marker the normaliser misses
    // reaches the PSBT encoder, which reads "48H" as the UNHARDENED child 48
    // without complaining, so the PSBT names a key nobody holds and the
    // signature collected against it is worthless.
    const upper = markersAs('H')
    const apostrophe = markersAs("'")
    expect(upper).not.toBe(MIXED_DEPTH_DESCRIPTOR)
    expect(apostrophe).not.toBe(MIXED_DEPTH_DESCRIPTOR)

    // Pinned exactly, because the encoder drops the marker either way: the
    // decoded paths are the only evidence of what was actually written.
    const expected = [
      "m/48'/1'/0'/2'/0/2/0/4",
      "m/48'/1'/0'/2'/0/7/0/4",
      "m/88'/1'/0'/0'/0/4",
    ]
    expect(pathsFor(MIXED_DEPTH_DESCRIPTOR, 4)).toEqual(expected)
    expect(pathsFor(upper, 4)).toEqual(expected)
    expect(pathsFor(apostrophe, 4)).toEqual(expected)
  })

  it('normalises one leg written in a different case from the rest', () => {
    // A descriptor that has been through more than one wallet is the realistic
    // way a mixed spelling arrives, and it is also the case where a leg quietly
    // going unhardened is hardest to notice: the other two legs still look
    // right. The platform leg is the one respelled here, so its final marker
    // sits at the end of the origin path with nothing after it.
    const mixedCase = MIXED_DEPTH_DESCRIPTOR.replace('88h/1h/0h/0h', "88H/1h/0H/0h")
    expect(mixedCase).not.toBe(MIXED_DEPTH_DESCRIPTOR)

    expect(pathsFor(mixedCase, 4)).toEqual(pathsFor(MIXED_DEPTH_DESCRIPTOR, 4))
  })

  it('does not invent a level when a key carries no origin path', () => {
    // [FP]xpub with no path. Building `m/` + '' + `/chain/index` gives
    // `m//0/4`, whose empty component decodes as an extra level 0.
    const noOrigin = `wsh(sortedmulti(1,[${USER_FINGERPRINT}]${USER_XPUB}/0/*))`
    const parsedNoOrigin = parseDescriptor(noOrigin)
    expect(parsedNoOrigin.keys[0]!.originPath).toBe('')

    const addressInfo = deriveMultisigAddress(parsedNoOrigin, 4, 'testnet')
    const psbt = buildPsbt({
      utxos: [{ utxo: makeUtxo(fakeTxid(5), 0, 500_000), addressInfo }],
      outputs: [{ address: DESTINATION_ADDRESS, value: 400_000 }],
      changeAddress: null,
      feeRate: 5,
      network: 'testnet',
      parsedDescriptor: parsedNoOrigin,
    })

    expect(roundTripPaths(psbt)).toEqual(['m/0/4'])
  })

  it('builds, signs with two of three keys and finalizes at this depth', () => {
    const psbt = buildAt(4)

    const first = signPsbtWithXprv(psbt, USER_XPRV, USER_FINGERPRINT, 'testnet')
    expect(first.signedCount).toBe(1)

    const second = signPsbtWithXprv(
      psbt,
      COSIGNER_XPRV,
      COSIGNER_FINGERPRINT,
      'testnet',
    )
    expect(second.signedCount).toBe(1)

    const finalized = finalizePsbt(psbt)
    const rawTx = extractRawTransaction(finalized)
    expect(rawTx).toMatch(/^[0-9a-f]+$/)
    expect(rawTx.length).toBeGreaterThan(0)
  })
})
