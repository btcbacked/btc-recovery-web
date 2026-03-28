import { useState, useRef, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import { useClipboard } from '@/hooks/useClipboard'
import { cn } from '@/lib/utils'

type CopyButtonProps = {
  text: string
  label?: string
  className?: string
}

export function CopyButton({ text, label = 'Copy to Clipboard', className }: CopyButtonProps) {
  const { copy } = useClipboard()
  const [copied, setCopied] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleCopy = async () => {
    const success = await copy(text)
    if (success) {
      setCopied(true)
      const timer = setTimeout(() => {
        if (mountedRef.current) setCopied(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'btn-primary inline-flex items-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground',
        copied && 'opacity-90',
        className,
      )}
    >
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
      {copied ? (
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
