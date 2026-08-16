// @vitest-environment node
/**
 * The shipped smoke-test fixtures must actually recover.
 *
 * `public/test-fixtures/` is what a person drops into the tool to check that
 * the tool works at all, which in this tool's scenario is the moment they find
 * out whether their Bitcoin is reachable. A fixture with a made-up fingerprint
 * or an xpub that does not belong to the password fails at exactly the same
 * place a genuinely broken file would, so it teaches the reader nothing and
 * can send them looking for a fault that is not there.
 *
 * These tests run the real pipeline over the real files, so the fixtures
 * cannot drift away from the code that reads them.
 */
import { parseRecoveryFile } from './recovery-file'
import { getProfile } from './profiles'
import { deriveSigningKey } from './derivation'
import { replaceKeyByFingerprint } from './descriptor'
import { parseDescriptor, findUserKey } from './descriptor-parser'
import { deriveMultisigAddress } from './address'
import { originPathWarning } from './origin-path'

/** The password both password fixtures are built from. Documented in README. */
const FIXTURE_PASSWORD = 'btcbacked-recovery-demo'

/**
 * The fixture files exactly as they ship, read as text rather than as parsed
 * JSON so that `parseRecoveryFile` sees the same bytes a browser would.
 */
const FIXTURE_SOURCES = import.meta.glob(
  '../../public/test-fixtures/*.json',
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

function loadFixture(name: string): string {
  const entry = Object.entries(FIXTURE_SOURCES).find(([path]) =>
    path.endsWith(`/${name}`),
  )
  if (!entry) throw new Error(`Fixture not found: ${name}`)
  return entry[1]
}

/**
 * Both shapes in circulation: the 4 level account and the 6 level branch.
 *
 * The 4 level one also carries the leading `m/` the backend writes into
 * `userKey.derivationPath` and strips from the descriptor bracket, so the two
 * fields differ as text in the way every genuine file's do. Any check that
 * compares them has to survive that, and without a fixture in this shape it
 * would go green while refusing every real customer. Do not remove the `m/`.
 */
const PASSWORD_FIXTURES = [
  ['valid_password_recovery.json', "m/48'/1'/0'/2'", 4],
  ['valid_password_recovery_6level.json', '48h/1h/0h/2h/0/7', 6],
] as const

describe('shipped password recovery fixtures', () => {
  for (const [name, expectedPath, depth] of PASSWORD_FIXTURES) {
    describe(name, () => {
      const file = parseRecoveryFile(loadFixture(name))

      it(`records a ${depth} level derivation path`, () => {
        expect(file.userKey.derivationPath).toBe(expectedPath)
        expect(
          file.userKey.derivationPath.replace(/^m\//, '').split('/'),
        ).toHaveLength(depth)
      })

      it('is not reported as disagreeing with its own descriptor', () => {
        // The bracket in this file carries no `m/` and the recorded path may.
        // A naive comparison of the two fields reports this fixture, which is
        // exactly what it would do to a customer's file.
        expect(originPathWarning(file)).toBeNull()
      })

      it('recovers the signing key from the documented password', async () => {
        const profile = getProfile(file.userKey.derivationProfile!)
        expect(profile).not.toBeNull()

        // This is the whole point: a fixture with a made-up fingerprint throws
        // FINGERPRINT_MISMATCH here, and one with an unrelated xpub throws
        // KEY_MISMATCH. Reaching a tprv means every value in the file agrees.
        const xprv = await deriveSigningKey({
          password: FIXTURE_PASSWORD,
          saltHex: file.userKey.salt!,
          derivationPath: file.userKey.derivationPath,
          expectedFingerprint: file.userKey.fingerprint,
          expectedXpub: file.userKey.xpub,
          network: file.network,
          profile: profile!,
        })

        expect(xprv.startsWith('tprv')).toBe(true)
      })

      it("carries the user's own key in the descriptor", () => {
        const parsed = parseDescriptor(file.outputDescriptor)
        expect(parsed.threshold).toBe(file.context.threshold)
        expect(parsed.keys).toHaveLength(file.context.totalKeys)

        const leg = findUserKey(parsed, file.userKey.fingerprint)
        expect(leg).not.toBeNull()
        expect(leg!.key.extendedKey).toBe(file.userKey.xpub)
      })

      it('produces an importable descriptor and a spendable address', async () => {
        const profile = getProfile(file.userKey.derivationProfile!)!
        const xprv = await deriveSigningKey({
          password: FIXTURE_PASSWORD,
          saltHex: file.userKey.salt!,
          derivationPath: file.userKey.derivationPath,
          expectedFingerprint: file.userKey.fingerprint,
          expectedXpub: file.userKey.xpub,
          network: file.network,
          profile,
        })

        const descriptor = replaceKeyByFingerprint(
          file.outputDescriptor,
          file.userKey.fingerprint,
          xprv,
          file.userKey.xpub,
        )
        expect(descriptor).toContain(xprv)
        expect(descriptor).toContain('#')

        // A testnet P2WSH address, which is what the escrow summary shows.
        const address = deriveMultisigAddress(
          parseDescriptor(file.outputDescriptor),
          0,
          file.network,
        )
        expect(address.address.startsWith('tb1q')).toBe(true)
      })
    })
  }

  it('mixes origin depths in the 6 level file, as a real escrow does', () => {
    const file = parseRecoveryFile(
      loadFixture('valid_password_recovery_6level.json'),
    )
    const depths = parseDescriptor(file.outputDescriptor).keys.map(
      (k) => k.originPath.split('/').length,
    )
    // The platform key is a BIP-88 key at 4 levels while the two user keys sit
    // at 6, so this fixture exercises the mixed-depth case rather than hiding it.
    expect(new Set(depths)).toEqual(new Set([4, 6]))
  })
})

describe('shipped hardware recovery fixture', () => {
  it('parses and names a device rather than a password', () => {
    const file = parseRecoveryFile(loadFixture('valid_hardware_recovery.json'))
    expect(file.userKey.keySource).not.toBe('PASSWORD')
    expect(file.userKey.salt).toBeUndefined()
  })

  it('carries the recorded path in the shape the backend writes it', () => {
    const file = parseRecoveryFile(loadFixture('valid_hardware_recovery.json'))
    // Same field, same normaliser, whatever the key source. A device held key
    // is the population the path check helps most, because registering the key
    // on a device is the one thing a wrong path actually breaks.
    expect(file.userKey.derivationPath.startsWith('m/')).toBe(true)
    expect(file.outputDescriptor).not.toContain('/m/')
    expect(originPathWarning(file)).toBeNull()
  })
})
