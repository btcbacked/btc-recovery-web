/**
 * Convert satoshis to BTC, displaying 8 decimal places.
 * e.g. formatBtc(100000000) => "1.00000000"
 */
export function formatBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8)
}

/**
 * Format a number of satoshis with comma separators.
 * e.g. formatSats(1234567) => "1,234,567"
 */
export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US')
}

/**
 * Truncate a txid or address for display, keeping the first and last N chars.
 * e.g. truncateHash("abcdef...xyz", 8) => "abcdef...xyz" (if long)
 */
export function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 3) return hash
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`
}
