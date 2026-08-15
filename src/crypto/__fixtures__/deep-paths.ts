/**
 * Fixtures at the derivation depth production actually uses.
 *
 * Most fixtures in this repo use the 4 level origin `48'/1'/0'/2'`, which is
 * what the shipped backend writes. This one covers the other valid shape: an
 * escrow key carrying a per contract branch, so the origin is 6 levels
 * (`48'/1'/0'/2'/0/BRANCH`) and the full signing path is 8 levels
 * (`.../chain/index`). The platform key is a BIP-88 key at 4 levels, so such a
 * descriptor mixes depths inside one `sortedmulti`.
 *
 * Both shapes are live, so neither this fixture nor the 4 level ones can be
 * dropped in favour of the other.
 *
 * Shape copied from a real testnet descriptor:
 *   wsh(sortedmulti(2,
 *     [32a29ff7/48h/1h/0h/2h/0/7]tpub.../0/*,      <- depth 6
 *     [753adf1c/88h/1h/0h/0h]tpub.../0/*,          <- depth 4 (platform)
 *     [e89a1691/48h/1h/0h/2h/0/2]tpub.../0/*))     <- depth 6
 *
 * The keys here are derived from fixed test seeds, so nothing secret is in
 * this file and every value can be recomputed.
 */
import { BIP32Factory } from 'bip32'
import { Buffer } from 'buffer'
import { bitcoin, ecc } from '../bitcoin-lib'

const bip32 = BIP32Factory(ecc)
const NET = bitcoin.networks.testnet

/** Origin path of a user (borrower or lender) key: BIP-48 plus a branch. */
export const USER_ORIGIN_PATH = "48'/1'/0'/2'/0/7"
/** Origin path of the other user's key, on a different branch. */
export const COSIGNER_ORIGIN_PATH = "48'/1'/0'/2'/0/2"
/** Origin path of the platform key: BIP-88, 4 levels, no branch. */
export const PLATFORM_ORIGIN_PATH = "88'/1'/0'/0'"

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

export const USER_MASTER = master(0x11)
const COSIGNER_MASTER = master(0x22)
const PLATFORM_MASTER = master(0x33)

export const USER_FINGERPRINT = fingerprintHex(USER_MASTER)
export const COSIGNER_FINGERPRINT = fingerprintHex(COSIGNER_MASTER)
export const PLATFORM_FINGERPRINT = fingerprintHex(PLATFORM_MASTER)

/** The node at the 6 level origin: what the recovery file's xpub describes. */
export const USER_ORIGIN_NODE = USER_MASTER.derivePath(`m/${USER_ORIGIN_PATH}`)
export const COSIGNER_ORIGIN_NODE = COSIGNER_MASTER.derivePath(
  `m/${COSIGNER_ORIGIN_PATH}`,
)
export const PLATFORM_ORIGIN_NODE = PLATFORM_MASTER.derivePath(
  `m/${PLATFORM_ORIGIN_PATH}`,
)

export const USER_XPRV = USER_ORIGIN_NODE.toBase58()
export const USER_XPUB = USER_ORIGIN_NODE.neutered().toBase58()
export const COSIGNER_XPRV = COSIGNER_ORIGIN_NODE.toBase58()
const COSIGNER_XPUB = COSIGNER_ORIGIN_NODE.neutered().toBase58()
export const PLATFORM_XPRV = PLATFORM_ORIGIN_NODE.toBase58()
const PLATFORM_XPUB = PLATFORM_ORIGIN_NODE.neutered().toBase58()

function leg(fingerprint: string, originPath: string, xpub: string): string {
  return `[${fingerprint}/${toHForm(originPath)}]${xpub}/0/*`
}

/**
 * A 2-of-3 descriptor whose legs are at 6, 4 and 6 origin levels: the real
 * production shape. Legs are sorted the way the backend sorts them.
 */
export const MIXED_DEPTH_DESCRIPTOR = `wsh(sortedmulti(2,${[
  leg(USER_FINGERPRINT, USER_ORIGIN_PATH, USER_XPUB),
  leg(COSIGNER_FINGERPRINT, COSIGNER_ORIGIN_PATH, COSIGNER_XPUB),
  leg(PLATFORM_FINGERPRINT, PLATFORM_ORIGIN_PATH, PLATFORM_XPUB),
]
  .sort()
  .join(',')}))`

/** The public key the user's key contributes to an address. */
export function userChildPubkey(chain: number, index: number): Buffer {
  return Buffer.from(USER_ORIGIN_NODE.derive(chain).derive(index).publicKey)
}
