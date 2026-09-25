import { useWorkspace } from '../WorkspaceContext'
import { ImportWizard } from '@/components/imports/ImportWizard'

// Guide Week 11: the staged-import wizard's page shell. Per-screen data flow
// (useStagedImport), not the whole-workspace poll.
export function ImportWizardPage() {
  const { authToken } = useWorkspace()
  return <ImportWizard authToken={authToken} />
}
