// @vitest-environment node
/**
 * Tests for psbt-finalizer.ts
 *
 * We build fully self-consistent PSBTs using three deterministic BIP32 keys
 * derived from an all-zero seed.  Two of the three keys sign to satisfy the
 * 2-of-3 multisig so we can exercise both the happy path (finalize + extract)
 * and the error path (not enough signatures).
 */
import { describe, it, expect } from 'vitest'
import { analyzePsbt, finalizePsbt, extractRawTransaction } from './psbt-finalizer'
import { RecoveryError } from './errors'
import { bitcoin, ecc, ECPair } from './bitcoin-lib'
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

// ---------------------------------------------------------------------------
// Deterministic key setup (same approach as psbt-signer.test.ts)
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

// P2WSH 2-of-3 multisig payment objects
const p2ms = bitcoin.payments.p2ms({
  m: 2,
  pubkeys: sortedPubs,
  network: NET,
})
const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })

const SCRIPT_OUTPUT = Buffer.from(p2wsh.output!)
const WITNESS_SCRIPT = Buffer.from(p2ms.output!)
const INPUT_VALUE = BigInt(500_000)

// Destination address (P2WPKH)
const DESTINATION = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
const SEND_VALUE = BigInt(490_000)

function makeFakeTxid(seed: string): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64)
}

// ---------------------------------------------------------------------------
// Helpers to build PSBTs in various states
// ---------------------------------------------------------------------------

function buildUnsignedPsbt(): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: NET })
  psbt.addInput({
    hash: makeFakeTxid('aa'),
    index: 0,
    witnessUtxo: { script: SCRIPT_OUTPUT, value: INPUT_VALUE },
    witnessScript: WITNESS_SCRIPT,
    bip32Derivation: [
      { masterFingerprint: masterNode.fingerprint, pubkey: pubA, path: 'm/0/0/0' },
    ],
  } as any)
  psbt.addOutput({ address: DESTINATION, value: SEND_VALUE })
  return psbt
}

/**
 * Sign a PSBT input with two keys to satisfy the 2-of-3 threshold.
 * Uses ECPair directly to sign the sighash.
 */
function signPsbtWithTwoKeys(psbt: bitcoin.Psbt): void {
  const keyPairA = ECPair.fromPrivateKey(
    Buffer.from(nodeA.derive(0).derive(0).privateKey!),
    { network: NET },
  )
  const keyPairB = ECPair.fromPrivateKey(
    Buffer.from(nodeB.derive(0).derive(0).privateKey!),
    { network: NET },
  )

  for (let i = 0; i < psbt.data.inputs.length; i++) {
    psbt.signInput(i, {
      publicKey: Buffer.from(keyPairA.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPairA.sign(hash)),
    })
    psbt.signInput(i, {
      publicKey: Buffer.from(keyPairB.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPairB.sign(hash)),
    })
  }
}

function buildFullySignedPsbt(): bitcoin.Psbt {
  const psbt = buildUnsignedPsbt()
  signPsbtWithTwoKeys(psbt)
  return psbt
}

// ---------------------------------------------------------------------------
// analyzePsbt
// ---------------------------------------------------------------------------

describe('analyzePsbt', () => {
  it('returns the correct input count for a single-input PSBT', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.inputCount).toBe(1)
  })

  it('returns the correct output count', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.outputCount).toBe(1)
  })

  it('returns totalInputValue equal to the sum of witnessUtxo values', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.totalInputValue).toBe(Number(INPUT_VALUE))
  })

  it('returns totalOutputValue equal to the sum of output values', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.totalOutputValue).toBe(Number(SEND_VALUE))
  })

  it('returns the correct fee (input - output)', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.fee).toBe(Number(INPUT_VALUE) - Number(SEND_VALUE))
  })

  it('returns isFullySigned = false when there are no signatures', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.isFullySigned).toBe(false)
  })

  it('returns isFullySigned = false when only 1 of 2 required signatures is present', () => {
    const psbt = buildUnsignedPsbt()
    const keyPairA = ECPair.fromPrivateKey(
      Buffer.from(nodeA.derive(0).derive(0).privateKey!),
      { network: NET },
    )
    psbt.signInput(0, {
      publicKey: Buffer.from(keyPairA.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPairA.sign(hash)),
    })
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.isFullySigned).toBe(false)
    expect(analysis.signatureCount[0]).toBe(1)
  })

  it('returns isFullySigned = true when 2 of 2 required signatures are present', () => {
    const psbt = buildFullySignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.isFullySigned).toBe(true)
    expect(analysis.signatureCount[0]).toBe(2)
  })

  it('returns signatureCount array with one entry per input', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.signatureCount).toHaveLength(1)
    expect(analysis.signatureCount[0]).toBe(0)
  })

  it('reads requiredSignatures = 2 from the OP_2 byte in the witnessScript', () => {
    // OP_2 = 0x52 = 0x50 + 2, so requiredSignatures should be 2
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.requiredSignatures).toBe(2)
  })

  it('includes outputs array with correct address and value', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.outputs).toHaveLength(1)
    expect(analysis.outputs[0]!.address).toBe(DESTINATION)
    expect(analysis.outputs[0]!.value).toBe(Number(SEND_VALUE))
  })

  it('marks an output as change when its address matches escrowAddress', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet', DESTINATION)
    expect(analysis.outputs[0]!.isChange).toBe(true)
  })

  it('does not mark an output as change when escrowAddress does not match', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet', 'tb1qdifferentaddress')
    expect(analysis.outputs[0]!.isChange).toBe(false)
  })

  it('marks no outputs as change when escrowAddress is not provided', () => {
    const psbt = buildUnsignedPsbt()
    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.outputs.every((o) => !o.isChange)).toBe(true)
  })

  it('handles multi-input PSBT signature counts correctly', () => {
    const psbt = new bitcoin.Psbt({ network: NET })
    for (let i = 0; i < 3; i++) {
      psbt.addInput({
        hash: makeFakeTxid(String(i + 1)),
        index: 0,
        witnessUtxo: { script: SCRIPT_OUTPUT, value: BigInt(100_000) },
        witnessScript: WITNESS_SCRIPT,
      } as any)
    }
    psbt.addOutput({ address: DESTINATION, value: BigInt(280_000) })

    const analysis = analyzePsbt(psbt, 'testnet')
    expect(analysis.inputCount).toBe(3)
    expect(analysis.signatureCount).toHaveLength(3)
    expect(analysis.signatureCount.every((c) => c === 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// finalizePsbt
// ---------------------------------------------------------------------------

describe('finalizePsbt', () => {
  it('throws PSBT_ERROR when the PSBT has no signatures', () => {
    const psbt = buildUnsignedPsbt()
    expect(() => finalizePsbt(psbt)).toThrow(RecoveryError)
    try {
      finalizePsbt(buildUnsignedPsbt())
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
    }
  })

  it('throws PSBT_ERROR when only one of two required signatures is present', () => {
    const psbt = buildUnsignedPsbt()
    const keyPairA = ECPair.fromPrivateKey(
      Buffer.from(nodeA.derive(0).derive(0).privateKey!),
      { network: NET },
    )
    psbt.signInput(0, {
      publicKey: Buffer.from(keyPairA.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPairA.sign(hash)),
    })
    expect(() => finalizePsbt(psbt)).toThrow(RecoveryError)
    try {
      finalizePsbt(psbt)
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
    }
  })

  it('succeeds and returns a PSBT when fully signed', () => {
    const psbt = buildFullySignedPsbt()
    const result = finalizePsbt(psbt)
    expect(result).toBeDefined()
  })

  it('returns the same PSBT object (mutates and returns)', () => {
    const psbt = buildFullySignedPsbt()
    const returned = finalizePsbt(psbt)
    expect(returned).toBe(psbt)
  })

  it('marks inputs as finalized after finalizePsbt', () => {
    const psbt = buildFullySignedPsbt()
    finalizePsbt(psbt)
    // finalScriptWitness is set on each finalized input
    const input = psbt.data.inputs[0]!
    expect(input.finalScriptWitness).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// extractRawTransaction
// ---------------------------------------------------------------------------

describe('extractRawTransaction', () => {
  it('returns a non-empty hex string from a finalized PSBT', () => {
    const psbt = buildFullySignedPsbt()
    finalizePsbt(psbt)
    const hex = extractRawTransaction(psbt)
    expect(typeof hex).toBe('string')
    expect(hex.length).toBeGreaterThan(0)
  })

  it('returns a valid lowercase hex string', () => {
    const psbt = buildFullySignedPsbt()
    finalizePsbt(psbt)
    const hex = extractRawTransaction(psbt)
    expect(hex).toMatch(/^[0-9a-f]+$/)
  })

  it('extracted transaction contains the correct output value', () => {
    const psbt = buildFullySignedPsbt()
    finalizePsbt(psbt)
    const hex = extractRawTransaction(psbt)
    // Decode and verify via bitcoinjs-lib
    const tx = bitcoin.Transaction.fromHex(hex)
    expect(tx.outs[0]!.value).toBe(SEND_VALUE)
  })

  it('throws PSBT_ERROR when trying to extract from an unsigned (unfinalized) PSBT', () => {
    const psbt = buildUnsignedPsbt()
    expect(() => extractRawTransaction(psbt)).toThrow(RecoveryError)
    try {
      extractRawTransaction(buildUnsignedPsbt())
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
    }
  })

  it('the extracted transaction has correct version = 2', () => {
    const psbt = buildFullySignedPsbt()
    finalizePsbt(psbt)
    const hex = extractRawTransaction(psbt)
    const tx = bitcoin.Transaction.fromHex(hex)
    // bitcoinjs-lib default version is 2
    expect(tx.version).toBe(2)
  })

  it('the extracted transaction has one input and one output', () => {
    const psbt = buildFullySignedPsbt()
    finalizePsbt(psbt)
    const hex = extractRawTransaction(psbt)
    const tx = bitcoin.Transaction.fromHex(hex)
    expect(tx.ins).toHaveLength(1)
    expect(tx.outs).toHaveLength(1)
  })
})
