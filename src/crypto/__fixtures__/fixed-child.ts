/**
 * The LEGACY escrow shape, where the per contract branch lives in the child
 * suffix instead of the origin bracket.
 *
 * A customer registers one account and every contract is a branch of it. There
 * are two ways to write that in a descriptor, and they put the branch on
 * opposite sides of the `]`:
 *
 *   legacy, 6 levels:  [fp/48h/1h/0h/2h]tpub.../0/N     <- branch in the CHILD
 *   folded, 8 levels:  [fp/48h/1h/0h/2h/0/N]tpub.../0/*  <- branch in the ORIGIN
 *
 * The folded shape has never shipped and no folded escrow exists in any
 * database. The legacy shape is what is live, and **two funded production
 * escrows are in it**, with their borrower legs pinned at `/0/1` and `/0/2`.
 *
 * That is what broke the tool. It derived `/0/<index>` for every key and
 * ignored the suffix, so for those two escrows it produced a wallet holding
 * nothing: a zero balance, no warning, and a PSBT naming a public key that is
 * not in the witness script. Every other fixture in this repo ends `/0/*` on
 * every leg, which is why nothing caught it.
 *
 * The suffix is per key. `sortedmulti` places no constraint tying the legs
 * together, so these fixtures deliberately give each leg a different one.
 *
 * Origin depths follow production: BIP-48 account at 4 levels for the two user
 * legs, BIP-88 at 4 levels for the platform key. Everything is derived from
 * fixed test seeds, so nothing secret is in this file and every value can be
 * recomputed.
 */
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'
import { bitcoin, ecc } from '../bitcoin-lib'

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

/** BIP-48 account origin, 4 levels. The branch is NOT in here. */
export const ACCOUNT_ORIGIN_PATH = "48'/1'/0'/2'"
/** BIP-88 platform origin, 4 levels. */
export const PLATFORM_ORIGIN_PATH = "88'/1'/0'/0'"

/**
 * The child suffix each leg is pinned to. The borrower and lender values are
 * the two live production escrows' branches.
 */
export const BORROWER_CHILD = '0/1'
export const LENDER_CHILD = '0/2'
export const PLATFORM_CHILD = '0/0'

function master(fill: number) {
  return bip32.fromSeed(Buffer.alloc(32, fill), NET)
}

function fingerprintHex(node: { fingerprint: Uint8Array }): string {
  return Buffer.from(node.fingerprint).toString('hex')
}

/** Hardened markers as `h`, which is what the backend writes. */
function toHForm(path: string): string {
  return path.replace(/'/g, 'h')
}

const BORROWER_MASTER = master(0xa1)
const LENDER_MASTER = master(0xa2)
const PLATFORM_MASTER = master(0xa3)

export const BORROWER_FINGERPRINT = fingerprintHex(BORROWER_MASTER)
export const LENDER_FINGERPRINT = fingerprintHex(LENDER_MASTER)
export const PLATFORM_FINGERPRINT = fingerprintHex(PLATFORM_MASTER)

/** The node at each leg's origin: what the descriptor's xpub describes. */
const BORROWER_ORIGIN_NODE = BORROWER_MASTER.derivePath(`m/${ACCOUNT_ORIGIN_PATH}`)
const LENDER_ORIGIN_NODE = LENDER_MASTER.derivePath(`m/${ACCOUNT_ORIGIN_PATH}`)
const PLATFORM_ORIGIN_NODE = PLATFORM_MASTER.derivePath(`m/${PLATFORM_ORIGIN_PATH}`)

/** The extended private keys a recovery run rebuilds, for the signing tests. */
export const BORROWER_XPRV = BORROWER_ORIGIN_NODE.toBase58()
export const LENDER_XPRV = LENDER_ORIGIN_NODE.toBase58()

export type Leg = {
  fingerprint: string
  originPath: string
  childDerivation: string
  node: typeof BORROWER_ORIGIN_NODE
}

/** The three legs of the mismatched escrow, all pinned, all different. */
export const LEGS: Leg[] = [
  {
    fingerprint: BORROWER_FINGERPRINT,
    originPath: ACCOUNT_ORIGIN_PATH,
    childDerivation: BORROWER_CHILD,
    node: BORROWER_ORIGIN_NODE,
  },
  {
    fingerprint: LENDER_FINGERPRINT,
    originPath: ACCOUNT_ORIGIN_PATH,
    childDerivation: LENDER_CHILD,
    node: LENDER_ORIGIN_NODE,
  },
  {
    fingerprint: PLATFORM_FINGERPRINT,
    originPath: PLATFORM_ORIGIN_PATH,
    childDerivation: PLATFORM_CHILD,
    node: PLATFORM_ORIGIN_NODE,
  },
]

/**
 * A descriptor from an explicit set of legs.
 *
 * Exported so a test can vary one leg's suffix without string surgery on the
 * finished descriptor: the legs are sorted, so which leg sits where is not
 * something a caller should have to know.
 */
export function descriptorFrom(legs: Leg[]): string {
  const entries = legs
    .map(
      (leg) =>
        `[${leg.fingerprint}/${toHForm(leg.originPath)}]` +
        `${leg.node.neutered().toBase58()}` +
        `${leg.childDerivation === '' ? '' : `/${leg.childDerivation}`}`,
    )
    .sort()
  return `wsh(sortedmulti(2,${entries.join(',')}))`
}

/** Replace one leg's child suffix, keeping the rest of the escrow intact. */
export function withChild(legIndex: number, childDerivation: string): string {
  return descriptorFrom(
    LEGS.map((leg, i) => (i === legIndex ? { ...leg, childDerivation } : leg)),
  )
}

/**
 * The mismatched escrow: three legs, three different pinned child suffixes.
 * Every leg is fixed, so this escrow has exactly ONE address.
 */
export const MISMATCHED_CHILD_DESCRIPTOR = descriptorFrom(LEGS)

/**
 * The closer match to the two live escrows: the two user legs pinned to their
 * contract branch, the platform leg still ranging. Pinned and ranged legs in
 * one `sortedmulti`, which is the case a single global chain/index cannot
 * express at all.
 */
export const PINNED_AND_RANGED_DESCRIPTOR = descriptorFrom(
  LEGS.map((leg, i) => (i === 2 ? { ...leg, childDerivation: '0/*' } : leg)),
)

/**
 * The SAME keys and origins with the ordinary ranged suffix on every leg.
 *
 * This is what the old code effectively derived for the descriptors above,
 * because it ignored the suffix and always took `/0/<index>`. Keeping it here
 * lets a test assert the two are different, which is the whole defect.
 */
export const RANGED_EQUIVALENT_DESCRIPTOR = descriptorFrom(
  LEGS.map((leg) => ({ ...leg, childDerivation: '0/*' })),
)

/** The public key one leg contributes, at a given address index. */
export function legChildPubkey(leg: Leg, addressIndex = 0): Buffer {
  const [chain, index] = leg.childDerivation
    .split('/')
    .map((part) => (part === '*' ? addressIndex : Number(part))) as [number, number]
  return Buffer.from(leg.node.derive(chain).derive(index).publicKey)
}

/** The full BIP32 path a PSBT must record for one leg. */
export function legFullPath(leg: Leg, addressIndex = 0): string {
  const suffix = leg.childDerivation.replace('*', String(addressIndex))
  return `m/${leg.originPath}/${suffix}`
}
