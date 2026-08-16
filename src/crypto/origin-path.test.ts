/**
 * The derivation path recorded in a recovery file, against the path the same
 * file's descriptor records for the same key.
 *
 * The trap this file exists to keep shut: the two fields ALWAYS differ as text
 * in a genuine file, by a leading `m/`. A check comparing the strings passes
 * every test written from a hand made fixture and refuses every real customer.
 */
import { describe, it, expect } from 'vitest'
import { originPathWarning } from './origin-path'
import type { RecoveryFile } from './recovery-file'

const XPUB =
  'tpubDCxzhZZE3JFMcGNHVVdFh9r1nJ8RvmvXHxYCBjnRNdRNynnD2eLF9TUwP3CwrUUCLco6nBjiH3xYdPHrSbXqME93vgzC9MRfZ2Kb9K2hL5C'

/**
 * A file in the shape the backend writes: the recorded path carries the `m/`
 * that the descriptor bracket does not.
 */
function fileWith(recordedPath: string, bracketPath: string): RecoveryFile {
  return {
    version: 1,
    network: 'testnet',
    outputDescriptor:
      `wsh(sortedmulti(2,[bbbbbbbb/${bracketPath}]${XPUB}/0/*,` +
      `[cccccccc/88h/1h/0h/0h]${XPUB}/0/*))`,
    context: {
      contractId: 'c',
      role: 'borrower',
      threshold: 2,
      totalKeys: 2,
    },
    userKey: {
      keySource: 'PASSWORD',
      derivationProfile: 'pbkdf2-v1',
      salt: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      derivationPath: recordedPath,
      xpub: XPUB,
      fingerprint: 'BBBBBBBB',
    },
  }
}

describe('originPathWarning', () => {
  it('says nothing about the leading m/ the backend writes', () => {
    // This is 100% of real recovery files. A string comparison reports all of
    // them.
    expect(originPathWarning(fileWith('m/48h/1h/0h/2h', '48h/1h/0h/2h'))).toBeNull()
  })

  it('reads an apostrophe and an h as the same hardened marker', () => {
    expect(originPathWarning(fileWith("m/48'/1'/0'/2'", '48h/1h/0h/2h'))).toBeNull()
    expect(originPathWarning(fileWith('m/48h/1h/0h/2h', "48'/1'/0'/2'"))).toBeNull()
  })

  it('accepts a recorded path with no m/ as well', () => {
    expect(originPathWarning(fileWith('48h/1h/0h/2h', '48h/1h/0h/2h'))).toBeNull()
  })

  it('says nothing about a capital H in the descriptor bracket', () => {
    // A capital H is legal BIP-380 and this tool carries a bracket through
    // verbatim. The file side normaliser fails closed on it, which is right
    // there and would be wrong here.
    expect(originPathWarning(fileWith('m/48h/1h/0h/2h', '48H/1H/0H/2H'))).toBeNull()
  })

  it('reports a bracket naming a different branch, quoting both paths', () => {
    const warning = originPathWarning(
      fileWith('m/48h/1h/0h/2h/0/7', '48h/1h/0h/2h/0/9'),
    )

    expect(warning).not.toBeNull()
    expect(warning).toContain('m/48h/1h/0h/2h/0/7')
    expect(warning).toContain('48h/1h/0h/2h/0/9')
  })

  it('reports a bracket at the account level against a recorded branch', () => {
    // The stale file shape: the descriptor was written before the customer was
    // moved onto a per contract branch.
    expect(
      originPathWarning(fileWith('m/48h/1h/0h/2h/0/7', '48h/1h/0h/2h')),
    ).not.toBeNull()
  })

  it('says nothing when the question cannot be settled from the file', () => {
    // No leg for this fingerprint.
    const noLeg = fileWith('m/48h/1h/0h/2h', '48h/1h/0h/2h')
    noLeg.userKey.fingerprint = 'FFFFFFFF'
    expect(originPathWarning(noLeg)).toBeNull()

    // A descriptor this tool cannot parse at all.
    const unparseable = fileWith('m/48h/1h/0h/2h', '48h/1h/0h/2h')
    unparseable.outputDescriptor = 'not a descriptor'
    expect(originPathWarning(unparseable)).toBeNull()

    // A bracket carrying something that is not a path.
    expect(originPathWarning(fileWith('m/48h/1h/0h/2h', '48q/1q'))).toBeNull()

    // A recorded path that is not a path. Validation refuses these on upload,
    // so this only pins that the fallback is silence rather than an alarm.
    expect(originPathWarning(fileWith('not-a-path', '48h/1h/0h/2h'))).toBeNull()
  })

  it('says nothing for a device held key whose file is in the platform shape', () => {
    const device = fileWith('m/48h/1h/0h/2h/0/3', '48h/1h/0h/2h/0/3')
    device.userKey.keySource = 'COLD_CARD'
    expect(originPathWarning(device)).toBeNull()
  })

  it('reports a device held key whose paths disagree', () => {
    // A device is what reads the path, so this is the population the check
    // helps most.
    const device = fileWith('m/48h/1h/0h/2h/0/3', '48h/1h/0h/2h/0/4')
    device.userKey.keySource = 'COLD_CARD'
    expect(originPathWarning(device)).not.toBeNull()
  })

  it('uses no dashes in what the customer reads', () => {
    const warning = originPathWarning(
      fileWith('m/48h/1h/0h/2h/0/7', '48h/1h/0h/2h/0/9'),
    )
    expect(warning).not.toMatch(/[–—]/)
  })
})
