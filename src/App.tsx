import { Toaster } from 'sonner'
import { AppLayout } from '@/components/AppLayout'
import { RecoveryWizard } from '@/components/RecoveryWizard'

export function App() {
  return (
    <AppLayout>
      <RecoveryWizard />
      <Toaster position="top-center" richColors />
    </AppLayout>
  )
}
