# BTCBacked Key Recovery Tool

A client-side browser tool for recovering Bitcoin signing keys from a BTCBacked recovery file. All cryptographic operations run locally — nothing is ever sent to a server.

## Security Guarantee

- **100% offline capable.** Once the page is loaded, you can disconnect from the internet. No requests leave your browser.
- All BIP39 seed derivation, BIP32 key derivation, and descriptor reconstruction happen in-browser using WebCrypto and pure JavaScript libraries.
- The production Content Security Policy blocks all outbound network connections (`connect-src 'none'`).

## Getting Started

```bash
npm install
npm run dev       # starts at http://localhost:5176
```

To build for production:

```bash
npm run build     # output in dist/
```

## Project Structure

```
src/
  crypto/         # Pure TS crypto modules (no React): parsing, derivation, descriptor
  hooks/          # React hooks: wizard state, async derivation, clipboard, theme
  components/     # UI: wizard orchestrator, step screens, layout, shared widgets
    steps/        # One component per wizard step (Upload → Info → Key → Result → Guide)
  main.tsx        # Entry: Buffer polyfill + React mount
  styles.css      # Tailwind + CSS design tokens (light/dark)
```

## Recovery File Format

Recovery files are JSON documents issued by the BTCBacked platform at contract creation. Required fields:

| Field | Type | Description |
|---|---|---|
| `version` | integer | File format version |
| `network` | string | `mainnet`, `testnet`, `signet`, or `regtest` |
| `outputDescriptor` | string | Multisig output descriptor with placeholder for user key |
| `context.contractId` | string | BTCBacked contract identifier |
| `context.role` | string | `borrower` or `lender` |
| `context.threshold` | integer | Minimum signatures required (e.g. `2`) |
| `context.totalKeys` | integer | Total keys in the multisig (e.g. `3`) |
| `userKey.keySource` | string | `PASSWORD` (passphrase-derived) or `COLD_CARD` (hardware wallet) |
| `userKey.derivationPath` | string | BIP32 path used for the signing key |
| `userKey.xpub` | string | Extended public key registered at contract creation |
| `userKey.fingerprint` | string | Master key fingerprint (4-byte hex) |
| `userKey.derivationProfile` | string? | Named profile for PBKDF2 parameters (PASSWORD only) |
| `userKey.salt` | string? | Hex-encoded PBKDF2 salt (PASSWORD only) |

## Supported Wallets

The tool outputs a recovered `xprv` and a fully-checksummed output descriptor compatible with:

- **Sparrow Wallet** — import via File > Import Wallet > Descriptor
- **Specter Desktop** — import via Add Wallet > Import from Descriptor
- **Bitcoin Core** — `importdescriptors` RPC call

The final wizard step provides step-by-step instructions for each wallet.

## Browser Requirements

- Chromium 94+, Firefox 93+, or Safari 15.4+ (ES2022 + WebCrypto SubtleCrypto required)
- JavaScript must be enabled
- No extensions or plugins required
