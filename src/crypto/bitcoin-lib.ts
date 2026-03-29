// Buffer polyfill MUST be set before ecpair/bitcoinjs-lib load —
// ESM hoists imports so main.tsx's polyfill runs too late for transitive deps.
import { Buffer } from 'buffer'
;(globalThis as Record<string, unknown>).Buffer = Buffer

import * as ecc from '@bitcoinerlab/secp256k1'
import * as bitcoin from 'bitcoinjs-lib'
import { ECPairFactory } from 'ecpair'

bitcoin.initEccLib(ecc)
const ECPair = ECPairFactory(ecc)

export { bitcoin, ECPair, ecc }
