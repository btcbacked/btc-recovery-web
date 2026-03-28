import { useCallback } from 'react'
import { toast } from 'sonner'

export function useClipboard() {
  const copy = useCallback(async (text: string, label = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(label)
      return true
    } catch {
      toast.error('Failed to copy to clipboard')
      return false
    }
  }, [])

  return { copy }
}
