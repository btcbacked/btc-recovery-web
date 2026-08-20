import { Info } from 'lucide-react'
import { ESCROW_UNSUPPORTED_HEADLINE, ESCROW_UNSUPPORTED_BODY } from '@/crypto/errors'

/**
 * Shown when this escrow's keys are pinned rather than ranged, so other wallet
 * software is likely to disagree with the address this tool shows.
 *
 * This tool resolves each key's own child derivation, so the address it shows
 * is right. Most wallet apps assume the ranged shape, so the same recovery file
 * opened elsewhere can show a different address or an empty balance. The
 * customer is about to act on one of those two numbers, so they have to be told
 * which one describes their escrow, and told that nothing is wrong.
 *
 * Informational, not an alarm: the situation is fine and the only thing asked
 * of the customer is to stay on this page. It renders wherever a customer could
 * act, and never when no address could be derived at all, because then there is
 * no address for it to vouch for.
 *
 * Copy rules, all deliberate: plain words only, no dashes, nothing that implies
 * BTCBacked holds or controls the key or the funds, and nothing that makes
 * support the customer's next step.
 */
export function DerivationNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-[var(--radius-base)] border border-info/30 bg-info/10 px-4 py-3"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <p className="text-xs text-foreground">
        <strong>Your Bitcoin is safe and this page has the right address for it.</strong>{' '}
        This escrow was set up in a way most wallet apps do not expect. If you open your
        recovery file in another wallet, it may show a different address or a zero balance.
        That is the other app getting it wrong, not your money moving. Keep using this page to
        move your Bitcoin.
      </p>
    </div>
  )
}

/**
 * Shown when no escrow address could be produced from the recovery file, so
 * this page will neither show an address nor sign.
 *
 * Three different things land here and the copy has to be true of all of them:
 * a child derivation `childIndices` refuses, an extended key `address.ts`
 * cannot read, and a descriptor `parseDescriptor` cannot read at all. The
 * approved wording covers all three: a file this page cannot read is a file set
 * up in a way this page does not handle.
 *
 * The words are not written here. They come from `ESCROW_UNSUPPORTED`, which is
 * the same string the refusal throws with, so the notice on screen and the
 * error a `RecoveryError` carries cannot drift apart. Only the bolding is this
 * component's, which is why it takes the two halves rather than the whole.
 *
 * The refusal has to be visible. Each of those throws is caught in the wizard
 * and turns into a null address, which on its own is silent: the screens simply
 * stop showing an address, and the signing buttons stop working with no reason
 * given. This is that reason, and it renders on every screen from the point the
 * file is read.
 *
 * `role="alert"` and not `role="status"`: it is blocking, not ambient. The
 * customer came here to move money and cannot, and the two buttons that would
 * do it are dead while this is on screen.
 *
 * Copy rules, all deliberate: plain words only, no dashes, nothing that implies
 * BTCBacked holds or controls the key or the funds, and nothing that makes
 * support the customer's next step. It names no next step at all, because the
 * wording for one is still an open decision.
 */
export function UnsupportedEscrowNotice() {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[var(--radius-base)] border border-warning/30 bg-warning/10 px-4 py-3"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-xs text-warning-text">
        <strong>{ESCROW_UNSUPPORTED_HEADLINE}</strong> {ESCROW_UNSUPPORTED_BODY}
      </p>
    </div>
  )
}
