import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

type StepIndicatorProps = {
  currentStep: number
  totalSteps: number
  labels: string[]
}

export function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  return (
    <nav aria-label="Recovery steps">
      <ol className="flex items-start justify-center gap-2">
        {Array.from({ length: totalSteps }, (_, i) => {
          const step = i + 1
          const isCompleted = step < currentStep
          const isCurrent = step === currentStep
          // Connector comes after this item (not the last)
          const hasConnector = step < totalSteps
          // Is the connector after a completed step (leading into next)?
          const connectorCompleted = step < currentStep
          const connectorPartial = step === currentStep - 1 // transition point

          return (
            <li key={step} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                {/* Step circle */}
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium',
                    isCompleted && 'animate-step-complete border border-[var(--step-completed-border)] bg-[var(--step-completed-bg)] text-foreground',
                    isCurrent && 'animate-step-pulse bg-primary text-primary-foreground',
                    !isCompleted && !isCurrent && 'bg-[var(--step-inactive-bg)] text-muted-foreground',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${step}: ${labels[i]}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
                >
                  {isCompleted ? <Check className="size-3.5" /> : step}
                </div>

                {/* Step label — visible on sm+ screens */}
                <span
                  className={cn(
                    'hidden text-[10px] font-medium sm:block',
                    isCurrent ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {labels[i]}
                </span>
              </div>

              {/* Connector line — gradient from completed into pending */}
              {hasConnector && (
                <div
                  className={cn(
                    'mb-4 h-px w-6 sm:mb-5',
                    connectorCompleted
                      ? 'step-connector-completed'
                      : connectorPartial
                        ? 'step-connector-partial'
                        : 'step-connector-pending',
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
