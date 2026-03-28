import { useState, useRef, useCallback } from 'react'
import { Upload, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

type FileDropZoneProps = {
  onFileContent: (content: string) => void
  error?: string | null
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 // 1 MB
const ACCEPTED_EXTENSIONS = ['.json']
const ACCEPTED_MIME_TYPES = ['application/json', 'text/json']

function isAcceptedFile(file: File): boolean {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  return (
    ACCEPTED_EXTENSIONS.includes(ext) ||
    ACCEPTED_MIME_TYPES.includes(file.type)
  )
}

export function FileDropZone({ onFileContent, error }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // dragCounter tracks nested drag-enter/leave events to prevent flicker
  const dragCounter = useRef(0)

  const handleFile = useCallback(
    (file: File) => {
      setLocalError(null)

      if (!isAcceptedFile(file)) {
        setLocalError('Only .json files are accepted. Please select a valid recovery file.')
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        setLocalError('File is too large (max 1 MB). Recovery files are typically under 10 KB.')
        return
      }

      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        onFileContent(content)
      }
      reader.onerror = () => {
        setLocalError('Failed to read the file. The file may be corrupted or unreadable.')
        setFileName(null)
      }
      reader.readAsText(file)
    },
    [onFileContent],
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current += 1
    if (dragCounter.current === 1) {
      // Check MIME/extension on drag-enter so we give early feedback
      const item = e.dataTransfer.items[0]
      if (item && !ACCEPTED_MIME_TYPES.includes(item.type) && item.type !== '') {
        return // Don't highlight for wrong type
      }
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
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
      if (file) {
        // Pre-check extension/MIME before reading
        if (!isAcceptedFile(file)) {
          setLocalError('Only .json files are accepted. Please drop a valid recovery file.')
          return
        }
        handleFile(file)
      }
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

  const displayError = localError ?? error

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'relative cursor-pointer rounded-[var(--radius-surface)] border-2 border-dashed p-8 text-center',
          // Drag-active: gradient animated border (CSS class handles the pseudo-element)
          isDragging && 'drop-zone-active',
          // File loaded: success tint
          !isDragging && fileName && 'drop-zone-loaded border-2 border-dashed',
          // Error state
          !isDragging && !fileName && displayError && 'border-destructive/50 bg-destructive/5',
          // Default idle
          !isDragging && !fileName && !displayError && 'border-border hover:border-primary/60 hover:bg-primary/5',
          // Smooth transition for non-drag states
          !isDragging && 'transition-colors duration-200',
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload recovery file"
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
          accept=".json,application/json"
          className="hidden"
          onChange={handleChange}
        />

        <div className="relative z-10 flex flex-col items-center gap-3">
          {fileName ? (
            <>
              {/* Loaded state — success colours */}
              <FileText className="size-10 text-success transition-colors duration-200" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">{fileName}</p>
                <p className="mt-0.5 text-xs text-success">File loaded successfully</p>
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
                  {isDragging ? 'Release to upload' : 'Drop your recovery file here'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  or click to select a .json file
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {displayError && (
        <p className="text-xs text-destructive" role="alert">{displayError}</p>
      )}
    </div>
  )
}
