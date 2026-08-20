export type RecoveryErrorCode =
  | 'INVALID_JSON'
  | 'MALFORMED_FILE'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_PROFILE'
  | 'HARDWARE_KEY'
  | 'FINGERPRINT_MISMATCH'
  | 'KEY_MISMATCH'
  | 'DERIVATION_ERROR'
  | 'DESCRIPTOR_ERROR'
  | 'NETWORK_ERROR'
  | 'PSBT_ERROR'
  | 'TRANSACTION_ERROR'
  | 'ADDRESS_ERROR'

export class RecoveryError extends Error {
  constructor(
    public readonly code: RecoveryErrorCode,
    public readonly userMessage: string,
    public readonly detail?: string,
  ) {
    super(userMessage)
    this.name = 'RecoveryError'
  }
}

/**
 * What to do when the file itself is the problem, written for the situation
 * this tool exists for: BTCBacked is gone, there is no newer file coming and
 * there is nobody to ask. So it points only at things the reader already holds.
 *
 * The most useful instruction is first, and the lines are short, because this
 * is read by someone who has just been told their recovery has stopped. It is
 * rendered with `whitespace-pre-line`, so the newlines survive to the screen.
 *
 * Note that both callers reach this only AFTER the fingerprint check has
 * passed, so "your password still rebuilds your wallet" is a fact here, not
 * reassurance.
 */
export const KEY_MISMATCH_NEXT_STEPS =
  'What to do next:\n' +
  '• Take this file and your password to a Bitcoin professional you ' +
  'trust. Everything needed is in the file, and none of it depends on ' +
  'BTCBacked still being reachable.\n' +
  '• Keep this file and your password. Your password still rebuilds your ' +
  'wallet, so the key itself is not lost, and this file carries the escrow ' +
  'details needed to spend from it.\n' +
  '• If you hold more than one recovery file for this contract, open each ' +
  'one here. A file that passes the checks in this tool is the one to work from.'

/**
 * Shown when the key recorded in the file cannot be read at all, so there is
 * nothing to compare the rebuilt key against.
 *
 * Both this and the message below are exported because they are what actually
 * reaches a customer. A message that only exists as a literal at its throw site
 * cannot be reviewed or tested as copy.
 */
export const KEY_MISMATCH_UNCHECKABLE =
  'This recovery file cannot be checked, so recovery has stopped here. The ' +
  'key this file records for you cannot be read, so there is no way to ' +
  'confirm that the key rebuilt from your password is the right one.\n\n' +
  KEY_MISMATCH_NEXT_STEPS

/** Shown when the password is right but the file's own records disagree. */
export const KEY_MISMATCH_INCONSISTENT_FILE =
  'This recovery file is inconsistent, so recovery has stopped here. Your ' +
  'password is correct, but the key this file rebuilds does not match the key ' +
  'the same file records for you. Signing with it could not move your ' +
  'Bitcoin.\n\n' +
  KEY_MISMATCH_NEXT_STEPS

/**
 * The refusal, in the words that were approved for it.
 *
 * Exported rather than written at the throw site because this is what reaches
 * a customer, and copy that only exists as a literal inside a `catch` cannot be
 * reviewed or tested. `useWalletState` renders a `RecoveryError`'s
 * `userMessage` verbatim, so any throw on the refusal path that does not carry
 * this carries its own technical wording onto the screen instead.
 *
 * Wording rules, all deliberate: plain words only, no dashes, nothing that
 * implies BTCBacked holds or controls the key or the funds, nothing that makes
 * support the customer's next step, and no referral to anyone else.
 *
 * Split in two only because the screen bolds the first sentence and a thrown
 * error cannot. `ESCROW_UNSUPPORTED` is built from the halves rather than
 * written out again, so the sentence a customer reads in the notice and the
 * sentence a customer reads from a `RecoveryError` cannot drift apart. Nothing
 * outside this file should assemble its own version of either half.
 */
export const ESCROW_UNSUPPORTED_HEADLINE = 'This page cannot open this escrow.'

/**
 * Everything after the headline, and the half that carries the promise.
 *
 * It says the file was set up in a way this page does not handle, and that is
 * true of all three refusal causes, the unreadable descriptor included: a file
 * this page cannot read is a file set up in a way this page does not handle.
 * Naming the cause more precisely was considered and rejected, because the
 * three causes are one fact to the customer and this wording is the one that
 * was approved.
 */
export const ESCROW_UNSUPPORTED_BODY =
  'Your recovery file was set up in a way this page does not handle, so it ' +
  'will not show you an address. Your Bitcoin has not moved and your key is ' +
  'still yours.'

export const ESCROW_UNSUPPORTED = `${ESCROW_UNSUPPORTED_HEADLINE} ${ESCROW_UNSUPPORTED_BODY}`

export const ERROR_MESSAGES: Record<RecoveryErrorCode, string> = {
  INVALID_JSON:
    'This file does not contain valid JSON. Please check that you uploaded the correct recovery file.',
  MALFORMED_FILE:
    'This recovery file is missing information it needs, or part of it cannot be read. ' +
    'If you hold another copy of the file, open that one. If this is your only copy, keep ' +
    'it and your password and take them to a Bitcoin professional you trust.',
  UNSUPPORTED_VERSION:
    'This recovery file uses a newer format version than this tool can read. There is no ' +
    'newer version of this tool to fetch. Keep the file and your password: everything ' +
    'needed to recover your key is inside the file, so take them to a Bitcoin ' +
    'professional you trust.',
  UNSUPPORTED_PROFILE:
    'This recovery file rebuilds your key by a method this tool does not know. Keep the ' +
    'file and your password: everything needed to recover your key is inside the file, so ' +
    'take them to a Bitcoin professional you trust.',
  HARDWARE_KEY:
    'This key is held on a hardware wallet, so there is no password to enter. Import the ' +
    'wallet configuration, called a descriptor, into your wallet software instead.',
  FINGERPRINT_MISMATCH:
    'The password you entered does not match this recovery file. Please check your password and try again.',
  KEY_MISMATCH: KEY_MISMATCH_INCONSISTENT_FILE,
  DERIVATION_ERROR:
    'Your key could not be rebuilt from this file. Rebuilding is exact, so trying again ' +
    'gives the same result. Keep the file and your password and take them to a Bitcoin ' +
    'professional you trust.',
  DESCRIPTOR_ERROR:
    'The wallet configuration in this file could not be prepared for another wallet.',
  NETWORK_ERROR:
    'A network error occurred while communicating with the blockchain API. Check your connection.',
  PSBT_ERROR:
    'This transaction file could not be read. Check that you chose the file the other ' +
    'signer sent you.',
  TRANSACTION_ERROR:
    'An error occurred while building or broadcasting the transaction.',
  ADDRESS_ERROR:
    'The escrow address could not be worked out from this file.',
}
