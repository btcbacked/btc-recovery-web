# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BTCBacked Key Recovery is a fully client-side React application that allows borrowers and lenders to recover their Bitcoin signing keys from a BTCBacked recovery file. All cryptographic operations (BIP39 seed derivation, BIP32 key derivation, descriptor reconstruction) run in the browser using WebCrypto and pure JS libraries. No data is ever sent to a server.

## Common Commands

```bash
# Development
npm run dev               # Vite dev server on port 5176 with HMR

# Building
npm run build             # TypeScript check + Vite production build

# Testing
npm run test              # Vitest one-shot run
npm run test:watch        # Vitest in watch mode

# Type checking
npm run type-check        # tsc --noEmit (no build output)

# Linting
npm run lint              # placeholder (ESLint not yet configured)
```

## Tech Stack

- **Framework**: React 19, TypeScript 5.7 (strict mode + noUncheckedIndexedAccess)
- **Build**: Vite 7, target ES2022
- **Styling**: Tailwind CSS 4 via `@tailwindcss/vite`, `tw-animate-css`
- **UI primitives**: Radix UI (Collapsible, Slot, Tabs, Tooltip), Lucide React icons, Sonner toasts
- **Bitcoin crypto**: `bip32`, `@bitcoinerlab/secp256k1`, Node `buffer` polyfill
- **Testing**: Vitest 3, jsdom, `@testing-library/react`
- **Path aliases**: `@/` maps to `src/`

## Architecture Overview

```
src/
  main.tsx              # Entry point — polyfills Buffer on globalThis, mounts React
  App.tsx               # Root: AppLayout + RecoveryWizard + Toaster
  styles.css            # Tailwind entry, CSS custom properties (design tokens), dark mode
  crypto/               # Pure TypeScript crypto modules (no React)
    descriptor-parser.ts  # Parse output descriptors
    address.ts            # Derive addresses from descriptors
    blockchain-api.ts     # Mempool.space integration (fetch UTXOs, broadcast txs)
    psbt-builder.ts       # Create PSBT from UTXOs
    psbt-signer.ts        # Sign PSBT transactions
    psbt-finalizer.ts     # Finalize and extract signed transactions
    psbt-codec.ts         # Encode/decode PSBT binary format
    networks.ts           # Bitcoin network config (mainnet/testnet/signet/regtest)
    bitcoin-lib.ts        # bitcoinjs-lib & ecpair wrapper
    recovery-file.ts      # RecoveryFile type + parser/validator
    derivation.ts         # BIP39 seed → BIP32 master key → signing key derivation
    descriptor.ts         # Output descriptor manipulation and checksum
    profiles.ts           # Named derivation profiles (maps profile id → algo + path)
    validation.ts         # Fingerprint, hex, derivation path validators
    errors.ts             # RecoveryError class + typed error codes
    index.ts              # Barrel export for all crypto modules
  hooks/
    useRecoveryWizard.ts    # Wizard state machine (step, recoveryFile, descriptor, errors)
    useDerivation.ts        # Async key derivation with loading/error state
    useClipboard.ts         # Clipboard write with transient success state
    useTheme.ts             # Dark/light theme toggle, persisted to localStorage
    useNetworkConfig.ts     # Network selection and Mempool.space config
    useWalletState.ts       # Recovered keys and transaction state
    usePsbtWorkflow.ts      # PSBT creation, signing, and broadcasting
  lib/
    utils.ts              # cn() helper (clsx + tailwind-merge)
  components/
    AppLayout.tsx         # Page chrome: header (logo, theme toggle), main, footer
    RecoveryWizard.tsx    # Orchestrator: reads wizard state, renders the active step
    StepIndicator.tsx     # Progress bar showing current wizard position
    FileDropZone.tsx      # Drag-and-drop + file picker for the recovery JSON
    CopyButton.tsx        # Icon button that copies text to clipboard
    NetworkBadge.tsx      # Pill showing mainnet/testnet/signet/regtest
    SecurityBadge.tsx     # "All operations local" trust indicator
    steps/
      UploadStep.tsx          # Step 1: drop or select recovery file
      FileInfoStep.tsx        # Step 2: display parsed file metadata, confirm
      PasswordStep.tsx        # Step 3a: enter passphrase (PASSWORD key source)
      HardwareStep.tsx        # Step 3b: instructions for ColdCard (COLD_CARD key source)
      DerivingStep.tsx        # Step 4: async derivation in progress
      ResultStep.tsx          # Step 5: show recovered xprv + descriptor
      ActionChoiceStep.tsx    # Step 6a: choose Path A or Path B
      WalletViewStep.tsx      # Path A, Step 6b: view addresses and balances
      BuildTxStep.tsx         # Path A, Step 6c: create PSBT transaction
      ReviewSignStep.tsx      # Path A, Step 6d: review and sign transaction
      ExportPsbtStep.tsx      # Path A, Step 6e: export signed PSBT
      ImportPsbtStep.tsx      # Path B, Step 6b: import PSBT from file
      ReviewPsbtStep.tsx      # Path B, Step 6c: review co-sign transaction
      SignFinalizeStep.tsx    # Path B, Step 6d: sign and finalize PSBT
      BroadcastStep.tsx       # Path B, Step 6e: broadcast to blockchain
      GuideStep.tsx           # External wallet import guide
```

### Wizard Flow

```
upload → info → password | hardware → deriving → result → action-choice
  1        2          3                   4          5          6a
                                                                  ├─ Path A: wallet-view → build-tx → review-sign → export-psbt
                                                                  │     6b          6c         6d           6e
                                                                  ├─ Path B: import-psbt → review-psbt → sign-finalize → broadcast
                                                                  │     6b          6c            6d           6e
                                                                  └─ guide (external wallet import)
```

- The step after `info` branches on `userKey.keySource`: `PASSWORD` → `PasswordStep`, `COLD_CARD` → `HardwareStep`.
- `DerivingStep` calls `useDerivation` which runs BIP39/BIP32 derivation asynchronously, then transitions automatically to `result`.
- `ActionChoiceStep` presents three options:
  - **Path A**: Create and broadcast your own transactions (single-sig or broadcasting from a multisig escrow).
  - **Path B**: Co-sign and broadcast transactions initiated by other parties.
  - **Guide**: Import recovered keys into external wallets (Sparrow, Specter, Bitcoin Core).
- **Path A** (`WalletViewStep` → `BuildTxStep` → `ReviewSignStep` → `ExportPsbtStep`): Derive addresses, fetch UTXOs, build and sign transactions.
- **Path B** (`ImportPsbtStep` → `ReviewPsbtStep` → `SignFinalizeStep` → `BroadcastStep`): Upload co-sign PSBTs, add your signature, and broadcast.

### Crypto Data Flow

#### Recovery & Key Derivation
```
Recovery JSON file
  └─ parseRecoveryFile()          → RecoveryFile (typed, validated)
       └─ userKey.keySource
            ├─ PASSWORD: passphrase + salt → deriveSeed() → PBKDF2 → Uint8Array
            │                              → deriveMasterKey() → BIP32 root
            │                              → deriveXprv() → BIP32 child at derivationPath
            │                              → deriveSigningKey() → signing keypair
            └─ COLD_CARD: user provides xprv directly (no server round-trip)
  └─ replaceKeyByFingerprint()    → reconstructed output descriptor with user's xpub
  └─ descriptorChecksum()         → appended checksum (Bitcoin descriptor spec)
```

#### PSBT Data Flow (Path A & B)
```
Output Descriptor
  └─ parseDescriptor()            → descriptor structure
       └─ deriveAddresses()        → array of payment addresses
            └─ fetchUtxos()        → Mempool.space API → UTXOs with amounts/txids
                 └─ buildPsbt()    → unsigned PSBT transaction
                      └─ signPsbt()       → add signatures using recovered key
                           └─ finalizePsbt()  → extract fully-signed transaction
                                └─ broadcast()  → Mempool.space API → Bitcoin network
```

## Important Notes

- **Blockchain API Integration.** The tool now connects to Mempool.space API for:
  - Fetching UTXOs for address balance queries
  - Broadcasting fully-signed transactions
  - Supported networks: mainnet, testnet, signet, regtest
  - Network selection is automatic based on `recovery file.network`
- **Content Security Policy.** The production CSP in `index.html` allows `connect-src` to:
  - `mempool.space`, `testnet.mempool.space`, `signet.mempool.space`
  - The active dev CSP also allows `connect-src localhost:*` for Vite HMR
- **Bitcoin Libraries.** The tool uses:
  - `bitcoinjs-lib` — for PSBT creation, signing, and finalization
  - `ecpair` — for keypair operations and transaction signing
  - `bip32` and `@bitcoinerlab/secp256k1` — for key derivation
- **Buffer polyfill required.** `bip32`, `bitcoinjs-lib`, and `@bitcoinerlab/secp256k1` rely on Node's `Buffer`. It is patched onto `globalThis` in `main.tsx` before any other import and also in `vitest.config.ts` via `define: { global: 'globalThis' }`.
- **Vite base is `'./'`** to support deployment from any subdirectory path (e.g., GitHub Pages, S3 subfolder).
- **`tailwindcss` and `tw-animate-css` are devDependencies** — they are compile-time tools, not runtime imports.
- **No ESLint yet.** The `lint` script is a placeholder.
- **`noUncheckedIndexedAccess` is enabled.** Array/object index access returns `T | undefined`. Handle accordingly.

## Code Style

- Prettier defaults (single quotes, 2-space indent, trailing commas)
- Named exports for all components and hooks (no default exports)
- Crypto modules are pure functions — no React imports, no side effects
- CSS via Tailwind utility classes; custom design tokens as CSS variables in `styles.css`
- Dark mode via `.dark` class on `<html>` (toggled by `useTheme`)
