import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { controlRequest } from './control-api';
import {
  AUTOMATION_ACTIONS, AUTOMATION_EVENTS, AUTOMATION_SCHEDULES, ENTITY_OPTIONS, FIELD_TYPE_OPTIONS, MOBILE_SCREENS, OFFLINE_HOURS_OPTIONS,
  REPORT_DATASETS, ROLE_OPTIONS, RULE_ACTIONS, RULE_FIELDS, RULE_OPERATORS, WORKFLOW_TARGETS,
  actionToOutcome, conditionToRows, describeRuleResult, datasetOf, describeAutomation, describeRule, describeWorkflow, labelOf, modelToWorkflow,
  outcomeToAction, reportColumnLabel, rowsToCondition, slugKey, workflowToModel,
} from './studio-catalog';
import { Advanced, ChipPicker, Choice, NotLiveNote, StudioListEditor, useStudioMode } from './studio-mode';

function Text({ label, value, onChange, placeholder, type = 'text', mono = false }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <Input aria-label={label} type={type} className={mono ? 'font-mono' : ''} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

const del = (token, path) => controlRequest(path, { token, method: 'DELETE' });
const post = (token, path, body) => controlRequest(path, { token, method: 'POST', body });

// ---- custom fields ------------------------------------------------------------

export function FieldsEditor({ controlToken, draft, onSaved }) {
  const entries = draft?.fields ?? [];
  return (
    <StudioListEditor
      title="Extra fields"
      description="Add your own fields to items, transfers, orders and more - for example Shelf no. or Supplier batch. Pick what it is for, give it a name and say what kind of value it holds."
      notLive="Saved and published, but forms in the app do not show these fields yet. For stock table columns use the Stock columns tab; for item details filled by imports use Import columns."
      entries={entries}
      idOf={(field) => `${field.entityType}:${field.fieldKey}`}
      newEntry={(current) => ({ entityType: 'item', fieldKey: slugKey('New field', current.map((field) => field.fieldKey)), label: 'New field', dataType: 'text', required: false, visibleRoles: ['ADMIN', 'BRANCH_MANAGER'], editableRoles: ['ADMIN'] })}
      summarize={(field) => `${labelOf(ENTITY_OPTIONS, field.entityType)} · ${field.label} (${labelOf(FIELD_TYPE_OPTIONS, field.dataType)}${field.required ? ', required' : ''})`}
      addLabel="Add field"
      emptyText="No extra fields yet."
      save={(field, existed) => post(controlToken, '/studio/v1/fields', {
        entityType: field.entityType, key: field.fieldKey, name: field.label, type: field.dataType, required: field.required,
        visibleRoles: field.visibleRoles, editableRoles: field.editableRoles, replace: existed,
      })}
      remove={(id) => del(controlToken, `/studio/v1/fields/${encodeURIComponent(id)}`)}
      onSaved={onSaved}
      renderEntry={(field, set, { isNew, others }) => (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Text label="Field name" value={field.label} onChange={(label) => set(isNew ? { label, fieldKey: slugKey(label, others.filter((other) => other.entityType === field.entityType).map((other) => other.fieldKey)) } : { label })} />
            {isNew
              ? <Choice label="Used on" value={field.entityType} options={ENTITY_OPTIONS} onChange={(entityType) => set({ entityType })} />
              : <p className="grid gap-1 text-xs"><span className="font-medium text-muted-foreground">Used on</span><span className="py-2 text-sm">{labelOf(ENTITY_OPTIONS, field.entityType)}</span></p>}
            <Choice label="Kind of value" value={field.dataType} options={FIELD_TYPE_OPTIONS} onChange={(dataType) => set({ dataType })} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={field.required} onCheckedChange={(value) => set({ required: Boolean(value) })} aria-label={`${field.label} is required`} />
            Must be filled in
          </label>
          <Advanced>
            <Text label="Technical key" mono value={field.fieldKey} onChange={(fieldKey) => isNew && set({ fieldKey })} />
            <ChipPicker label="Who can see it" options={ROLE_OPTIONS} value={field.visibleRoles ?? []} onChange={(visibleRoles) => set({ visibleRoles })} />
            <ChipPicker label="Who can change it" options={ROLE_OPTIONS} value={field.editableRoles ?? []} onChange={(editableRoles) => set({ editableRoles })} />
          </Advanced>
        </>
      )}
    />
  );
}

// ---- rules --------------------------------------------------------------------

function RuleConditions({ rule, set }) {
  const { advanced } = useStudioMode();
  const rows = conditionToRows(rule.condition);
  const setRows = (next) => set({ condition: rowsToCondition(next) });
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">When</p>
      {rows.map((row, index) => {
        const known = RULE_FIELDS.find((field) => field.value === row.field);
        const fieldOptions = known ? RULE_FIELDS : [...RULE_FIELDS, { value: row.field, label: row.field }];
        const operators = (known?.type ?? 'text') === 'number' ? RULE_OPERATORS : RULE_OPERATORS.filter((op) => op.value === 'eq');
        const change = (patch) => setRows(rows.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
        return (
          <div key={index} className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
            {advanced
              ? <Text label="Context field" mono value={row.field} onChange={(field) => change({ field })} />
              : <Choice label="This" value={row.field} options={fieldOptions} onChange={(field) => change({ field, op: RULE_FIELDS.find((entry) => entry.value === field)?.type === 'number' ? row.op : 'eq' })} />}
            <Choice label="Check" value={row.op} options={operators} onChange={(op) => change({ op })} />
            <Text label="Value" value={row.value} onChange={(value) => change({ value })} />
            <Button type="button" size="icon" variant="ghost" aria-label="Remove condition" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button>
          </div>
        );
      })}
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => setRows([...rows, { field: 'daysToExpiry', op: 'Lt', value: '30' }])}><Plus className="size-4" />And also</Button>
      </div>
    </div>
  );
}

function RuleTester({ controlToken }) {
  const [values, setValues] = useState({ daysToExpiry: '10', adjustmentValue: '', varianceQty: '', transferValue: '', branchCity: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  async function check() {
    setError('');
    const context = {};
    for (const field of RULE_FIELDS) {
      const raw = values[field.value];
      if (raw === '' || raw === undefined) continue;
      context[field.value] = field.type === 'number' ? Number(raw) : raw;
    }
    try {
      const response = await post(controlToken, '/studio/v1/rules/evaluate', context);
      setResult(response.outcomes ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check failed');
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Try your rules</CardTitle>
        <p className="text-xs text-muted-foreground">Fill in a made-up situation and see which published rules would fire. Leave a box empty if it does not apply.</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-5">
          {RULE_FIELDS.map((field) => (
            <Text key={field.value} label={field.label} type={field.type === 'number' ? 'number' : 'text'} value={values[field.value]} onChange={(value) => setValues({ ...values, [field.value]: value })} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={check}>Check</Button>
          {result && <span aria-live="polite" className="text-sm">{result.length ? `These would happen: ${result.map(describeRuleResult).join('; ')}` : 'No rule matches this situation.'}</span>}
          {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export function RulesEditor({ controlToken, draft, onSaved }) {
  const entries = draft?.rules ?? [];
  return (
    <div className="grid gap-4">
      <StudioListEditor
        title="Rules"
        description="If-this-then-that checks, for example: when days left to expiry is less than 30, create an expiry task. Every condition of a rule must be true for it to fire."
        notLive="Saved, published and testable below, but the app does not run these rules on its own yet."
        entries={entries}
        idOf={(rule) => rule.key}
        newEntry={(current) => ({ key: slugKey('new rule', current.map((rule) => rule.key)), name: 'New rule', condition: { daysToExpiryLt: 30 }, outcome: { action: 'CREATE_TASK:EXPIRY_ACTION' } })}
        summarize={(rule) => `${rule.name}: ${describeRule(rule)}`}
        addLabel="Add rule"
        emptyText="No rules yet."
        save={(rule) => post(controlToken, '/studio/v1/rules', rule)}
        remove={(key) => del(controlToken, `/studio/v1/rules/${encodeURIComponent(key)}`)}
        onSaved={onSaved}
        renderEntry={(rule, set, { isNew, others }) => (
          <>
            <Text label="Rule name" value={rule.name} onChange={(name) => set(isNew ? { name, key: slugKey(name, others.map((other) => other.key)) } : { name })} />
            <RuleConditions rule={rule} set={set} />
            <Choice label="Then" value={outcomeToAction(rule.outcome)} options={RULE_ACTIONS.some((entry) => entry.value === outcomeToAction(rule.outcome)) ? RULE_ACTIONS : [...RULE_ACTIONS, { value: outcomeToAction(rule.outcome), label: outcomeToAction(rule.outcome) }]} onChange={(action) => set({ outcome: actionToOutcome(action) })} />
            <Advanced>
              <Text label="Technical key" mono value={rule.key} onChange={(key) => isNew && set({ key })} />
              <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[11px]">{JSON.stringify({ condition: rule.condition, outcome: rule.outcome }, null, 2)}</pre>
            </Advanced>
          </>
        )}
      />
      <RuleTester controlToken={controlToken} />
    </div>
  );
}

// ---- reports ------------------------------------------------------------------

export function ReportsEditor({ controlToken, draft, onSaved }) {
  const entries = draft?.reports ?? [];
  return (
    <StudioListEditor
      title="Reports"
      description="Name a report, choose what it is about and tick the columns it shows, in the order you tick them."
      notLive="Saved and published, but these reports do not appear in the app's Reports page yet."
      entries={entries}
      idOf={(report) => report.key}
      newEntry={(current) => ({ key: slugKey('new report', current.map((report) => report.key)), name: 'New report', entity: 'inventory', columns: ['item_code', 'available'], filters: {} })}
      summarize={(report) => `${report.name}: ${labelOf(REPORT_DATASETS, report.entity)} - ${report.columns.map((column) => reportColumnLabel(report.entity, column)).join(', ') || 'no columns'}`}
      addLabel="Add report"
      emptyText="No reports yet."
      save={(report) => post(controlToken, '/studio/v1/reports', report)}
      remove={(key) => del(controlToken, `/studio/v1/reports/${encodeURIComponent(key)}`)}
      onSaved={onSaved}
      renderEntry={(report, set, { isNew, others }) => {
        const dataset = datasetOf(report.entity);
        return (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Text label="Report name" value={report.name} onChange={(name) => set(isNew ? { name, key: slugKey(name, others.map((other) => other.key)) } : { name })} />
              <Choice label="About" value={report.entity} options={dataset ? REPORT_DATASETS : [...REPORT_DATASETS, { value: report.entity, label: report.entity }]}
                onChange={(entity) => set({ entity, columns: (datasetOf(entity)?.columns ?? []).slice(0, 2).map((column) => column.value) })} />
            </div>
            {dataset && <ChipPicker label="Columns" options={dataset.columns} value={report.columns} onChange={(columns) => set({ columns })} />}
            <Advanced>
              <Text label="Technical key" mono value={report.key} onChange={(key) => isNew && set({ key })} />
              <Text label="Column keys (comma separated)" mono value={report.columns.join(', ')} onChange={(raw) => set({ columns: raw.split(',').map((part) => part.trim()).filter(Boolean) })} />
            </Advanced>
          </>
        );
      }}
    />
  );
}

// ---- automations --------------------------------------------------------------

export function AutomationsEditor({ controlToken, draft, onSaved }) {
  const entries = draft?.automations ?? [];
  return (
    <StudioListEditor
      title="Automations"
      description="Something happens (or a time comes round) and Invexa does something for you - for example, when stock falls low, send a notification."
      notLive="Saved and published, but the app does not carry these out on its own yet."
      entries={entries}
      idOf={(automation) => automation.key}
      newEntry={(current) => ({ key: slugKey('new automation', current.map((automation) => automation.key)), name: 'New automation', trigger: 'event', expression: 'inventory.low_stock', actionKey: 'SEND_NOTIFICATION' })}
      summarize={(automation) => `${automation.name}: ${describeAutomation(automation)}`}
      addLabel="Add automation"
      emptyText="No automations yet."
      save={(automation) => post(controlToken, '/studio/v1/automations', automation)}
      remove={(key) => del(controlToken, `/studio/v1/automations/${encodeURIComponent(key)}`)}
      onSaved={onSaved}
      renderEntry={(automation, set, { isNew, others }) => {
        const list = automation.trigger === 'schedule' ? AUTOMATION_SCHEDULES : AUTOMATION_EVENTS;
        const options = list.some((entry) => entry.value === automation.expression) ? list : [...list, { value: automation.expression, label: automation.expression }];
        return (
          <>
            <Text label="Automation name" value={automation.name} onChange={(name) => set(isNew ? { name, key: slugKey(name, others.map((other) => other.key)) } : { name })} />
            <div className="grid gap-3 md:grid-cols-3">
              <Choice label="Starts" value={automation.trigger} options={[{ value: 'event', label: 'When something happens' }, { value: 'schedule', label: 'On a schedule' }]}
                onChange={(trigger) => set({ trigger, expression: (trigger === 'schedule' ? AUTOMATION_SCHEDULES : AUTOMATION_EVENTS)[0].value })} />
              <Choice label={automation.trigger === 'schedule' ? 'When' : 'What happens'} value={automation.expression} options={options} onChange={(expression) => set({ expression })} />
              <Choice label="Then" value={automation.actionKey} options={AUTOMATION_ACTIONS.some((entry) => entry.value === automation.actionKey) ? AUTOMATION_ACTIONS : [...AUTOMATION_ACTIONS, { value: automation.actionKey, label: automation.actionKey }]} onChange={(actionKey) => set({ actionKey })} />
            </div>
            <Advanced>
              <Text label="Technical key" mono value={automation.key} onChange={(key) => isNew && set({ key })} />
              <Text label="Event or schedule expression" mono value={automation.expression} onChange={(expression) => set({ expression })} />
              <Text label="Action key" mono value={automation.actionKey} onChange={(actionKey) => set({ actionKey })} />
            </Advanced>
          </>
        );
      }}
    />
  );
}

// ---- mobile app policy --------------------------------------------------------

export function MobilePolicyEditor({ controlToken, draft, onSaved }) {
  const entries = draft?.mobilePolicies ?? [];
  const freeRole = (current) => ROLE_OPTIONS.find((role) => !current.some((policy) => policy.role === role.value))?.value;
  return (
    <StudioListEditor
      title="Mobile app, per role"
      description="For each role: which screens the phone app shows, what it keeps for offline work, and how long it may stay offline before it must sync. Data on the phone is always encrypted."
      notLive="Saved and published, but the phone app does not read this yet: it still shows its standard screens."
      entries={entries}
      idOf={(policy) => policy.role}
      canAdd={entries.length < ROLE_OPTIONS.length}
      newEntry={(current) => ({ role: freeRole(current) ?? 'STORE_USER', offlineMaxHours: 12, syncScope: ['stock'], navigation: ['dashboard', 'stock'], encryptedLocalStore: true })}
      summarize={(policy) => `${labelOf(ROLE_OPTIONS, policy.role)}: ${policy.navigation.map((screen) => labelOf(MOBILE_SCREENS, screen)).join(', ')} · offline up to ${policy.offlineMaxHours} h`}
      addLabel="Add a role"
      emptyText="No role has mobile settings yet."
      save={(policy) => post(controlToken, '/studio/v1/mobile-policy', policy)}
      remove={(role) => del(controlToken, `/studio/v1/mobile-policy/${encodeURIComponent(role)}`)}
      onSaved={onSaved}
      renderEntry={(policy, set, { isNew }) => (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {isNew
              ? <Choice label="Role" value={policy.role} options={ROLE_OPTIONS.filter((role) => role.value === policy.role || !entries.some((entry) => entry.role === role.value))} onChange={(role) => set({ role })} />
              : <p className="grid gap-1 text-xs"><span className="font-medium text-muted-foreground">Role</span><span className="py-2 text-sm font-medium">{labelOf(ROLE_OPTIONS, policy.role)}</span></p>}
            <Choice label="May stay offline for" value={String(policy.offlineMaxHours)}
              options={[...new Set([...OFFLINE_HOURS_OPTIONS, Number(policy.offlineMaxHours)])].sort((a, b) => a - b).map((hours) => ({ value: String(hours), label: `${hours} hours` }))}
              onChange={(hours) => set({ offlineMaxHours: Number(hours) })} />
          </div>
          <ChipPicker label="Screens in the app (in this order)" options={MOBILE_SCREENS} value={policy.navigation} onChange={(navigation) => set({ navigation })} />
          <ChipPicker label="Keep on the phone for offline work" options={MOBILE_SCREENS.filter((screen) => screen.value !== 'dashboard')} value={policy.syncScope} onChange={(syncScope) => set({ syncScope })} />
          <Advanced>
            <Text label="Navigation keys (comma separated)" mono value={policy.navigation.join(', ')} onChange={(raw) => set({ navigation: raw.split(',').map((part) => part.trim()).filter(Boolean) })} />
            <Text label="Sync scope keys (comma separated)" mono value={policy.syncScope.join(', ')} onChange={(raw) => set({ syncScope: raw.split(',').map((part) => part.trim()).filter(Boolean) })} />
            <Text label="Offline hours (any number)" type="number" value={String(policy.offlineMaxHours)} onChange={(hours) => set({ offlineMaxHours: Number(hours) })} />
          </Advanced>
        </>
      )}
    />
  );
}

// ---- approval workflows -------------------------------------------------------

function WorkflowSimulator({ controlToken, models }) {
  const [key, setKey] = useState(models[0]?.key ?? '');
  const [value, setValue] = useState('150000');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const chosen = models.find((model) => model.key === key) ?? models[0];
  async function run() {
    setError('');
    setResult('');
    try {
      const response = await post(controlToken, '/studio/v1/workflows/simulate', { key: chosen?.key, value: Number(value) });
      const auto = response.simulation.outcome === 'auto_approve';
      setResult(auto ? `Approved automatically (published version ${response.simulation.pinnedVersion}).` : `Needs approval from a ${labelOf(ROLE_OPTIONS, chosen?.approverRole ?? 'BRANCH_MANAGER').toLowerCase()} (published version ${response.simulation.pinnedVersion}).`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check failed');
    }
  }
  if (!models.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Try an amount</CardTitle>
        <p className="text-xs text-muted-foreground">See what the published approval would do with a given value. Save and publish first if you just changed it.</p>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Choice label="Approval" value={chosen?.key ?? ''} options={models.map((model) => ({ value: model.key, label: model.name }))} onChange={setKey} />
        <Text label="Value (₹)" type="number" value={value} onChange={setValue} />
        <Button type="button" variant="outline" onClick={run}>Check</Button>
        {result && <p aria-live="polite" className="text-sm md:col-span-3">{result}</p>}
        {error && <p role="alert" className="text-sm text-destructive md:col-span-3">{error}</p>}
      </CardContent>
    </Card>
  );
}

function workflowKey(target, others) {
  const taken = new Set(others.map((model) => model.key));
  let key = `${target}.approval`;
  for (let n = 2; taken.has(key); n += 1) key = `${target}.approval_${n}`;
  return key;
}

export function WorkflowsEditor({ controlToken, draft, onSaved }) {
  const models = (draft?.workflows ?? []).map(workflowToModel);
  return (
    <div className="grid gap-4">
      <StudioListEditor
        title="Approval limits"
        description="Set a value limit: anything at or under it is approved automatically, anything above it waits for the person you choose."
        notLive="Saved, published and testable below. Live approvals in the app still use the approval rules set in the main app (Settings), not these yet."
        entries={models}
        idOf={(model) => model.key}
        newEntry={(current) => {
          const target = WORKFLOW_TARGETS.find((entry) => !current.some((model) => model.target === entry.value))?.value ?? 'transfer';
          return { key: workflowKey(target, current), name: `${labelOf(WORKFLOW_TARGETS, target)} approval`, version: 1, target, threshold: '100000', approverRole: 'BRANCH_MANAGER' };
        }}
        summarize={(model) => `${model.name}: ${describeWorkflow(model)}`}
        addLabel="Add approval limit"
        emptyText="No approval limits yet."
        save={(model) => post(controlToken, '/studio/v1/workflows', modelToWorkflow(model))}
        remove={(key) => del(controlToken, `/studio/v1/workflows/${encodeURIComponent(key)}`)}
        onSaved={onSaved}
        renderEntry={(model, set, { isNew, others }) => (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Text label="Name" value={model.name} onChange={(name) => set({ name })} />
              {isNew
                ? <Choice label="For" value={model.target} options={WORKFLOW_TARGETS} onChange={(target) => set({ target, key: workflowKey(target, others), name: `${labelOf(WORKFLOW_TARGETS, target)} approval` })} />
                : <p className="grid gap-1 text-xs"><span className="font-medium text-muted-foreground">For</span><span className="py-2 text-sm">{labelOf(WORKFLOW_TARGETS, model.target)}</span></p>}
              <Text label="Approve automatically up to (₹)" type="number" value={model.threshold} onChange={(threshold) => set({ threshold })} />
              <Choice label="Above that, who approves" value={model.approverRole} options={ROLE_OPTIONS.filter((role) => ['ADMIN', 'BRANCH_MANAGER'].includes(role.value))} onChange={(approverRole) => set({ approverRole })} />
            </div>
            <p className="text-xs text-muted-foreground">{describeWorkflow(model)}</p>
            <Advanced>
              <Text label="Technical key" mono value={model.key} onChange={(key) => isNew && set({ key })} />
              <Text label="Version" type="number" value={String(model.version)} onChange={(version) => set({ version: Number(version) })} />
            </Advanced>
          </>
        )}
      />
      <WorkflowSimulator controlToken={controlToken} models={models} />
    </div>
  );
}

export { NotLiveNote };

// ---- extra stock column -------------------------------------------------------

/** Adds a plain value column to the stock table (shown with its default until filled). */
export function StockExtraColumnCard({ controlToken, draft, onSaved }) {
  const taken = (draft?.page?.columns ?? []).map((column) => column.key);
  const [name, setName] = useState('');
  const [type, setType] = useState('number');
  const [defaultValue, setDefaultValue] = useState('0');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const autoKey = slugKey(name || 'column', [...taken, 'item_code']);
  async function add() {
    if (!name.trim()) { setError('Give the column a name.'); return; }
    setSaving(true);
    setError('');
    try {
      await post(controlToken, '/studio/v1/draft/stock/columns', { name: name.trim(), key: key || autoKey, type, defaultValue: type === 'number' ? Number(defaultValue) || 0 : defaultValue });
      setName('');
      setKey('');
      await onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the column');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add an empty column to the stock table</CardTitle>
        <p className="text-xs text-muted-foreground">For example Minimum stock. It appears in the stock table with the default value; move, rename or hide it in Table columns above.</p>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
        <Text label="Column name" value={name} onChange={setName} placeholder="Minimum stock" />
        <Choice label="Kind of value" value={type} options={FIELD_TYPE_OPTIONS.filter((option) => ['number', 'text'].includes(option.value))} onChange={setType} />
        <Text label="Shown when empty" value={defaultValue} onChange={setDefaultValue} />
        <Button type="button" onClick={add} disabled={saving}>{saving ? 'Adding…' : 'Add column'}</Button>
        <Advanced>
          <Text label={`Technical key (blank = ${autoKey})`} mono value={key} onChange={setKey} />
        </Advanced>
        {error && <p role="alert" className="text-sm text-destructive md:col-span-4">{error}</p>}
      </CardContent>
    </Card>
  );
}
