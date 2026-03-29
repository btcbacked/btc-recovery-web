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
  crypto/         # Pure TS crypto modules (no React)
    descriptor-parser.ts  # Parse output descriptors
    address.ts           # Derive addresses from descriptors
    blockchain-api.ts    # Mempool.space integration
    psbt-builder.ts      # Create PSBT from UTXOs
    psbt-signer.ts       # Sign PSBT transactions
    psbt-finalizer.ts    # Finalize and extract signed txs
    psbt-codec.ts        # Encode/decode PSBT binary
    networks.ts          # Bitcoin network config (mainnet/testnet/signet/regtest)
    bitcoin-lib.ts       # bitcoinjs-lib & ecpair wrapper
    recovery-file.ts     # RecoveryFile type + parser/validator
    derivation.ts        # BIP39 seed → BIP32 master key → signing key derivation
    descriptor.ts        # Output descriptor manipulation and checksum
    profiles.ts          # Named derivation profiles (maps profile id → algo + path)
    validation.ts        # Fingerprint, hex, derivation path validators
    errors.ts            # RecoveryError class + typed error codes
    index.ts             # Barrel export for all crypto modules
  hooks/          # React hooks
    useRecoveryWizard.ts  # Wizard state machine (step, recoveryFile, descriptor, errors)
    useDerivation.ts      # Async key derivation with loading/error state
    useClipboard.ts       # Clipboard write with transient success state
    useTheme.ts           # Dark/light theme toggle, persisted to localStorage
    useNetworkConfig.ts   # Network selection and Mempool.space config
    useWalletState.ts     # Recovered keys and transaction state
    usePsbtWorkflow.ts    # PSBT creation, signing, and broadcasting
  lib/
    utils.ts            # cn() helper (clsx + tailwind-merge)
  components/     # UI: wizard orchestrator, step screens, layout, shared widgets
    AppLayout.tsx       # Page chrome: header (logo, theme toggle), main, footer
    RecoveryWizard.tsx  # Orchestrator: reads wizard state, renders the active step
    StepIndicator.tsx   # Progress bar showing current wizard position
    FileDropZone.tsx    # Drag-and-drop + file picker for the recovery JSON
    CopyButton.tsx      # Icon button that copies text to clipboard
    NetworkBadge.tsx    # Pill showing mainnet/testnet/signet/regtest
    SecurityBadge.tsx   # "All operations local" trust indicator
    steps/
      UploadStep.tsx    # Step 1: drop or select recovery file
      FileInfoStep.tsx  # Step 2: display parsed file metadata, confirm
      PasswordStep.tsx  # Step 3a: enter passphrase (PASSWORD key source)
      HardwareStep.tsx  # Step 3b: instructions for ColdCard (COLD_CARD key source)
      DerivingStep.tsx  # Step 4: async derivation in progress
      ResultStep.tsx    # Step 5: show recovered xprv + descriptor
      ActionChoiceStep.tsx  # Step 6a: choose Path A or Path B
      WalletViewStep.tsx    # Path A, Step 6b: view addresses and balances
      BuildTxStep.tsx       # Path A, Step 6c: create PSBT transaction
      ReviewSignStep.tsx    # Path A, Step 6d: review and sign transaction
      ExportPsbtStep.tsx    # Path A, Step 6e: export signed PSBT
      ImportPsbtStep.tsx    # Path B, Step 6b: import PSBT from file
      ReviewPsbtStep.tsx    # Path B, Step 6c: review co-sign transaction
      SignFinalizeStep.tsx  # Path B, Step 6d: sign and finalize PSBT
      BroadcastStep.tsx     # Path B, Step 6e: broadcast to blockchain
      GuideStep.tsx         # External wallet import guide
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

## Transaction Workflow

After recovering your signing key, you can transact on-chain using one of two paths:

### Path A: Create Transaction
1. **Wallet View** — Derive and display all addresses from your descriptor. Connect to blockchain to fetch UTXOs and check balances.
2. **Build Transaction** — Select UTXOs, specify outputs, and create an unsigned PSBT (Partially Signed Bitcoin Transaction).
3. **Review & Sign** — Review transaction details and sign with your recovered key.
4. **Export PSBT** — Export the fully-signed transaction for broadcast via Sparrow, Specter, or a public blockchain broadcaster.

### Path B: Co-Sign & Broadcast
1. **Import PSBT** — Upload a PSBT created by another party (e.g., the borrower in a multisig scenario).
2. **Review PSBT** — Inspect transaction inputs, outputs, and co-signer details.
3. **Sign & Finalize** — Apply your signature to the PSBT. If enough signatures are collected, finalize the transaction.
4. **Broadcast** — Send the fully-signed transaction to the Bitcoin network via Mempool.space API.

## Supported Wallets (External Import)

The tool can also output a recovered `xprv` and fully-checksummed output descriptor for import into external wallets:

- **Sparrow Wallet** — import via File > Import Wallet > Descriptor
- **Specter Desktop** — import via Add Wallet > Import from Descriptor
- **Bitcoin Core** — `importdescriptors` RPC call

The wizard provides step-by-step import instructions for each wallet.

## Blockchain API

The tool integrates with **Mempool.space** to fetch UTXOs and broadcast transactions:

- **Mainnet**: `https://mempool.space/api`
- **Testnet**: `https://testnet.mempool.space/api`
- **Signet**: `https://signet.mempool.space/api`

Network selection is automatic based on your recovery file's network field. The CSP (Content Security Policy) allows `connect-src` to Mempool.space domains.

## Security Note

**Private keys never leave the browser.** Only public addresses and fully-signed transactions are sent to the blockchain API. All cryptographic operations (key derivation, PSBT signing, transaction finalization) run entirely in your browser — no server round-trips.

## Browser Requirements

- Chromium 94+, Firefox 93+, or Safari 15.4+ (ES2022 + WebCrypto SubtleCrypto required)
- JavaScript must be enabled
- No extensions or plugins required
