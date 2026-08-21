import { AlertTriangle } from 'lucide-react'
import { provablyPublicOnly } from '@/crypto'

/** The accessible name of the warning region: the customer's own first words. */
const TITLE_ID = 'private-key-warning-title'

/**
 * The whole warning sentence. A screen points its key block's
 * `aria-describedby` here, so the warning is read on arrival at the key even by
 * someone who jumped straight to it.
 */
export const PRIVATE_KEY_WARNING_BODY_ID = 'private-key-warning-body'

type PrivateKeyWarningProps = {
  /** The exact string the screen is about to render. Not a parse of it. */
  text: string
  /**
   * Render no matter what the scan concludes, for a screen that is only ever
   * reached carrying the secret. See the note on failing closed below.
   */
  always?: boolean
}

/**
 * The one gate, exported so a screen can describe its key block by the warning
 * only when the warning is actually on the page.
 *
 * It returns the id rather than a boolean on purpose. A screen cannot ask "will
 * it warn?" and then invent its own id, and a dangling `aria-describedby` on a
 * screen that went quiet is impossible to write: there is one answer and both
 * callers read it from here.
 */
export function privateKeyWarningDescribedBy(
  text: string,
  always = false,
): string | undefined {
  return always || !provablyPublicOnly(text) ? PRIVATE_KEY_WARNING_BODY_ID : undefined
}

/**
 * The "keep this secret" warning, gated on the string the customer can read.
 *
 * One component, one gate, on every screen that prints the escrow
 * configuration. The defect this replaces was not that a screen forgot the
 * warning; it was that the warning was gated on parsed output, so it went
 * missing precisely when parsing had failed. Written per screen, that mistake
 * gets made again. Written here, a screen either renders the secret through
 * this component or it does not render it at all.
 *
 * The gate fails closed, and that is not the same as being gated on a detector.
 * An earlier version here returned null unless `containsPrivateKey` matched,
 * which makes a missed key shape a silent screen: the guard's default answer on
 * anything it does not recognise is "no warning needed". On spendable funds the
 * default has to run the other way. So the silence is gated on
 * `provablyPublicOnly`, which has to positively account for every long token in
 * the string before it will let the warning go. Anything unrecognised warns.
 *
 * `always` is the second half of that. `ResultStep` is only reachable on the
 * password path, where the string it prints always contains the recovered key,
 * so no scan should be able to talk that screen out of the warning. That screen
 * passes `always` and the scan is not consulted at all.
 *
 * The wording is fixed and approved. Nothing about the gate touches it, and
 * nothing below adds a word to it: the accessible name is `aria-labelledby` on
 * the customer's own opening words, not a label written for screen readers.
 *
 * Still no `role="alert"`, and now not nothing either. The previous note here
 * was half right and stopped too early. Right: an alert interrupts whatever is
 * being read, this is on screen from first paint rather than announced on an
 * event, and `UnsupportedEscrowNotice` on these same screens already holds that
 * role, so a second one talks over the notice explaining why the buttons are
 * dead. Wrong: it concluded that the answer was no role at all, which left this
 * as an anonymous paragraph carrying its severity in a colour. A customer who
 * cannot see the colour heard a stray sentence, and one navigating by landmark
 * or jumping to the code block heard nothing before reaching a key that spends
 * their Bitcoin.
 *
 * So: `role="region"`, named by `aria-labelledby`. It is announced on entry in
 * reading order, which already puts it above the key on all three screens, and
 * it is listed in the landmark rotor so it can be found on purpose. Neither
 * interrupts anything. `role="note"` was the other candidate and was dropped:
 * it takes no accessible name, is not in the rotor, and support for announcing
 * it is patchy, so it would have changed the tree without changing what anyone
 * hears.
 *
 * Reading order is not the whole job, because nothing forces a customer through
 * it. The key block on each screen therefore carries `aria-describedby` back to
 * the sentence below, so arriving at the key reads the warning whatever route
 * got there. Region for the person reading down the page, description for the
 * person who skipped.
 *
 * The colour is load bearing, not decoration. On the refusal screen this sits
 * beside `UnsupportedEscrowNotice`, which is amber and says the customer's
 * Bitcoin is safe. This one says it can be stolen. Two amber panels with an
 * icon each read as one repeated notice at a glance, so this takes the
 * destructive token and a border to separate them without either being read.
 */
export function PrivateKeyWarning({ text, always = false }: PrivateKeyWarningProps) {
  if (!privateKeyWarningDescribedBy(text, always)) return null

  return (
    <div
      role="region"
      aria-labelledby={TITLE_ID}
      className="flex items-start gap-2 rounded-[var(--radius-base)] border border-destructive/40 bg-destructive/10 px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <p id={PRIVATE_KEY_WARNING_BODY_ID} className="text-xs text-destructive-text">
        <strong id={TITLE_ID}>Keep this secret.</strong> The text below contains your private signing key
        in plain text. Anyone who obtains it can spend your Bitcoin. Do not share it,
        screenshot it, or store it in an insecure location. Treat it like a seed phrase.
      </p>
    </div>
  )
}
