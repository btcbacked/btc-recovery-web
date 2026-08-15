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
import {
  USER_ORIGIN_NODE,
  USER_ORIGIN_PATH,
  USER_FINGERPRINT,
  USER_XPRV,
  USER_MASTER,
  COSIGNER_ORIGIN_NODE,
  COSIGNER_ORIGIN_PATH,
  COSIGNER_FINGERPRINT,
  COSIGNER_XPRV,
  PLATFORM_ORIGIN_NODE,
  PLATFORM_ORIGIN_PATH,
  PLATFORM_FINGERPRINT,
  PLATFORM_XPRV,
} from './__fixtures__/deep-paths'

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

// ---------------------------------------------------------------------------
// Signing at the depth production uses
//
// The tests above use synthetic 3 level paths (m/0/0/0). Real PSBTs carry an
// 8 level path for a user key (BIP-48 account, a per contract branch, then
// chain and index) and a 6 level path for the platform key, in the same input.
// signPsbtWithXprv reads the last two components positionally, so it must not
// notice either depth.
// ---------------------------------------------------------------------------

describe('signPsbtWithXprv at production depth', () => {
  function childPub(
    node: typeof USER_ORIGIN_NODE,
    chain: number,
    index: number,
  ): Buffer {
    return Buffer.from(node.derive(chain).derive(index).publicKey)
  }

  /**
   * A 2-of-3 input whose three legs sit at different origin depths, matching
   * the real descriptor shape.
   */
  function buildDeepPsbt(
    chain: number,
    index: number,
    overrides: { userPath?: string } = {},
  ): { psbt: bitcoin.Psbt; userPub: Buffer; platformPub: Buffer } {
    const userPub = childPub(USER_ORIGIN_NODE, chain, index)
    const cosignerPub = childPub(COSIGNER_ORIGIN_NODE, chain, index)
    const platformPub = childPub(PLATFORM_ORIGIN_NODE, chain, index)
    const pubkeys = [userPub, cosignerPub, platformPub].sort(Buffer.compare)

    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network: NET })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NET })

    const psbt = new bitcoin.Psbt({ network: NET })
    psbt.addInput({
      hash: 'a'.repeat(64),
      index: 0,
      witnessUtxo: {
        script: Buffer.from(p2wsh.output!),
        value: BigInt(500_000),
      },
      witnessScript: Buffer.from(p2ms.output!),
      bip32Derivation: [
        {
          masterFingerprint: Buffer.from(USER_FINGERPRINT, 'hex'),
          pubkey: userPub,
          path:
            overrides.userPath ?? `m/${USER_ORIGIN_PATH}/${chain}/${index}`,
        },
        {
          masterFingerprint: Buffer.from(COSIGNER_FINGERPRINT, 'hex'),
          pubkey: cosignerPub,
          path: `m/${COSIGNER_ORIGIN_PATH}/${chain}/${index}`,
        },
        {
          masterFingerprint: Buffer.from(PLATFORM_FINGERPRINT, 'hex'),
          pubkey: platformPub,
          path: `m/${PLATFORM_ORIGIN_PATH}/${chain}/${index}`,
        },
      ],
    } as any)
    psbt.addOutput({
      address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      value: BigInt(490_000),
    })

    return { psbt, userPub, platformPub }
  }

  it('the fixture really is 8 levels for a user key and 6 for the platform', () => {
    // Guards the test itself: if the fixture ever flattens back to 4 levels,
    // everything below stops proving anything.
    expect(`m/${USER_ORIGIN_PATH}/0/0`.split('/')).toHaveLength(9) // 'm' + 8
    expect(`m/${PLATFORM_ORIGIN_PATH}/0/0`.split('/')).toHaveLength(7) // 'm' + 6
  })

  it('signs the input with the xprv at the 6 level origin', () => {
    const { psbt, userPub } = buildDeepPsbt(0, 4)

    const { signedCount } = signPsbtWithXprv(
      psbt,
      USER_XPRV,
      USER_FINGERPRINT,
      'testnet',
    )

    expect(signedCount).toBe(1)
    const sig = psbt.data.inputs[0]!.partialSig![0]!
    expect(Buffer.compare(sig.pubkey, userPub)).toBe(0)
  })

  it('signs a change address, taking chain from the path not from a default', () => {
    const { psbt } = buildDeepPsbt(1, 9)

    signPsbtWithXprv(psbt, USER_XPRV, USER_FINGERPRINT, 'testnet')

    const sig = psbt.data.inputs[0]!.partialSig![0]!
    expect(
      Buffer.compare(sig.pubkey, childPub(USER_ORIGIN_NODE, 1, 9)),
    ).toBe(0)
  })

  it('signs the shallower platform leg with the same code path', () => {
    const { psbt, platformPub } = buildDeepPsbt(0, 4)

    const { signedCount } = signPsbtWithXprv(
      psbt,
      PLATFORM_XPRV,
      PLATFORM_FINGERPRINT,
      'testnet',
    )

    expect(signedCount).toBe(1)
    const sig = psbt.data.inputs[0]!.partialSig![0]!
    expect(Buffer.compare(sig.pubkey, platformPub)).toBe(0)
  })

  it('signs with the cosigner key on its own branch', () => {
    const { psbt } = buildDeepPsbt(0, 4)

    const { signedCount } = signPsbtWithXprv(
      psbt,
      COSIGNER_XPRV,
      COSIGNER_FINGERPRINT,
      'testnet',
    )

    expect(signedCount).toBe(1)
    const sig = psbt.data.inputs[0]!.partialSig![0]!
    expect(
      Buffer.compare(sig.pubkey, childPub(COSIGNER_ORIGIN_NODE, 0, 4)),
    ).toBe(0)
  })

  it('a sibling branch of the same account fails here with a generic message', () => {
    // Same wallet, same master fingerprint, one level different in the branch.
    // The fingerprint matches, so the signer reaches the key and only fails
    // when bitcoinjs finds the pubkey is not in the witness script. What the
    // customer sees at that point says nothing about a path.
    //
    // This is the end of the road that the recovery file consistency check in
    // derivation.ts exists to close off, several steps earlier.
    const { psbt } = buildDeepPsbt(0, 4)
    const siblingXprv = USER_MASTER.derivePath("m/48'/1'/0'/2'/0/8").toBase58()

    try {
      signPsbtWithXprv(psbt, siblingXprv, USER_FINGERPRINT, 'testnet')
      expect.fail('signing with the wrong branch should not succeed')
    } catch (e) {
      const err = e as RecoveryError
      expect(err.code).toBe('PSBT_ERROR')
      expect(err.userMessage).toBe('Failed to sign the transaction.')
    }
    expect(psbt.data.inputs[0]!.partialSig ?? []).toHaveLength(0)
  })

  it('rejects a hardened marker in the last two components at this depth', () => {
    const { psbt } = buildDeepPsbt(0, 4, {
      userPath: `m/${USER_ORIGIN_PATH}/0'/4`,
    })

    expect(() =>
      signPsbtWithXprv(psbt, USER_XPRV, USER_FINGERPRINT, 'testnet'),
    ).toThrow(RecoveryError)
  })
})
