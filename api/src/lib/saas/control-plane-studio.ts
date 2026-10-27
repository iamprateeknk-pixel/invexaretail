import { randomUUID } from 'node:crypto';
import { FormulaError, validateFormula } from '../formula.js';
import { ACTION_REGISTRY, MODULE_REGISTRY, TABLE_RULES } from './control-plane-defaults.js';
import { clonePage, ControlPlaneError, normalizeColumnRoles, nowIso, pageTableColumns } from './control-plane.js';
import type { ScopeContext, CompanyRecord, FieldDefinition, ColumnDefinition, PageDefinition, ConfigurationVersion, WorkflowDefinition, RuleDefinition, ReportDefinition, AutomationDefinition, DraftEntryKind, MobilePolicy, TableKey, AuditEvent, ConfigStatus } from './control-plane.js';
import type { ControlPlaneStore } from './control-plane-store.js';

/** Cross-calls the studio area needs from the facade (they stay on ControlPlane). */
export interface ControlPlaneStudioHost {
  requireCompany(companyId: string): CompanyRecord;
  blankConfig(companyId: string, authorId: string, version: number, status: ConfigStatus): ConfigurationVersion;
  auditEvent(input: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent;
  assertFeature(companyId: string, featureKey: string): void;
  assertBillingWritable(companyId: string): void;
  isFeatureEnabled(companyId: string, featureKey: string): boolean;
}

const COMPARATOR_SUFFIXES = ['Gte', 'Lte', 'Gt', 'Lt'] as const;

function ruleConditionMatches(condition: Record<string, unknown>, context: Record<string, unknown>): boolean {
  return Object.entries(condition).every(([key, expected]) => {
    const comparator = COMPARATOR_SUFFIXES.find((suffix) => key.endsWith(suffix));
    if (!comparator) return context[key] === expected;
    const field = key.slice(0, -comparator.length);
    const actual = Number(context[field]);
    const threshold = Number(expected);
    if (Number.isNaN(actual) || Number.isNaN(threshold)) return false;
    if (comparator === 'Gt') return actual > threshold;
    if (comparator === 'Gte') return actual >= threshold;
    if (comparator === 'Lt') return actual < threshold;
    return actual <= threshold;
  });
}

function ruleOutcomeAction(outcome: Record<string, unknown>): string {
  if (typeof outcome.action === 'string') return outcome.action;
  const [first] = Object.values(outcome);
  return String(first ?? '');
}

/** Draft configuration studio: columns, fields, formulas, layouts, publish/rollback (area S5 of the ControlPlane facade). */
export class ControlPlaneStudio {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly host: ControlPlaneStudioHost,
  ) {}

  ensureDraft(scope: ScopeContext): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    const existing = this.store.drafts.get(companyId);
    if (existing) return existing;
    const published = this.store.published.get(companyId) ?? this.host.blankConfig(companyId, scope.actorId, 1, 'published');
    const draft = {
      ...JSON.parse(JSON.stringify(published)) as ConfigurationVersion,
      id: randomUUID(),
      version: published.version + 1,
      status: 'draft' as const,
      authorId: scope.actorId,
      parentVersion: published.version,
      publishedAt: null,
      createdAt: nowIso(),
    };
    this.store.drafts.set(companyId, draft);
    return draft;
  }

  requireLockedCompany(scope: ScopeContext): string {
    if (scope.sessionType !== 'control' || !scope.companyId || !scope.companySessionId) {
      throw new ControlPlaneError('Hard-locked company control session required', 'SESSION_REQUIRED', 401);
    }
    const session = this.store.sessions.get(scope.companySessionId);
    if (!session || session.status !== 'active' || session.companyId !== scope.companyId) {
      throw new ControlPlaneError('Company control session is closed', 'SESSION_CLOSED', 401);
    }
    return scope.companyId;
  }

  addStockColumn(scope: ScopeContext, input: {
    name: string;
    key: string;
    type: string;
    required?: boolean;
    defaultValue?: unknown;
    placement?: string;
    visibleRoles?: string[];
    editableRoles?: string[];
  }): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.host.assertBillingWritable(companyId);
    this.host.assertFeature(companyId, 'INVENTORY');
    if (!this.store.plans.get(this.host.requireCompany(companyId).planId)?.capabilities.custom_fields) {
      throw new ControlPlaneError('Custom fields are not entitled', 'FEATURE_NOT_ENTITLED', 403);
    }
    const draft = this.ensureDraft(scope);
    if (draft.page.columns.some((column) => column.key === input.key) || input.key === 'item_code') {
      throw new ControlPlaneError('Reserved or duplicate field key', 'RESERVED_FIELD', 400);
    }
    const field: FieldDefinition = {
      id: randomUUID(),
      companyId,
      entityType: 'stock',
      fieldKey: input.key,
      label: input.name,
      dataType: input.type,
      required: Boolean(input.required),
      defaultValue: input.defaultValue ?? 0,
      placement: input.placement ?? 'after:available',
      visibleRoles: input.visibleRoles ?? ['ADMIN', 'BRANCH_MANAGER'],
      editableRoles: input.editableRoles ?? ['ADMIN'],
      sortFilter: true,
      exportEnabled: true,
      mobileEnabled: true,
      status: 'active',
    };
    draft.fields.push(field);
    const column: ColumnDefinition = {
      key: input.key,
      label: input.name,
      type: input.type,
      source: 'custom',
      visible: true,
      exportEnabled: true,
      mobileEnabled: true,
      visibleRoles: field.visibleRoles,
    };
    const afterIndex = draft.page.columns.findIndex((entry) => entry.key === 'available');
    if (afterIndex >= 0) draft.page.columns.splice(afterIndex + 1, 0, column);
    else draft.page.columns.push(column);
    return draft;
  }

  // Generic Field Builder (blueprint §16 "Field builder"): works across any
  // entity type, not only the stock page. addStockColumn() above is kept
  // as-is for backward compatibility (it also mirrors into page.columns,
  // which only the stock page renders today) - this is the path for
  // fields on entities that don't have a page-rendering surface yet.

  addField(scope: ScopeContext, input: {
    entityType: string;
    key: string;
    name: string;
    type: string;
    required?: boolean;
    defaultValue?: unknown;
    visibleRoles?: string[];
    editableRoles?: string[];
    // true = edit the existing field with this entity + key instead of refusing the duplicate.
    replace?: boolean;
  }): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.host.assertBillingWritable(companyId);
    if (!this.store.plans.get(this.host.requireCompany(companyId).planId)?.capabilities.custom_fields) {
      throw new ControlPlaneError('Custom fields are not entitled', 'FEATURE_NOT_ENTITLED', 403);
    }
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(input.key)) throw new ControlPlaneError('Field key must be lowercase letters, numbers and _', 'INVALID_FIELD_KEY', 400);
    if (!input.name.trim()) throw new ControlPlaneError('Every field needs a name', 'INVALID_FIELD_NAME', 400);
    const draft = this.ensureDraft(scope);
    const existing = draft.fields.findIndex((entry) => entry.entityType === input.entityType && entry.fieldKey === input.key);
    if (existing >= 0 && !input.replace) {
      throw new ControlPlaneError('Duplicate field key for this entity', 'RESERVED_FIELD', 400);
    }
    const field: FieldDefinition = {
      id: randomUUID(),
      companyId,
      entityType: input.entityType,
      fieldKey: input.key,
      label: input.name,
      dataType: input.type,
      required: Boolean(input.required),
      defaultValue: input.defaultValue ?? null,
      visibleRoles: input.visibleRoles ?? ['ADMIN', 'BRANCH_MANAGER'],
      editableRoles: input.editableRoles ?? ['ADMIN'],
      sortFilter: true,
      exportEnabled: true,
      mobileEnabled: true,
      status: 'active',
    };
    if (existing >= 0) draft.fields[existing] = { ...field, id: draft.fields[existing].id };
    else draft.fields.push(field);
    return draft;
  }

  tableColumnsOf(draft: ConfigurationVersion, table: TableKey): ColumnDefinition[] {
    return pageTableColumns(draft.page, table);
  }

  setTableColumnsOf(draft: ConfigurationVersion, table: TableKey, columns: ColumnDefinition[]): void {
    if (table === 'stock') draft.page.columns = columns;
    else {
      draft.page.tables ??= {};
      draft.page.tables[table] = columns;
    }
  }

  /** The draft's columns for one table (created from the built-in defaults if never edited). */

  getDraftColumns(scope: ScopeContext, table: TableKey = 'stock'): ColumnDefinition[] {
    this.requireLockedCompany(scope);
    return this.tableColumnsOf(this.ensureDraft(scope), table);
  }

  /**
   * Reorders, renames and shows/hides a table's columns (core and custom) in the draft.
   * `layout` lists column keys in the wanted order; columns left out keep their relative order
   * after the listed ones. Essential columns (item name, row action) can be renamed and moved but never hidden.
   */

  setStockColumnLayout(scope: ScopeContext, layout: Array<{ key: string; label?: string; visible?: boolean; visibleRoles?: string[] | null }>, table: TableKey = 'stock'): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.host.assertBillingWritable(companyId);
    const draft = this.ensureDraft(scope);
    const current = this.tableColumnsOf(draft, table);
    const byKey = new Map(current.map((column) => [column.key, column]));
    const seen = new Set<string>();
    const ordered: ColumnDefinition[] = [];
    for (const entry of layout) {
      const column = byKey.get(String(entry?.key ?? ''));
      if (!column) throw new ControlPlaneError(`Unknown column "${String(entry?.key ?? '')}"`, 'COLUMN_NOT_FOUND', 404);
      if (seen.has(column.key)) throw new ControlPlaneError(`Column "${column.label}" is listed twice`, 'DUPLICATE_COLUMN', 400);
      seen.add(column.key);
      if (entry.label !== undefined) {
        const label = String(entry.label).replace(/\p{Cc}/gu, ' ').trim().slice(0, 60);
        if (!label) throw new ControlPlaneError('Every column needs a name', 'INVALID_COLUMN_LABEL', 400);
        column.label = label;
      }
      if (entry.visible !== undefined) {
        if (TABLE_RULES[table].locked.includes(column.key) && entry.visible === false) {
          throw new ControlPlaneError(`The "${column.label}" column cannot be hidden`, 'COLUMN_REQUIRED', 400);
        }
        column.visible = Boolean(entry.visible);
      }
      if (entry.visibleRoles !== undefined) {
        const roles = normalizeColumnRoles(entry.visibleRoles);
        if (roles && TABLE_RULES[table].locked.includes(column.key)) {
          throw new ControlPlaneError(`The "${column.label}" column must stay visible to every role`, 'COLUMN_REQUIRED', 400);
        }
        if (roles) column.visibleRoles = roles;
        else delete column.visibleRoles;
      }
      ordered.push(column);
    }
    this.setTableColumnsOf(draft, table, [...ordered, ...current.filter((column) => !seen.has(column.key))]);
    return draft;
  }

  /**
   * Adds or updates a calculated column in the draft. New columns are keyed `calc_*`; some built-in
   * columns (stock: `available`) can also be given a formula (clear it to restore the standard one).
   */

  setStockFormulaColumn(scope: ScopeContext, input: { key?: string; label: string; formula: string; type?: string }, table: TableKey = 'stock'): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.host.assertBillingWritable(companyId);
    const label = String(input.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60);
    if (!label) throw new ControlPlaneError('Give the column a name', 'INVALID_COLUMN_LABEL', 400);
    const formula = String(input.formula ?? '').trim();
    try {
      validateFormula(formula, TABLE_RULES[table].formulaFields);
    } catch (error) {
      if (error instanceof FormulaError) throw new ControlPlaneError(error.message, 'INVALID_FORMULA', 400);
      throw error;
    }
    const draft = this.ensureDraft(scope);
    const columns = this.tableColumnsOf(draft, table);
    const type = input.type === 'currency' ? 'currency' : 'number';
    const requestedKey = String(input.key ?? '').trim();
    if (requestedKey && TABLE_RULES[table].overridable.includes(requestedKey)) {
      const target = columns.find((column) => column.key === requestedKey);
      if (!target) throw new ControlPlaneError('Unknown column', 'COLUMN_NOT_FOUND', 404);
      target.formula = formula;
      target.label = label;
      return draft;
    }
    if (requestedKey && !/^calc_[a-z0-9_]{1,30}$/.test(requestedKey)) {
      throw new ControlPlaneError('Only calculated columns can hold a formula', 'INVALID_COLUMN_KEY', 400);
    }
    const existing = requestedKey ? columns.find((column) => column.key === requestedKey) : undefined;
    if (requestedKey && !existing) throw new ControlPlaneError('Unknown calculated column', 'COLUMN_NOT_FOUND', 404);
    if (existing) {
      existing.label = label;
      existing.formula = formula;
      existing.type = type;
      return draft;
    }
    if (columns.filter((column) => column.source === 'formula').length >= 12) {
      throw new ControlPlaneError('A maximum of 12 calculated columns is allowed', 'TOO_MANY_FORMULAS', 400);
    }
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'column';
    let key = `calc_${slug}`;
    for (let n = 2; columns.some((column) => column.key === key); n += 1) key = `calc_${slug}_${n}`;
    columns.push({
      key, label, type, source: 'formula', formula, visible: true, exportEnabled: true, mobileEnabled: true,
    });
    return draft;
  }

  /** Adds a table column that shows one of the company's item custom fields (by name). */

  addItemFieldColumn(scope: ScopeContext, input: { fieldName: string; label?: string }, table: TableKey = 'stock'): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.host.assertBillingWritable(companyId);
    const fieldName = String(input.fieldName ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 80);
    if (!fieldName) throw new ControlPlaneError('Choose an item field', 'INVALID_ITEM_FIELD', 400);
    const draft = this.ensureDraft(scope);
    const columns = this.tableColumnsOf(draft, table);
    if (columns.some((column) => column.itemField === fieldName)) {
      throw new ControlPlaneError('This item field is already a column', 'DUPLICATE_COLUMN', 400);
    }
    if (columns.filter((column) => column.source === 'itemField').length >= 12) {
      throw new ControlPlaneError('A maximum of 12 item field columns is allowed', 'TOO_MANY_ITEM_FIELDS', 400);
    }
    const label = String(input.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) || fieldName;
    const slug = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'field';
    let key = `field_${slug}`;
    for (let n = 2; columns.some((column) => column.key === key); n += 1) key = `field_${slug}_${n}`;
    columns.push({ key, label, type: 'text', source: 'itemField', itemField: fieldName, visible: true, exportEnabled: true, mobileEnabled: true });
    return draft;
  }

  /** Removes a calculated / item-field column, or restores the standard formula of a built-in one. */

  clearStockFormula(scope: ScopeContext, key: string, table: TableKey = 'stock'): ConfigurationVersion {
    this.requireLockedCompany(scope);
    const draft = this.ensureDraft(scope);
    const columns = this.tableColumnsOf(draft, table);
    const column = columns.find((entry) => entry.key === key);
    if (!column) throw new ControlPlaneError('Unknown column', 'COLUMN_NOT_FOUND', 404);
    if (column.source === 'formula' || column.source === 'itemField') this.setTableColumnsOf(draft, table, columns.filter((entry) => entry.key !== key));
    else if (column.formula) {
      delete column.formula;
      if (column.key === 'available') column.label = 'Available';
    } else throw new ControlPlaneError('This column has no formula', 'NO_FORMULA', 400);
    return draft;
  }

  setActionEnabled(scope: ScopeContext, actionKey: string, enabled: boolean): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const action = draft.page.actions.find((entry) => entry.key === actionKey);
    if (!action) throw new ControlPlaneError('Unknown action', 'ACTION_NOT_FOUND', 404);
    action.enabled = enabled;
    return draft;
  }

  moveTab(scope: ScopeContext, tabKey: string, order: number): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const tab = draft.page.tabs.find((entry) => entry.key === tabKey);
    if (!tab) throw new ControlPlaneError('Unknown tab', 'TAB_NOT_FOUND', 404);
    tab.order = order;
    draft.page.tabs.sort((left, right) => left.order - right.order);
    return draft;
  }

  preview(scope: ScopeContext, input: { role: string; device: 'desktop' | 'tablet' | 'mobile' }): {
    role: string;
    device: string;
    page: PageDefinition;
    version: number;
  } {
    const draft = this.ensureDraft(scope);
    const page = clonePage(draft.page);
    page.columns = page.columns.filter((column) => !column.visibleRoles || column.visibleRoles.includes(input.role));
    page.actions = page.actions.filter((action) => action.enabled && (!action.visibleRoles || action.visibleRoles.includes(input.role)));
    if (input.device === 'mobile') {
      page.columns = page.columns.filter((column) => column.mobileEnabled);
    }
    return { role: input.role, device: input.device, page, version: draft.version };
  }

  diff(companyId: string): Array<{ op: '+' | '-' | '~'; path: string; from?: unknown; to?: unknown }> {
    const published = this.store.published.get(companyId);
    const draft = this.store.drafts.get(companyId);
    if (!published || !draft) return [];
    const changes: Array<{ op: '+' | '-' | '~'; path: string; from?: unknown; to?: unknown }> = [];
    const publishedKeys = new Set(published.page.columns.map((column) => column.key));
    for (const column of draft.page.columns) {
      if (!publishedKeys.has(column.key)) changes.push({ op: '+', path: `columns.${column.key}`, to: column.label });
    }
    for (const action of draft.page.actions) {
      const previous = published.page.actions.find((entry) => entry.key === action.key);
      if (previous && previous.enabled !== action.enabled) {
        changes.push({ op: action.enabled ? '+' : '-', path: `actions.${action.key}`, from: previous.enabled, to: action.enabled });
      }
    }
    return changes;
  }

  publish(scope: ScopeContext): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.host.assertBillingWritable(companyId);
    const draft = this.ensureDraft(scope);
    draft.status = 'published';
    draft.publishedAt = nowIso();
    this.store.published.set(companyId, JSON.parse(JSON.stringify(draft)) as ConfigurationVersion);
    const history = this.store.versions.get(companyId) ?? [];
    history.push(JSON.parse(JSON.stringify(draft)) as ConfigurationVersion);
    this.store.versions.set(companyId, history);
    this.store.drafts.delete(companyId);
    this.store.outbox.push({ id: randomUUID(), event: 'config.published', payload: { companyId, version: draft.version }, createdAt: nowIso() });
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: scope.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'CONFIG_PUBLISHED',
      entityType: 'configuration',
      entityId: String(draft.version),
      before: { parent: draft.parentVersion },
      after: { version: draft.version, diff: this.diff(companyId) },
    });
    return draft;
  }

  rollback(scope: ScopeContext, version: number): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    const history = this.store.versions.get(companyId) ?? [];
    const target = history.find((entry) => entry.version === version && entry.status === 'published');
    if (!target) throw new ControlPlaneError('Version not found', 'VERSION_NOT_FOUND', 404);
    const restored = {
      ...JSON.parse(JSON.stringify(target)) as ConfigurationVersion,
      id: randomUUID(),
      version: (this.store.published.get(companyId)?.version ?? version) + 1,
      parentVersion: this.store.published.get(companyId)?.version ?? version,
      authorId: scope.actorId,
      publishedAt: nowIso(),
      createdAt: nowIso(),
      status: 'published' as const,
    };
    this.store.published.set(companyId, restored);
    history.push(restored);
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: scope.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'CONFIG_ROLLBACK',
      entityType: 'configuration',
      entityId: String(restored.version),
      before: { restoredFrom: version },
      after: { version: restored.version },
    });
    return restored;
  }

  runtimeConfig(companyId: string, role = 'ADMIN'): {
    companyId: string;
    version: number;
    page: PageDefinition;
    modules: Record<string, boolean>;
    killSwitches: Record<string, boolean>;
    mobilePolicy?: MobilePolicy;
  } {
    const published = this.store.published.get(companyId) ?? this.host.blankConfig(companyId, 'system', 1, 'published');
    const page = clonePage(published.page);
    page.columns = page.columns.filter((column) => column.visible && (!column.visibleRoles || column.visibleRoles.includes(role)));
    for (const [key, columns] of Object.entries(page.tables ?? {})) {
      page.tables![key] = columns.filter((column) => column.visible && (!column.visibleRoles || column.visibleRoles.includes(role)));
    }
    page.actions = page.actions.filter((action) => action.enabled && (!action.visibleRoles || action.visibleRoles.includes(role)));
    return {
      companyId,
      version: published.version,
      page,
      modules: Object.fromEntries(
        Object.keys(MODULE_REGISTRY).map((key) => [key, this.host.isFeatureEnabled(companyId, key)]),
      ),
      killSwitches: Object.fromEntries(this.store.safety.entries()),
      mobilePolicy: published.mobilePolicies.find((policy) => policy.role === role),
    };
  }

  moduleRegistry() {
    return { modules: MODULE_REGISTRY, actions: ACTION_REGISTRY };
  }

  setCompanyModule(scope: ScopeContext, moduleKey: string, enabled: boolean): void {
    const companyId = this.requireLockedCompany(scope);
    if (enabled && this.store.safety.get(moduleKey) === false) {
      throw new ControlPlaneError('Platform safety policy forbids enabling this feature', 'SAFETY_FLOOR', 403);
    }
    const planAllows = this.store.plans.get(this.host.requireCompany(companyId).planId)?.modules[moduleKey] === true;
    if (enabled && !planAllows && this.store.entitlements.get(companyId)?.[moduleKey] !== true) {
      throw new ControlPlaneError('Feature is not entitled', 'FEATURE_NOT_ENTITLED', 403);
    }
    const entitlements = this.store.entitlements.get(companyId) ?? {};
    entitlements[moduleKey] = enabled;
    this.store.entitlements.set(companyId, entitlements);
    const draft = this.ensureDraft(scope);
    draft.modules[moduleKey] = enabled;
  }

  upsertWorkflow(scope: ScopeContext, workflow: WorkflowDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.workflows.findIndex((entry) => entry.key === workflow.key);
    if (index >= 0) draft.workflows[index] = workflow;
    else draft.workflows.push(workflow);
    return draft;
  }

  simulateWorkflow(companyId: string, workflowKey: string, context: { value: number }): { outcome: string; pinnedVersion: number } {
    const published = this.store.published.get(companyId);
    const workflow = published?.workflows.find((entry) => entry.key === workflowKey);
    if (!workflow) throw new ControlPlaneError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
    const thresholdNode = workflow.graph.nodes.find((node) => node.type === 'condition');
    const amount = Number(thresholdNode?.config.amount ?? 100000);
    return {
      outcome: context.value <= amount ? 'auto_approve' : 'manager_approval',
      pinnedVersion: workflow.version,
    };
  }

  // Generic condition/outcome evaluator: no rule key is special-cased, so a
  // rule created through the Studio Rule Builder fires the same way as a
  // seeded one. Condition keys ending in Gt/Gte/Lt/Lte compare a context
  // field numerically (e.g. `adjustmentValueGt: 10000` reads
  // `context.adjustmentValue`); every other key is an equality check. All
  // conditions on a rule must match (AND). This is deterministic on
  // purpose, per the blueprint's "do not hide behind AI" rule (§13).

  evaluateRule(companyId: string, context: Record<string, unknown>): string[] {
    const published = this.store.published.get(companyId);
    const outcomes: string[] = [];
    for (const rule of published?.rules ?? []) {
      if (ruleConditionMatches(rule.condition, context)) {
        outcomes.push(ruleOutcomeAction(rule.outcome));
      }
    }
    return outcomes;
  }

  upsertRule(scope: ScopeContext, rule: RuleDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.rules.findIndex((entry) => entry.key === rule.key);
    if (index >= 0) draft.rules[index] = rule;
    else draft.rules.push(rule);
    return draft;
  }

  upsertReport(scope: ScopeContext, report: ReportDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.reports.findIndex((entry) => entry.key === report.key);
    if (index >= 0) draft.reports[index] = report;
    else draft.reports.push(report);
    return draft;
  }

  upsertAutomation(scope: ScopeContext, automation: AutomationDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.automations.findIndex((entry) => entry.key === automation.key);
    if (index >= 0) draft.automations[index] = automation;
    else draft.automations.push(automation);
    return draft;
  }

  upsertMobilePolicy(scope: ScopeContext, policy: MobilePolicy): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.mobilePolicies.findIndex((entry) => entry.role === policy.role);
    const normalized: MobilePolicy = { ...policy, encryptedLocalStore: true };
    if (index >= 0) draft.mobilePolicies[index] = normalized;
    else draft.mobilePolicies.push(normalized);
    return draft;
  }

  /**
   * Removes one entry from the draft: a field (key = "entityType:fieldKey"), workflow, rule,
   * report, automation, or a role's mobile policy (key = role). Takes effect on the next publish.
   */

  removeDraftEntry(scope: ScopeContext, kind: DraftEntryKind, key: string): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.host.assertBillingWritable(companyId);
    const draft = this.ensureDraft(scope);
    const before = draft[kind].length;
    if (kind === 'fields') {
      const [entityType, fieldKey] = key.split(':');
      draft.fields = draft.fields.filter((entry) => !(entry.entityType === entityType && entry.fieldKey === fieldKey));
    } else if (kind === 'mobilePolicies') {
      draft.mobilePolicies = draft.mobilePolicies.filter((entry) => entry.role !== key);
    } else {
      (draft as unknown as Record<string, Array<{ key: string }>>)[kind] = (draft[kind] as Array<{ key: string }>).filter((entry) => entry.key !== key);
    }
    if (draft[kind].length === before) throw new ControlPlaneError('That entry was not found in the draft', 'DRAFT_ENTRY_NOT_FOUND', 404);
    return draft;
  }

}
