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
    recovery-file.ts    # RecoveryFile type + parser/validator
    derivation.ts       # BIP39 seed → BIP32 master key → signing key derivation
    descriptor.ts       # Output descriptor manipulation and checksum
    profiles.ts         # Named derivation profiles (maps profile id → algo + path)
    validation.ts       # Fingerprint, hex, derivation path validators
    errors.ts           # RecoveryError class + typed error codes
    index.ts            # Barrel export for all crypto modules
  hooks/
    useRecoveryWizard.ts  # Wizard state machine (step, recoveryFile, descriptor, errors)
    useDerivation.ts      # Async key derivation with loading/error state
    useClipboard.ts       # Clipboard write with transient success state
    useTheme.ts           # Dark/light theme toggle, persisted to localStorage
  lib/
    utils.ts            # cn() helper (clsx + tailwind-merge)
  components/
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
      WalletGuideStep.tsx # Step 6: wallet-specific import instructions
```

### Wizard Flow

```
upload → info → password | hardware → deriving → result → guide
  1        2          3                   4          5       6
```

- The step after `info` branches on `userKey.keySource`: `PASSWORD` → `PasswordStep`, `COLD_CARD` → `HardwareStep`.
- `DerivingStep` calls `useDerivation` which runs BIP39/BIP32 derivation asynchronously, then transitions automatically to `result`.
- `WalletGuideStep` provides wallet-specific import instructions (Sparrow, Specter, Bitcoin Core).

### Crypto Data Flow

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

## Important Notes

- **No network requests in production.** The production CSP in `index.html` (kept as a comment) blocks all outbound connections. The active dev CSP allows `connect-src localhost:*` for Vite HMR only.
- **Buffer polyfill required.** `bip32` and `@bitcoinerlab/secp256k1` rely on Node's `Buffer`. It is patched onto `globalThis` in `main.tsx` before any other import and also in `vitest.config.ts` via `define: { global: 'globalThis' }`.
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
