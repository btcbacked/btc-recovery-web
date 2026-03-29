import { RecoveryError } from './errors'

export type Utxo = {
  txid: string
  vout: number
  value: number
  status: { confirmed: boolean; block_height?: number; block_time?: number }
}

export type FeeEstimates = {
  fastestFee: number
  halfHourFee: number
  hourFee: number
  economyFee: number
  minimumFee: number
}

const FETCH_TIMEOUT_MS = 30_000

function createTimeoutSignal(): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return controller.signal
}

function validateUtxo(u: unknown): u is Utxo {
  if (typeof u !== 'object' || u === null) return false
  const obj = u as Record<string, unknown>
  return typeof obj.txid === 'string' && typeof obj.value === 'number'
}

/**
 * Fetch unspent transaction outputs for a given address from mempool.space.
 */
export async function fetchUtxos(
  baseUrl: string,
  address: string,
): Promise<Utxo[]> {
  try {
    const response = await fetch(`${baseUrl}/address/${address}/utxo`, {
      signal: createTimeoutSignal(),
    })
    if (!response.ok) {
      throw new RecoveryError(
        'NETWORK_ERROR',
        `Failed to fetch UTXOs: HTTP ${response.status}`,
      )
    }
    const data: unknown = await response.json()
    if (!Array.isArray(data)) {
      throw new RecoveryError(
        'NETWORK_ERROR',
        'Unexpected UTXO response format: expected an array.',
      )
    }
    for (const item of data) {
      if (!validateUtxo(item)) {
        throw new RecoveryError(
          'NETWORK_ERROR',
          'Unexpected UTXO response format: invalid entry.',
        )
      }
    }
    return data as Utxo[]
  } catch (err) {
    if (err instanceof RecoveryError) throw err
    throw new RecoveryError(
      'NETWORK_ERROR',
      'Failed to connect to the blockchain API. Check your network connection.',
      String(err),
    )
  }
}

/**
 * Fetch recommended fee estimates from mempool.space.
 */
export async function fetchFeeEstimates(
  baseUrl: string,
): Promise<FeeEstimates> {
  try {
    const response = await fetch(`${baseUrl}/v1/fees/recommended`, {
      signal: createTimeoutSignal(),
    })
    if (!response.ok) {
      throw new RecoveryError(
        'NETWORK_ERROR',
        `Failed to fetch fee estimates: HTTP ${response.status}`,
      )
    }
    const data: unknown = await response.json()
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).fastestFee !== 'number'
    ) {
      throw new RecoveryError(
        'NETWORK_ERROR',
        'Unexpected fee estimate response format.',
      )
    }
    return data as FeeEstimates
  } catch (err) {
    if (err instanceof RecoveryError) throw err
    throw new RecoveryError(
      'NETWORK_ERROR',
      'Failed to fetch fee estimates. Check your network connection.',
      String(err),
    )
  }
}

/**
 * Broadcast a signed raw transaction hex via mempool.space.
 * Returns the transaction ID on success.
 */
export async function broadcastTransaction(
  baseUrl: string,
  rawTxHex: string,
): Promise<string> {
  try {
    const response = await fetch(`${baseUrl}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawTxHex,
      signal: createTimeoutSignal(),
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new RecoveryError(
        'TRANSACTION_ERROR',
        `Broadcast failed: ${errorText}`,
      )
    }
    const txid = await response.text()
    if (typeof txid !== 'string' || txid.length === 0) {
      throw new RecoveryError(
        'TRANSACTION_ERROR',
        'Broadcast succeeded but returned an invalid transaction ID.',
      )
    }
    return txid
  } catch (err) {
    if (err instanceof RecoveryError) throw err
    throw new RecoveryError(
      'NETWORK_ERROR',
      'Failed to broadcast transaction. Check your network connection.',
      String(err),
    )
  }
}
