import { useState } from 'react'
import { FileDropZone } from '@/components/FileDropZone'
import { parseRecoveryFile, validate, RecoveryError } from '@/crypto'
import type { RecoveryFile } from '@/crypto'

type UploadStepProps = {
  onFileLoaded: (file: RecoveryFile) => void
}

export function UploadStep({ onFileLoaded }: UploadStepProps) {
  const [error, setError] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteValue, setPasteValue] = useState('')

  const processContent = (content: string) => {
    setError(null)
    try {
      const file = parseRecoveryFile(content)
      validate(file)
      onFileLoaded(file)
    } catch (err) {
      if (err instanceof RecoveryError) {
        setError(err.userMessage)
      } else {
        setError('Failed to read the file. Please check the file format and try again.')
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[var(--text-auth-heading)] font-semibold text-foreground">
          Recover Your Bitcoin
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload your BTCBacked recovery file to regain access to your funds.
          Your keys never leave this device.
        </p>
      </div>

      <div className="rounded-[var(--radius-base)] border border-border bg-accent/50 px-4 py-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">What is the recovery file?</p>
        <p className="mt-1">
          When you created your BTCBacked contract, a <code className="font-mono">.json</code> file
          was downloaded to your device. It contains your encrypted key material and wallet
          configuration. Check your Downloads folder or wherever you saved it at setup.
        </p>
      </div>

      <FileDropZone onFileContent={processContent} />

      {error && (
        <div className="rounded-[var(--radius-base)] bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {/* Paste JSON — shown as a visible secondary option */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowPaste(!showPaste)}
          className="btn-outline w-full rounded-[var(--radius-base)] border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          {showPaste ? 'Hide JSON paste area' : 'Or paste the JSON directly'}
        </button>

        {showPaste && (
          <>
            <textarea
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder='Paste your recovery file JSON here...'
              className="h-32 w-full resize-none rounded-[var(--radius-base)] border border-border bg-[var(--input-bg)] px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="button"
              onClick={() => processContent(pasteValue)}
              disabled={!pasteValue.trim()}
              className="btn-primary w-full rounded-[var(--radius-cta)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:bg-[var(--button-primary-disabled-bg)] disabled:text-[var(--button-primary-disabled-fg)] disabled:opacity-100 disabled:shadow-none"
            >
              Load JSON
            </button>
          </>
        )}
      </div>
    </div>
  )
}
