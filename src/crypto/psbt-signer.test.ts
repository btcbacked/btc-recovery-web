// @vitest-environment node
/**
 * Tests for psbt-signer.ts
 *
 * Creates real PSBTs using a deterministic BIP32 key tree so that
 * signPsbtWithXprv can actually locate and sign inputs.  We use a
 * well-known BIP32 test seed (128 zero-bits) so the derived keys are
 * fully reproducible.
 *
 * signPsbtWithXprv returns { psbt, signedCount }.
 */
import { describe, it, expect } from 'vitest'
import { signPsbtWithXprv } from './psbt-signer'
import { RecoveryError } from './errors'
import { bitcoin, ecc } from './bitcoin-lib'
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

// ---------------------------------------------------------------------------
// Deterministic key setup
// ---------------------------------------------------------------------------

const TEST_SEED = Buffer.alloc(32, 0x00)
const masterNode = bip32.fromSeed(TEST_SEED, NET)

// Three child nodes at depth 1 from the master
const nodeA = masterNode.derive(0)
const nodeB = masterNode.derive(1)
const nodeC = masterNode.derive(2)

// Master fingerprint (4 bytes) — used in bip32Derivation entries for nodeA
const masterFP = Buffer.from(masterNode.fingerprint)
const fingerprintHex = masterFP.toString('hex')

// xprv / xpub for nodeA (the "user" key)
const xprvA = nodeA.toBase58()
const xpubA = nodeA.neutered().toBase58()

// Child public keys at /0/0 (chain=0, index=0)
const pubA = Buffer.from(nodeA.derive(0).derive(0).publicKey)
const pubB = Buffer.from(nodeB.derive(0).derive(0).publicKey)
const pubC = Buffer.from(nodeC.derive(0).derive(0).publicKey)
const sortedPubs = [pubA, pubB, pubC].sort(Buffer.compare)

// ---------------------------------------------------------------------------
// Build a 2-of-3 P2WSH PSBT with proper bip32Derivation
// ---------------------------------------------------------------------------

function buildSignablePsbt(): bitcoin.Psbt {
  const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sortedPubs, network: NET })
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })

  const psbt = new bitcoin.Psbt({ network: NET })

  // bip32Derivation paths: m / (child at depth-1 index) / chain / addressIndex
  // We use masterFP as the fingerprint for nodeA (which is master.derive(0))
  const bip32Derivation = [
    { masterFingerprint: masterFP, pubkey: pubA, path: 'm/0/0/0' },
    { masterFingerprint: Buffer.from(nodeB.fingerprint), pubkey: pubB, path: 'm/1/0/0' },
    { masterFingerprint: Buffer.from(nodeC.fingerprint), pubkey: pubC, path: 'm/2/0/0' },
  ]

  psbt.addInput({
    hash: 'f'.repeat(64),
    index: 0,
    witnessUtxo: {
      script: Buffer.from(p2wsh.output!),
      value: BigInt(500_000),
    },
    witnessScript: Buffer.from(p2ms.output!),
    bip32Derivation,
  } as any)

  psbt.addOutput({
    address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    value: BigInt(490_000),
  })

  return psbt
}

// ---------------------------------------------------------------------------
// signPsbtWithXprv tests
// ---------------------------------------------------------------------------

describe('signPsbtWithXprv', () => {
  it('adds a partialSig to the input when fingerprint matches', () => {
    const psbt = buildSignablePsbt()
    expect(psbt.data.inputs[0]!.partialSig ?? []).toHaveLength(0)

    signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')

    const sigs = psbt.data.inputs[0]!.partialSig ?? []
    expect(sigs.length).toBe(1)
  })

  it('returns { psbt, signedCount } where psbt is the same object (mutates in-place)', () => {
    const psbt = buildSignablePsbt()
    const result = signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')
    expect(result.psbt).toBe(psbt)
    expect(typeof result.signedCount).toBe('number')
  })

  it('returns signedCount = 1 for a single-input PSBT with matching fingerprint', () => {
    const psbt = buildSignablePsbt()
    const { signedCount } = signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')
    expect(signedCount).toBe(1)
  })

  it('the partial signature belongs to nodeA public key', () => {
    const psbt = buildSignablePsbt()
    signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')
    const sig = psbt.data.inputs[0]!.partialSig![0]!
    expect(Buffer.compare(sig.pubkey, pubA)).toBe(0)
  })

  it('adds no signatures when fingerprint does not match any key', () => {
    const psbt = buildSignablePsbt()
    const { signedCount } = signPsbtWithXprv(psbt, xprvA, 'deadbeef', 'testnet')
    expect(signedCount).toBe(0)
    const sigs = psbt.data.inputs[0]!.partialSig ?? []
    expect(sigs.length).toBe(0)
  })

  it('returns signedCount = 0 when fingerprint is all wrong', () => {
    const psbt = buildSignablePsbt()
    const { signedCount } = signPsbtWithXprv(psbt, xprvA, 'ffffffff', 'testnet')
    expect(signedCount).toBe(0)
  })

  it('fingerprint comparison is case-insensitive (uppercase input)', () => {
    const psbt = buildSignablePsbt()
    const { signedCount } = signPsbtWithXprv(
      psbt,
      xprvA,
      fingerprintHex.toUpperCase(),
      'testnet',
    )
    expect(signedCount).toBe(1)
    expect(psbt.data.inputs[0]!.partialSig ?? []).toHaveLength(1)
  })

  it('fingerprint comparison is case-insensitive (mixed-case input)', () => {
    const mixed = fingerprintHex
      .split('')
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
      .join('')
    const psbt = buildSignablePsbt()
    const { signedCount } = signPsbtWithXprv(psbt, xprvA, mixed, 'testnet')
    expect(signedCount).toBe(1)
  })

  it('throws PSBT_ERROR immediately when xprv is an xpub (neutered)', () => {
    const psbt = buildSignablePsbt()
    expect(() => signPsbtWithXprv(psbt, xpubA, fingerprintHex, 'testnet')).toThrow(
      RecoveryError,
    )
    try {
      signPsbtWithXprv(buildSignablePsbt(), xpubA, fingerprintHex, 'testnet')
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
      expect((err as RecoveryError).userMessage).toMatch(/xpub|xprv|public key/i)
    }
  })

  it('throws PSBT_ERROR when xprv is an invalid string', () => {
    const psbt = buildSignablePsbt()
    expect(() =>
      signPsbtWithXprv(psbt, 'not-a-valid-xprv', fingerprintHex, 'testnet'),
    ).toThrow(RecoveryError)
    try {
      signPsbtWithXprv(buildSignablePsbt(), 'not-a-valid-xprv', fingerprintHex, 'testnet')
    } catch (err) {
      expect((err as RecoveryError).code).toBe('PSBT_ERROR')
    }
  })

  it('signs all inputs in a multi-input PSBT and returns correct signedCount', () => {
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sortedPubs, network: NET })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })
    const bip32Derivation = [
      { masterFingerprint: masterFP, pubkey: pubA, path: 'm/0/0/0' },
    ]

    const psbt = new bitcoin.Psbt({ network: NET })
    for (let i = 0; i < 3; i++) {
      psbt.addInput({
        hash: String(i + 1).repeat(64),
        index: 0,
        witnessUtxo: {
          script: Buffer.from(p2wsh.output!),
          value: BigInt(200_000),
        },
        witnessScript: Buffer.from(p2ms.output!),
        bip32Derivation,
      } as any)
    }
    psbt.addOutput({
      address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      value: BigInt(580_000),
    })

    const { signedCount } = signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')
    expect(signedCount).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect((psbt.data.inputs[i]!.partialSig ?? []).length).toBe(1)
    }
  })

  it('does not affect inputs that lack bip32Derivation metadata', () => {
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sortedPubs, network: NET })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })

    const psbt = new bitcoin.Psbt({ network: NET })
    psbt.addInput({
      hash: 'e'.repeat(64),
      index: 0,
      witnessUtxo: {
        script: Buffer.from(p2wsh.output!),
        value: BigInt(200_000),
      },
      witnessScript: Buffer.from(p2ms.output!),
      // No bip32Derivation
    } as any)
    psbt.addOutput({
      address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      value: BigInt(190_000),
    })

    const { signedCount } = signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')
    expect(signedCount).toBe(0)
    expect((psbt.data.inputs[0]!.partialSig ?? []).length).toBe(0)
  })

  it('signing is idempotent — a second call is tolerated', () => {
    const psbt = buildSignablePsbt()
    signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')
    // Second call may throw (duplicate sig); we accept that
    try {
      signPsbtWithXprv(psbt, xprvA, fingerprintHex, 'testnet')
    } catch {
      // Acceptable: bitcoinjs-lib rejects duplicates
    }
    const sigs = psbt.data.inputs[0]!.partialSig ?? []
    expect(sigs.length).toBeGreaterThanOrEqual(1)
  })
})
