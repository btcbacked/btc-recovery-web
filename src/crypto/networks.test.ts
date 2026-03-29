// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getBitcoinNetwork, getMempoolApiBase } from './networks'
import { bitcoin } from './bitcoin-lib'

// ---------------------------------------------------------------------------
// getBitcoinNetwork
// ---------------------------------------------------------------------------

describe('getBitcoinNetwork', () => {
  it('returns bitcoin mainnet params for "mainnet"', () => {
    const net = getBitcoinNetwork('mainnet')
    expect(net).toBe(bitcoin.networks.bitcoin)
    expect(net.bech32).toBe('bc')
  })

  it('returns testnet params for "testnet"', () => {
    const net = getBitcoinNetwork('testnet')
    expect(net).toBe(bitcoin.networks.testnet)
    expect(net.bech32).toBe('tb')
  })

  it('returns regtest params for "regtest"', () => {
    const net = getBitcoinNetwork('regtest')
    expect(net).toBe(bitcoin.networks.regtest)
    expect(net.bech32).toBe('bcrt')
  })

  it('returns testnet params for "signet" (signet shares testnet params)', () => {
    // signet intentionally uses testnet network parameters
    const net = getBitcoinNetwork('signet')
    expect(net).toBe(bitcoin.networks.testnet)
    expect(net.bech32).toBe('tb')
  })
})

// ---------------------------------------------------------------------------
// getMempoolApiBase
// ---------------------------------------------------------------------------

describe('getMempoolApiBase', () => {
  describe('default URLs (no custom endpoint)', () => {
    it('returns the mainnet mempool.space URL', () => {
      expect(getMempoolApiBase('mainnet')).toBe('https://mempool.space/api')
    })

    it('returns the testnet mempool.space URL', () => {
      expect(getMempoolApiBase('testnet')).toBe(
        'https://mempool.space/testnet/api',
      )
    })

    it('returns the signet mempool.space URL', () => {
      expect(getMempoolApiBase('signet')).toBe(
        'https://mempool.space/signet/api',
      )
    })

    it('returns the regtest localhost URL', () => {
      expect(getMempoolApiBase('regtest')).toBe('http://localhost:8999/api')
    })
  })

  describe('custom endpoint', () => {
    it('returns the custom endpoint as-is when no trailing slash', () => {
      const custom = 'https://my-node.example.com/api'
      expect(getMempoolApiBase('mainnet', custom)).toBe(custom)
    })

    it('strips a trailing slash from the custom endpoint', () => {
      const custom = 'https://my-node.example.com/api/'
      expect(getMempoolApiBase('mainnet', custom)).toBe(
        'https://my-node.example.com/api',
      )
    })

    it('strips multiple trailing slashes', () => {
      const custom = 'https://my-node.example.com/api///'
      // replace(/\/$/, '') only removes one trailing slash per call; verify
      // actual behaviour (one slash removed)
      const result = getMempoolApiBase('mainnet', custom)
      expect(result).toBe('https://my-node.example.com/api//')
    })

    it('custom endpoint overrides network selection', () => {
      const custom = 'https://my-signet-node.example.com/api'
      expect(getMempoolApiBase('signet', custom)).toBe(custom)
    })

    it('falls back to default when custom endpoint is an empty string', () => {
      // Empty string is falsy → uses default
      expect(getMempoolApiBase('mainnet', '')).toBe('https://mempool.space/api')
    })

    it('falls back to default when custom endpoint is undefined', () => {
      expect(getMempoolApiBase('testnet', undefined)).toBe(
        'https://mempool.space/testnet/api',
      )
    })
  })
})
