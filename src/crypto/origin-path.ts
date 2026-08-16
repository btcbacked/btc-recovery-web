import { parseDescriptor, findUserKey } from './descriptor-parser'
import { isValidDerivationPath } from './validation'
import type { RecoveryFile } from './recovery-file'

/**
 * The path in the descriptor's own origin bracket, canonicalised.
 *
 * Case INSENSITIVE on the hardened marker, unlike the file side below. A
 * capital `H` is a legal hardened marker in BIP-380, this tool carries a
 * descriptor's bracket through verbatim, and wallet software that follows the
 * spec accepts it. Reusing the file side's normaliser here would report a
 * descriptor the tool otherwise accepts without complaint. Same reason
 * `psbt-builder.ts` uses `/h\b/gi` on this value.
 */
function canonicalBracketPath(originPath: string): string | null {
  const canonical = stripMaster(originPath).replace(/h\b/gi, "'")
  return isValidDerivationPath(canonical) ? canonical : null
}

/**
 * `userKey.derivationPath`, canonicalised.
 *
 * Case SENSITIVE on the hardened marker, matching `normalizeDerivationPath` in
 * `derivation.ts`. This is the path the tool has to walk itself, bip32 will not
 * accept a capital `H`, and `isValidDerivationPath` already refuses one, so a
 * marker set that quietly accepted `H` here would disagree with the deriver.
 */
function canonicalFilePath(derivationPath: string): string | null {
  const canonical = stripMaster(derivationPath).replace(/h\b/g, "'")
  return isValidDerivationPath(canonical) ? canonical : null
}

function stripMaster(path: string): string {
  return path.startsWith('m/') ? path.slice(2) : path
}

/**
 * The warning to show when `userKey.derivationPath` and the origin bracket of
 * the user's own descriptor leg name different paths. `null` when they agree,
 * and `null` when the question cannot be settled from the file.
 *
 * **The two fields never match as text in a genuine file.** The backend stores
 * `m/48h/1h/0h/2h` in `userKey.derivationPath` and strips the `m/` when it
 * writes the bracket, always. Comparing the two strings would report every real
 * recovery file, so both sides are canonicalised first, which also makes
 * `48'/1'` and `48h/1h` the same path, as they are.
 *
 * This is a WARNING and never a refusal. The address, the balance and the
 * signature are all unaffected by a mismatch here: the descriptor this tool
 * emits carries the private key and derives correctly whatever the bracket
 * says. The one thing that reads the path is a wallet or device registering the
 * key. Refusing would turn a fully recoverable file into a dead end, and this
 * is the tool somebody opens when there is nothing else left.
 *
 * Anything unreadable returns `null`. Not knowing has to be silence: a warning
 * that fires on a file which is in fact fine sends the reader looking for a
 * fault that is not there.
 */
export function originPathWarning(file: RecoveryFile): string | null {
  let originPath: string
  try {
    const leg = findUserKey(
      parseDescriptor(file.outputDescriptor),
      file.userKey.fingerprint,
    )
    if (!leg || !leg.key.originPath) return null
    originPath = leg.key.originPath
  } catch {
    // A descriptor this tool cannot read is a different problem, and one the
    // rest of the wizard already surfaces.
    return null
  }

  const inDescriptor = canonicalBracketPath(originPath)
  const recorded = canonicalFilePath(file.userKey.derivationPath)
  if (inDescriptor === null || recorded === null) return null
  if (inDescriptor === recorded) return null

  // Word for word the message `origin_path_warning` emits in the Rust CLI. The
  // two tools tell a customer the same thing about the same file.
  return (
    `The derivation path this recovery file records (${file.userKey.derivationPath}) is not the ` +
    `path the file's own descriptor records for your key (${originPath}). This does not stop ` +
    'your recovery. The descriptor still carries your key and still derives the same addresses, ' +
    'so the balance you see and any signature you make are unaffected. The path is what a wallet ' +
    'or a signing device uses to register this key, so if a device later refuses to recognise ' +
    'it, this is the reason.'
  )
}
