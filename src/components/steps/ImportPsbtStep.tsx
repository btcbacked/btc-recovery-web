import { useState, useRef, useCallback } from 'react'
import { ArrowLeft, ChevronRight, Upload, FileText, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type ImportPsbtStepProps = {
  error: string | null
  onImport: (data: string | ArrayBuffer) => void
  onBack: () => void
}

const MAX_PSBT_SIZE = 512 * 1024 // 512 KB
const ACCEPTED_EXTENSIONS = ['.psbt']
const ACCEPTED_MIME_TYPES = ['application/octet-stream', '']

export function ImportPsbtStep({ error, onImport, onBack }: ImportPsbtStepProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pasteValue, setPasteValue] = useState('')
  const [hasFileLoaded, setHasFileLoaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const handleFile = useCallback(
    (file: File) => {
      setLocalError(null)

      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
      if (!ACCEPTED_EXTENSIONS.includes(ext) && !ACCEPTED_MIME_TYPES.includes(file.type)) {
        setLocalError('Only .psbt files are accepted.')
        return
      }

      if (file.size > MAX_PSBT_SIZE) {
        setLocalError('File is too large (max 512 KB).')
        return
      }

      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result
        if (result instanceof ArrayBuffer) {
          setHasFileLoaded(true)
          onImport(result)
        }
      }
      reader.onerror = () => {
        setLocalError('Failed to read the file.')
        setFileName(null)
      }
      reader.readAsArrayBuffer(file)
    },
    [onImport],
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current += 1
    if (dragCounter.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handlePasteImport = () => {
    const trimmed = pasteValue.trim()
    if (!trimmed) return
    setLocalError(null)
    setHasFileLoaded(true)
    onImport(trimmed)
  }

  const displayError = localError ?? error

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Import PSBT
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Import a partially-signed Bitcoin transaction from the other signer.
        </p>
      </div>

      {/* Explanatory note about what a PSBT is and where it comes from */}
      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3 text-xs text-muted-foreground space-y-2">
        <p>
          <strong className="font-medium text-foreground">What is a PSBT?</strong>{' '}
          A PSBT (Partially Signed Bitcoin Transaction) is a transaction file that needs signatures from multiple parties before it can be sent. Think of it as a cheque that requires two signatures.
        </p>
        <p>
          <strong className="font-medium text-foreground">Where does it come from?</strong>{' '}
          The other party involved in your loan (the lender or BTCBacked) creates the transaction and sends you the PSBT file — typically by email or through the BTCBacked platform. It ends in <code className="font-mono">.psbt</code> and looks like a long string of random characters when viewed as text (Base64 format, starting with <code className="font-mono">cHNidP8B</code>).
        </p>
      </div>

      {/* File drop zone */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Drop or select a .psbt file</p>
        <div
          className={cn(
            'relative cursor-pointer rounded-[var(--radius-surface)] border-2 border-dashed p-8 text-center',
            isDragging && 'drop-zone-active',
            !isDragging && hasFileLoaded && !error && 'drop-zone-loaded border-2 border-dashed',
            !isDragging && !hasFileLoaded && displayError && 'border-destructive/50 bg-destructive/5',
            !isDragging && !hasFileLoaded && !displayError && 'border-border hover:border-primary/60 hover:bg-primary/5',
            !isDragging && 'transition-colors duration-200',
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Import PSBT file"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".psbt"
            className="hidden"
            onChange={handleChange}
          />

          <div className="relative z-10 flex flex-col items-center gap-3">
            {hasFileLoaded && !error ? (
              <>
                <FileText className="size-10 text-success" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{fileName ?? 'PSBT loaded'}</p>
                  <p className="mt-0.5 text-xs text-success">File loaded — parsing...</p>
                </div>
              </>
            ) : (
              <>
                <Upload
                  className={cn(
                    'size-10 text-muted-foreground transition-colors duration-200',
                    isDragging && 'drop-zone-icon-bouncing text-primary',
                  )}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {isDragging ? 'Release to import' : 'Drop your .psbt file here'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">or click to select</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Error display */}
      {displayError && (
        <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-destructive/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{displayError}</p>
        </div>
      )}

      {/* Or paste base64 */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Or paste Base64-encoded PSBT</p>
        <textarea
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
          placeholder="cHNidP8BAH..."
          rows={5}
          className="input-premium w-full resize-none rounded-[var(--radius-base)] border border-border bg-[var(--input-bg)] px-3 py-2 font-mono text-xs text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={handlePasteImport}
          disabled={!pasteValue.trim()}
          className="btn-outline w-full rounded-[var(--radius-base)] border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          Import from Paste
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          className="btn-outline inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>

        <button
          type="button"
          disabled={!hasFileLoaded || !!error}
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:bg-[var(--button-primary-disabled-bg)] disabled:text-[var(--button-primary-disabled-fg)] disabled:opacity-100 disabled:shadow-none"
        >
          Review PSBT
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
