// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchUtxos, fetchFeeEstimates, broadcastTransaction } from './blockchain-api'
import { RecoveryError } from './errors'

// ---------------------------------------------------------------------------
// Helpers to create minimal Response-like mock objects
// ---------------------------------------------------------------------------

function makeResponse(options: {
  ok: boolean
  status?: number
  json?: unknown
  text?: string
}): Response {
  return {
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 500),
    json: vi.fn().mockResolvedValue(options.json ?? null),
    text: vi.fn().mockResolvedValue(options.text ?? ''),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const BASE_URL = 'https://mempool.space/testnet/api'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// fetchUtxos
// ---------------------------------------------------------------------------

describe('fetchUtxos', () => {
  const ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'

  it('calls the correct URL', async () => {
    const mockFetch = vi.mocked(fetch)
    const utxos = [{ txid: 'abc', vout: 0, value: 1000, status: { confirmed: true } }]
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, json: utxos }))
    await fetchUtxos(BASE_URL, ADDRESS)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0]!
    expect(url).toBe(`${BASE_URL}/address/${ADDRESS}/utxo`)
  })

  it('passes an AbortSignal for timeout', async () => {
    const mockFetch = vi.mocked(fetch)
    const utxos = [{ txid: 'abc', vout: 0, value: 1000, status: { confirmed: true } }]
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, json: utxos }))
    await fetchUtxos(BASE_URL, ADDRESS)
    const [, init] = mockFetch.mock.calls[0]!
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('returns the parsed UTXO array on HTTP 200', async () => {
    const utxos = [
      {
        txid: 'abc123',
        vout: 0,
        value: 100000,
        status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
      },
      {
        txid: 'def456',
        vout: 1,
        value: 50000,
        status: { confirmed: false },
      },
    ]
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, json: utxos }))
    const result = await fetchUtxos(BASE_URL, ADDRESS)
    expect(result).toEqual(utxos)
    expect(result).toHaveLength(2)
  })

  it('returns an empty array when the address has no UTXOs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, json: [] }))
    const result = await fetchUtxos(BASE_URL, ADDRESS)
    expect(result).toEqual([])
  })

  it('throws NETWORK_ERROR on HTTP 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 404 }))
    await expect(fetchUtxos(BASE_URL, ADDRESS)).rejects.toThrow(RecoveryError)
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 404 }))
    try {
      await fetchUtxos(BASE_URL, ADDRESS)
    } catch (err) {
      expect((err as RecoveryError).code).toBe('NETWORK_ERROR')
      expect((err as RecoveryError).userMessage).toContain('HTTP 404')
    }
  })

  it('throws NETWORK_ERROR on HTTP 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }))
    await expect(fetchUtxos(BASE_URL, ADDRESS)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('throws NETWORK_ERROR when fetch itself rejects (network down)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(fetchUtxos(BASE_URL, ADDRESS)).rejects.toThrow(RecoveryError)
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    try {
      await fetchUtxos(BASE_URL, ADDRESS)
    } catch (err) {
      expect((err as RecoveryError).code).toBe('NETWORK_ERROR')
      expect((err as RecoveryError).userMessage).toContain('connect')
    }
  })

  it('throws NETWORK_ERROR when response JSON is not an array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, json: { error: 'bad' } }))
    await expect(fetchUtxos(BASE_URL, ADDRESS)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('throws NETWORK_ERROR when a UTXO entry is missing required fields', async () => {
    // An entry without txid/value is invalid
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: true, json: [{ vout: 0 }] }),
    )
    await expect(fetchUtxos(BASE_URL, ADDRESS)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })
})

// ---------------------------------------------------------------------------
// fetchFeeEstimates
// ---------------------------------------------------------------------------

describe('fetchFeeEstimates', () => {
  const validResponse = {
    fastestFee: 20,
    halfHourFee: 15,
    hourFee: 10,
    economyFee: 5,
    minimumFee: 1,
  }

  it('calls the correct URL', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, json: validResponse }))
    await fetchFeeEstimates(BASE_URL)
    const [url] = mockFetch.mock.calls[0]!
    expect(url).toBe(`${BASE_URL}/v1/fees/recommended`)
  })

  it('passes an AbortSignal for timeout', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, json: validResponse }))
    await fetchFeeEstimates(BASE_URL)
    const [, init] = mockFetch.mock.calls[0]!
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('returns the parsed fee estimates object on HTTP 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, json: validResponse }))
    const result = await fetchFeeEstimates(BASE_URL)
    expect(result).toEqual(validResponse)
    expect(result.fastestFee).toBe(20)
    expect(result.minimumFee).toBe(1)
  })

  it('throws NETWORK_ERROR on HTTP error status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 503 }))
    await expect(fetchFeeEstimates(BASE_URL)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('includes the HTTP status in the error message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 429 }))
    try {
      await fetchFeeEstimates(BASE_URL)
    } catch (err) {
      expect((err as RecoveryError).userMessage).toContain('HTTP 429')
    }
  })

  it('throws NETWORK_ERROR when fetch rejects', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('DNS failure'))
    await expect(fetchFeeEstimates(BASE_URL)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('throws NETWORK_ERROR when response is missing fastestFee', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: true, json: { hourFee: 5 } }),
    )
    await expect(fetchFeeEstimates(BASE_URL)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })
})

// ---------------------------------------------------------------------------
// broadcastTransaction
// ---------------------------------------------------------------------------

describe('broadcastTransaction', () => {
  const RAW_TX_HEX = '0200000001' + 'ab'.repeat(32) + '00000000' + 'ff'
  const EXPECTED_TXID =
    'aabb112233445566778899001122334455667788990011223344556677889900aabb'

  it('sends a POST request to the correct URL', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, text: EXPECTED_TXID }))
    await broadcastTransaction(BASE_URL, RAW_TX_HEX)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0]!
    expect(url).toBe(`${BASE_URL}/tx`)
  })

  it('sends the raw tx hex as the request body', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, text: EXPECTED_TXID }))
    await broadcastTransaction(BASE_URL, RAW_TX_HEX)
    const [, init] = mockFetch.mock.calls[0]!
    expect((init as RequestInit).body).toBe(RAW_TX_HEX)
  })

  it('uses POST method', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, text: EXPECTED_TXID }))
    await broadcastTransaction(BASE_URL, RAW_TX_HEX)
    const [, init] = mockFetch.mock.calls[0]!
    expect((init as RequestInit).method).toBe('POST')
  })

  it('sets Content-Type: text/plain header', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, text: EXPECTED_TXID }))
    await broadcastTransaction(BASE_URL, RAW_TX_HEX)
    const [, init] = mockFetch.mock.calls[0]!
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'text/plain',
    })
  })

  it('passes an AbortSignal for timeout', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, text: EXPECTED_TXID }))
    await broadcastTransaction(BASE_URL, RAW_TX_HEX)
    const [, init] = mockFetch.mock.calls[0]!
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('returns the txid string on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, text: EXPECTED_TXID }))
    const txid = await broadcastTransaction(BASE_URL, RAW_TX_HEX)
    expect(txid).toBe(EXPECTED_TXID)
  })

  it('throws TRANSACTION_ERROR on HTTP 400 bad transaction', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 400, text: 'mandatory-script-verify-flag-failed' }),
    )
    await expect(broadcastTransaction(BASE_URL, RAW_TX_HEX)).rejects.toMatchObject({
      code: 'TRANSACTION_ERROR',
    })
  })

  it('includes the server error text in the TRANSACTION_ERROR message', async () => {
    const errorText = 'bad-txns-inputs-missingorspent'
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 400, text: errorText }),
    )
    try {
      await broadcastTransaction(BASE_URL, RAW_TX_HEX)
    } catch (err) {
      expect((err as RecoveryError).userMessage).toContain(errorText)
      expect((err as RecoveryError).code).toBe('TRANSACTION_ERROR')
    }
  })

  it('throws TRANSACTION_ERROR on HTTP 409 conflict', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 409, text: 'Transaction already in mempool' }),
    )
    await expect(broadcastTransaction(BASE_URL, RAW_TX_HEX)).rejects.toMatchObject({
      code: 'TRANSACTION_ERROR',
    })
  })

  it('throws NETWORK_ERROR when fetch rejects (connection failure)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network error'))
    await expect(broadcastTransaction(BASE_URL, RAW_TX_HEX)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })
})
