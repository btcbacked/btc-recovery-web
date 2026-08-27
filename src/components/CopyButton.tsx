import { useState, useRef, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import { useClipboard } from '@/hooks/useClipboard'
import { cn } from '@/lib/utils'

type CopyButtonProps = {
  text: string
  className?: string
} & (
  | {
      /** The default: a call to action carrying a visible label. */
      variant?: 'button'
      label?: string
      /**
       * Optional accessible name, for screens carrying several copy controls
       * at once: the visible label is the same word on all of them, so a
       * screen reader hears "Copy" repeated with nothing to tell them apart.
       * Omitting it leaves the accessible name as the visible label.
       */
      ariaLabel?: string
    }
  | {
      /**
       * Icon only, for a control sitting next to the address it copies. A full
       * call to action beside a 62 character address takes the width the
       * address needs to stay readable. The main web app settled this the same
       * way: a bare muted lucide icon, no background, no visible text. See
       * ContractDetailBanner and RepaymentStep there.
       */
      variant: 'icon'
      label?: undefined
      /**
       * REQUIRED here, unlike above. With no visible text this is the only
       * name the control has, so omitting it would leave a screen reader
       * announcing nothing but "button".
       */
      ariaLabel: string
    }
)

export function CopyButton(props: CopyButtonProps) {
  const { text, className, ariaLabel, variant = 'button' } = props
  const label = props.label ?? 'Copy to Clipboard'
  const { copy } = useClipboard()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /*
   * The only cleanup React actually runs on this component. It does the job the
   * old mountedRef did, stopping a pending revert from landing after unmount,
   * and it does it by cancelling the timer rather than by letting it fire and
   * then declining to act.
   */
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = async () => {
    const success = await copy(text)
    if (!success) return
    /*
     * Cancel the pending revert before starting a new one. This handler used to
     * return a cleanup function, which reads as cleanup but is just an onClick
     * return value that React never calls, so a second click stacked a second
     * timer behind the first and the first one still reverted the tick two
     * seconds after the FIRST click. Clicking again at 1.5s put the tick back
     * after 0.5s instead of 2s. Customers double tap this control when they are
     * unsure it worked, which is exactly the case it got wrong.
     */
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setCopied(true)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel}
      className={cn(
        variant === 'icon'
          ? /*
             * The glyph is 16px, which is a cramped target for a control used
             * one handed under stress. The padding grows the button to a 44px
             * one, and the matching negative margin keeps the glyph itself at
             * its original size and position and gives the button back the
             * layout footprint it had, so the address beside it loses no width.
             * Same idiom as the logo button in AppLayout and the reveal toggle
             * in PasswordStep, which is also where the focus ring comes from:
             * without it this control fell back to Chrome's stock blue,
             * measured as `outline: auto 1px rgb(0, 95, 204)` at offset 0.
             *
             * Those two siblings also carry a bare `focus-visible:outline`
             * ahead of the width. It is not repeated here because this class
             * list goes through `cn`, and tailwind-merge drops it as superseded
             * by `focus-visible:outline-2`. Nothing is lost: in Tailwind v4
             * `outline-2` sets the style as well as the width. Measured in
             * Chrome on the built stylesheet, this renders as
             * `outline: solid 2px rgb(254, 121, 33)` at offset 2px.
             */
            '-m-3.5 shrink-0 rounded p-3.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          : 'btn-primary inline-flex items-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground',
        copied && variant !== 'icon' && 'opacity-90',
        className,
      )}
    >
      {/* No live region here. useClipboard already announces the same words
          through the app's toast, whose own live region sits outside this
          button and is the one assistive technology reliably reads: a live
          region nested inside a button is unreliable, because a button's
          children are presentational. Two regions holding the same words meant
          the confirmation was announced twice. CopyButton.test.tsx pins the
          toast channel and the icon swap instead. */}
      {variant === 'icon' ? (
        copied ? (
          <Check className="h-4 w-4 text-success" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )
      ) : copied ? (
        <>
          <Check className="size-4" aria-hidden="true" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="size-4" aria-hidden="true" />
          {label}
        </>
      )}
    </button>
  )
}
