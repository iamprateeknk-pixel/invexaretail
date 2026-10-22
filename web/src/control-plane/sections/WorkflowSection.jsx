import { WorkflowsEditor } from '../StudioEditors';

export function WorkflowSection(props) {
  const { draft, controlToken, refreshLocked } = props;
  return (
    <WorkflowsEditor controlToken={controlToken} draft={draft} onSaved={refreshLocked} />
  );
}
