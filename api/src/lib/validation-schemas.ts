// [ULTRA] P3 (#186): zod schemas for the mutating routes converted in
// this PR. Every schema mirrors the hand-rolled check it replaces —
// same inputs accepted, same inputs rejected, same 400 — and the
// per-field message is the exact message that check used to send, so
// it lands in the envelope's `details[]` verbatim.
//
// What a schema deliberately does NOT do (parity rules):
// - No `.strict()`: extra fields pass through (validate.ts merges
//   parsed data into req.body instead of replacing it).
// - No role, tenant, existence or state-machine checks: those stay in
//   the handler/service (a schema cannot know whether a lot belongs to
//   an item, whether a return line is already dispositioned, or whether
//   the caller may work at a location).
// - No coercion a handler does not do: a field the handler checks with
//   `Number.isFinite` on the raw value is `z.number()` (a numeric
//   string is still rejected); a field the handler coerces with
//   `Number(...)` is `z.coerce.number()` (a numeric string is still
//   accepted). Where the handler treats ''/null as invalid,
//   `requiredNumber` maps them to `undefined` first — plain coerce
//   would turn them into 0 and accept them.
// - Where the handler FILTERS junk lines instead of rejecting them
//   (POST /orders, POST /purchase-orders/:id/invoices), the schema
//   applies the identical filter as a transform and only rejects when
//   nothing valid remains — a request the old code accepted with a
//   junk line dropped still succeeds.
import { z } from 'zod';
import { PO_STATUSES, type PoStatus } from './po-lifecycle.js';
import { COUNT_REASON_CODES } from './count-reason-codes.js';
import { MIN_COUNT_REVIEW_NOTE } from './count-lifecycle.js';

/** The 17 transfer statuses, single source of truth (was inline in routes/transfers.ts). */
export const TRANSFER_STATUSES = [
  'SUBMITTED', 'DRAFT', 'PENDING_PICK', 'REQUESTED', 'PICKING', 'PARTIAL', 'PICKED',
  'READY_FOR_ADMIN', 'CONFIRMED', 'IN_TRANSIT', 'DISPATCHED', 'PARTIALLY_RECEIVED',
  'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED',
] as const;

const PICK_EXCEPTION_REASONS = ['NO_STOCK', 'WRONG_ITEM', 'DAMAGED_ITEM'] as const;
const COUNT_REVIEW_STATUSES = ['APPROVED', 'REJECTED', 'RECOUNT'] as const;
const COUNT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
const ABC_CLASSES = ['A', 'B', 'C'] as const;
const REPORT_TYPES = ['inventory', 'low-stock', 'moves', 'variance', 'expiry', 'activity'] as const;

/** Coerce like the handler's `Number(...)`, but ''/null/missing are invalid, not 0. */
function requiredNumber(message: string, min: number) {
  return z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.coerce.number({ error: message }).min(min, message),
  );
}

/** A date the handler builds with `new Date(value)`: any value that parses. An empty string counts as absent — both assignment handlers treat it that way (`countDate ? ... : <default>`). */
function validDate(message: string) {
  return z
    .preprocess((value) => (value === '' ? undefined : value), z.unknown())
    .refine((value) => value === undefined || !Number.isNaN(new Date(value as string | number).getTime()), { message })
    .optional();
}

/** Uppercase + alias normalisation, mirroring the handler's own parse helpers. */
function uppercased(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

// ---------------------------------------------------------------------------
// Transfers (routes/transfers.ts)
// ---------------------------------------------------------------------------

const transferLineSchema = z.object({
  itemId: z.string({ error: 'Each transfer line requires an item and lot.' }).min(1, 'Each transfer line requires an item and lot.'),
  lotId: z.string({ error: 'Each transfer line requires an item and lot.' }).min(1, 'Each transfer line requires an item and lot.'),
  quantity: z
    .number({ error: 'Transfer quantities must be positive numbers.' })
    .positive('Transfer quantities must be positive numbers.'),
});

/** POST /transfers and PATCH /transfers/:transferId (validateTransferRequest's shape half). */
export const transferInputSchema = z
  .object({
    sourceLocationId: z.string({ error: 'Source and destination locations are required.' }).min(1, 'Source and destination locations are required.'),
    destinationLocationId: z.string({ error: 'Source and destination locations are required.' }).min(1, 'Source and destination locations are required.'),
    lines: z.array(transferLineSchema).min(1, 'At least one transfer line is required.'),
    // parseCartonCount: undefined/null/'' means "no carton count"; anything
    // else must coerce to a whole number >= 1. The `.optional()` sits
    // INSIDE the preprocess: the preprocess turns '' into undefined,
    // which only an inner optional accepts.
    cartonCount: z.preprocess(
      (value) => (value === '' || value === null || value === undefined ? undefined : value),
      z.coerce.number({ error: 'Carton count must be a whole number of at least 1.' }).int('Carton count must be a whole number of at least 1.').min(1, 'Carton count must be a whole number of at least 1.').optional(),
    ),
  })
  .refine((data) => data.sourceLocationId !== data.destinationLocationId, {
    message: 'A transfer cannot have the same source and destination.',
    path: ['destinationLocationId'],
  });

/** PATCH /transfers/:transferId/status */
export const transferStatusSchema = z.object({
  status: z.enum(TRANSFER_STATUSES, { error: 'Invalid transfer status.' }),
});

/** PATCH /transfers/:transferId/picker — pickerId is required: a string, or null to unassign. */
export const transferPickerSchema = z.object({
  pickerId: z.union([z.string(), z.null()], { error: 'pickerId must be a user id, or null to unassign.' }),
});

/** POST /picker/transfers/:transferId/allocation-preview (quantity stays with the handler: it coerces and caps against remaining). */
export const allocationPreviewSchema = z.object({
  itemId: z.string({ error: 'Item was not found.' }).min(1, 'Item was not found.'),
});

const pickSlipLineSchema = z.object({
  itemId: z.string().min(1),
  lotId: z.string().optional(),
  quantity: z.coerce.number({ error: 'Picked quantity must be greater than zero.' }).positive('Picked quantity must be greater than zero.'),
  inputMethod: z.string().optional(),
  scanCode: z.string().optional(),
});

const pickExceptionSchema = z.object({
  reason: z.enum(PICK_EXCEPTION_REASONS, { error: 'Exception reason must be No Stock, Wrong Item or Damaged Item.' }),
  quantity: z.coerce.number({ error: 'Exception quantity must be greater than zero.' }).positive('Exception quantity must be greater than zero.'),
  itemId: z.string().optional(),
  lotId: z.string().optional(),
  note: z.string().optional(),
});

/** POST /picker/transfers/:transferId/pick-slips */
export const pickSlipSchema = z
  .object({
    lines: z.array(pickSlipLineSchema).optional(),
    exceptions: z.array(pickExceptionSchema).optional(),
  })
  .refine((data) => (data.lines?.length ?? 0) + (data.exceptions?.length ?? 0) > 0, {
    message: 'At least one picked line or exception is required.',
    path: ['lines'],
  });

const transferReceiptLineSchema = z.object({
  itemId: z.string().min(1),
  lotId: z.string().min(1),
  // The handler maps receivedQty with plain Number(): a missing value is
  // NaN and the receipt validator rejects it — so it is required here.
  // damaged/shortage/excess default to 0 in the handler, so they are optional.
  receivedQty: z.coerce.number(),
  damagedQty: z.coerce.number().optional(),
  shortageQty: z.coerce.number().optional(),
  excessQty: z.coerce.number().optional(),
});

/**
 * POST /transfers/:transferId/receive. `lines` is preprocessed, not
 * rejected, when it is not an array: the handler falls back to its
 * single-line fields then, exactly as before.
 */
export const transferReceiveSchema = z.object({
  requestId: z.string({ error: 'A valid requestId is required for retry-safe receiving.' }).trim().min(1, 'A valid requestId is required for retry-safe receiving.').max(191, 'A valid requestId is required for retry-safe receiving.'),
  lines: z.preprocess(
    (value) => (Array.isArray(value) ? value : undefined),
    z.array(transferReceiptLineSchema).min(1).optional(),
  ),
  receivedQty: z.coerce.number().optional(),
  damagedQty: z.coerce.number().optional(),
  shortageQty: z.coerce.number().optional(),
  excessQty: z.coerce.number().optional(),
});

// ---------------------------------------------------------------------------
// Stock counts (routes/core-counts.ts)
// ---------------------------------------------------------------------------

const countRequestIdSchema = z
  .string({ error: 'requestId must be text of at most 191 characters.' })
  .max(191, 'requestId must be text of at most 191 characters.')
  .optional();

/** POST /stock-counts (validateBlindCountSubmission's shape half; blind-role rules stay in the handler). */
export const countSubmitSchema = z.object({
  itemId: z.string({ error: 'Item and location are required for a count submission.' }).min(1, 'Item and location are required for a count submission.'),
  locationId: z.string({ error: 'Item and location are required for a count submission.' }).min(1, 'Item and location are required for a count submission.'),
  physicalQuantity: z.number({ error: 'Physical quantity must be a non-negative number.' }).min(0, 'Physical quantity must be a non-negative number.'),
  requestId: countRequestIdSchema,
});

/** POST /stock-counts/weight */
export const weightCountSchema = z.object({
  itemId: z.string({ error: 'Item and location are required for a count submission.' }).min(1, 'Item and location are required for a count submission.'),
  locationId: z.string({ error: 'Item and location are required for a count submission.' }).min(1, 'Item and location are required for a count submission.'),
  totalQuantity: requiredNumber('Counted quantity must be a non-negative number.', 0),
  requestId: countRequestIdSchema,
});

/**
 * PATCH /stock-counts/:countId/review. `reviewReason` falls back to
 * `reason`, exactly as the handler reads it; the note-length rule
 * applies to whichever one is effectively used.
 */
export const countReviewSchema = z
  .object({
    status: z.preprocess(
      (value) => {
        const upper = uppercased(value);
        if (upper === 'APPROVE') return 'APPROVED';
        if (upper === 'REJECT') return 'REJECTED';
        return upper;
      },
      z.enum(COUNT_REVIEW_STATUSES, { error: 'Review status must be APPROVED, REJECTED, or RECOUNT.' }),
    ),
    reviewReason: z.string().optional(),
    reason: z.string().optional(),
    reasonCode: z.preprocess(
      (value) => (value === '' ? undefined : uppercased(value)),
      z.enum(COUNT_REASON_CODES, { error: `reasonCode must be one of: ${COUNT_REASON_CODES.join(', ')}.` }).optional(),
    ),
  })
  .refine((data) => (data.reviewReason ?? data.reason ?? '').trim().length >= MIN_COUNT_REVIEW_NOTE, {
    message: `A review note of at least ${MIN_COUNT_REVIEW_NOTE} characters is required.`,
    path: ['reviewReason'],
  });

/** POST /stock-counts/:countId/reconciliation/ack */
export const countReconciliationAckSchema = z.object({
  note: z
    .string({ error: `A review note of at least ${MIN_COUNT_REVIEW_NOTE} characters is required.` })
    .trim()
    .min(MIN_COUNT_REVIEW_NOTE, `A review note of at least ${MIN_COUNT_REVIEW_NOTE} characters is required.`),
});

/** POST /count-assignments */
export const countAssignmentSchema = z.object({
  locationId: z.string({ error: 'locationId, storeUserId and a non-empty itemIds array are required.' }).min(1, 'locationId, storeUserId and a non-empty itemIds array are required.'),
  storeUserId: z.string({ error: 'locationId, storeUserId and a non-empty itemIds array are required.' }).min(1, 'locationId, storeUserId and a non-empty itemIds array are required.'),
  itemIds: z.array(z.string()).min(1, 'locationId, storeUserId and a non-empty itemIds array are required.'),
  // An invalid countDate used to throw an uncaught RangeError (500) from
  // `new Date(...).toISOString()`; it is a 400 now.
  countDate: validDate('Count date is invalid.'),
  priority: z
    .preprocess(
      (value) => {
        if (value === '' || value === undefined || value === null) return undefined;
        const upper = uppercased(value);
        return upper === 'URGENT' ? 'HIGH' : upper;
      },
      z.enum(COUNT_PRIORITIES, { error: 'Priority must be LOW, NORMAL, or HIGH.' }).optional(),
    ),
});

/** PATCH /count-assignments/:assignmentId */
export const countAssignmentUpdateSchema = z.object({
  // A non-string assignedToId is ignored by the handler (falls back to
  // the current assignee), so the schema drops it instead of rejecting.
  assignedToId: z.preprocess(
    (value) => (typeof value === 'string' ? value : undefined),
    z.string().optional(),
  ),
  countDate: validDate('Count date is invalid.'),
  priority: z
    .preprocess(
      (value) => {
        if (value === '' || value === undefined || value === null) return undefined;
        const upper = uppercased(value);
        return upper === 'URGENT' ? 'HIGH' : upper;
      },
      z.enum(COUNT_PRIORITIES, { error: 'Priority must be LOW, NORMAL, or HIGH.' }).optional(),
    ),
  status: z.preprocess(
    (value) => (value === undefined ? undefined : uppercased(value)),
    z.enum(['ASSIGNED', 'CANCELLED', 'SUBMITTED'], { error: 'Assignments can be ASSIGNED, SUBMITTED or CANCELLED.' }).optional(),
  ),
});

/** DELETE /count-assignments/bulk. Junk entries are filtered out, exactly as the handler does, and only an empty result is rejected. */
export const countAssignmentBulkDeleteSchema = z.object({
  assignmentIds: z.preprocess(
    (value) =>
      Array.isArray(value)
        ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))]
        : value,
    z.array(z.string().min(1)).min(1, 'Select at least one count task to delete.'),
  ),
});

/**
 * POST /cycle-counts/:locationId/assign. `classes` mirrors
 * parseAbcClasses exactly: missing/empty means ['A']; a non-array is
 * rejected; unknown entries are dropped, and none left is rejected.
 */
export const cycleCountAssignSchema = z.object({
  storeUserId: z.string({ error: 'storeUserId is required.' }).min(1, 'storeUserId is required.'),
  classes: z
    .unknown()
    .optional()
    .refine((value) => value === undefined || value === null || Array.isArray(value), {
      message: 'classes must be an array of A, B, or C.',
    })
    .refine(
      (value) => {
        if (value === undefined || value === null || !Array.isArray(value) || value.length === 0) return true;
        return value.some(
          (entry) => typeof entry === 'string' && (ABC_CLASSES as readonly string[]).includes(entry.trim().toUpperCase()),
        );
      },
      { message: 'classes must include A, B, or C.' },
    )
    .transform((value) => {
      if (value === undefined || value === null || !Array.isArray(value) || value.length === 0) return ['A'] as string[];
      const selected = new Set(
        value
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim().toUpperCase())
          .filter((entry) => (ABC_CLASSES as readonly string[]).includes(entry)),
      );
      return ABC_CLASSES.filter((entry) => selected.has(entry));
    }),
});

// ---------------------------------------------------------------------------
// Returns (routes/opext-returns.ts)
// ---------------------------------------------------------------------------

/** POST /orders/:id/returns (quantity caps against fulfilled/returned totals stay in the transaction). */
export const returnCreateSchema = z.object({
  lines: z
    .array(
      z.object({
        orderLineId: z.string().min(1),
        quantity: z.coerce.number({ error: 'Return quantity must be a positive number.' }).positive('Return quantity must be a positive number.'),
      }),
    )
    .min(1, 'At least one return line is required.'),
});

/** POST /returns/:id/lines/:lineId/disposition — the value itself is domain logic (400/409 live in planReturnLine); only its type is shape. */
export const returnDispositionSchema = z.object({
  disposition: z.string().optional(),
});

/** PATCH /returns/:id/refund */
export const returnRefundSchema = z.object({
  status: z.enum(['REFUNDED', 'DENIED'], { error: 'Refund status must be REFUNDED or DENIED.' }),
  note: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Orders (routes/opext-orders.ts)
// ---------------------------------------------------------------------------

const orderLineInputSchema = z.object({ itemId: z.unknown(), quantity: z.unknown(), minRslPercent: z.unknown().optional() }).passthrough();

/** The handler's own map+filter, as a transform: junk lines are dropped, not rejected. */
function filterOrderLines(rows: Array<{ itemId: unknown; quantity: unknown; minRslPercent?: unknown }>) {
  return rows
    .map((line) => ({
      itemId: String(line.itemId ?? ''),
      quantity: Number(line.quantity),
      ...(Number(line.minRslPercent) > 0 && Number(line.minRslPercent) <= 100
        ? { minRslPercent: Number(line.minRslPercent) }
        : {}),
    }))
    .filter((line) => line.itemId && Number.isFinite(line.quantity) && line.quantity > 0);
}

/** POST /orders */
export const orderCreateSchema = z
  .object({
    channel: z.string({ error: 'channel and at least one positive-quantity line are required.' }).trim().min(1, 'channel and at least one positive-quantity line are required.'),
    lines: z.array(orderLineInputSchema, { error: 'channel and at least one positive-quantity line are required.' }).transform(filterOrderLines),
  })
  .refine((data) => data.lines.length > 0, {
    message: 'channel and at least one positive-quantity line are required.',
    path: ['lines'],
  });

/** POST /orders/:id/pack/scan (a missing quantity still defaults to 1 in the handler). */
export const packScanSchema = z.object({
  itemId: z.string({ error: 'itemId and a positive quantity are required.' }).min(1, 'itemId and a positive quantity are required.'),
  quantity: z.coerce.number({ error: 'itemId and a positive quantity are required.' }).positive('itemId and a positive quantity are required.').optional(),
});

// ---------------------------------------------------------------------------
// Procurement (routes/catalog-procurement.ts)
// ---------------------------------------------------------------------------

/** POST /catalog/tags */
export const tagCreateSchema = z.object({
  name: z.string({ error: 'Tag name must be at least 2 characters.' }).trim().min(2, 'Tag name must be at least 2 characters.'),
});

/** POST /catalog/custom-fields (an unknown `type` still defaults to 'text' in the handler). */
export const customFieldCreateSchema = z.object({
  name: z.string({ error: 'Field name must be at least 2 characters.' }).trim().min(2, 'Field name must be at least 2 characters.'),
});

/** POST /reorder-rules/suggestions/:itemId/accept (window/lead/service inputs keep their handler defaults). */
export const reorderSuggestionAcceptSchema = z.object({
  locationId: z.string({ error: 'locationId is required.' }).min(1, 'locationId is required.'),
});

/**
 * PUT /reorder-rules/:itemId. minQty/targetQty stay with
 * validateReorderQuantities: whether fractions are allowed depends on
 * the item's decimal flag, which a schema cannot know.
 */
export const reorderRuleSchema = z.object({
  locationId: z.string({ error: 'Location, non-negative minimum and target not below minimum are required.' }).min(1, 'Location, non-negative minimum and target not below minimum are required.'),
  orderMultiple: z
    .union([z.null(), z.coerce.number({ error: 'orderMultiple must be a positive number.' }).positive('orderMultiple must be a positive number.')])
    .optional(),
});

/** POST /purchase-orders */
export const purchaseOrderCreateSchema = z.object({
  supplierId: z.unknown().refine(Boolean, { message: 'Supplier, destination and at least one line are required.' }),
  locationId: z.unknown().refine(Boolean, { message: 'Supplier, destination and at least one line are required.' }),
  lines: z
    .array(
      z.object({
        itemId: z.string({ error: 'Every line requires an item and positive quantity.' }).min(1, 'Every line requires an item and positive quantity.'),
        quantity: z.coerce.number({ error: 'Every line requires an item and positive quantity.' }).positive('Every line requires an item and positive quantity.'),
        unitCost: z.coerce.number().optional(),
      }),
    )
    .min(1, 'Supplier, destination and at least one line are required.'),
  // An invalid expectedAt used to reach Prisma as an Invalid Date (500); it is a 400 now.
  expectedAt: validDate('expectedAt must be a valid date.'),
});

const poReceiptLineSchema = z.object({
  receivedQty: z.coerce.number().optional(),
  damagedQty: z.coerce.number().optional(),
  excessQty: z.coerce.number().optional(),
});

/**
 * POST /purchase-orders/:id/receive. `lines` is preprocessed, not
 * rejected, when it is not an array: the handler then plans an empty
 * receipt and planPoReceipt rejects it, exactly as before. lotNo /
 * expiryDate / qcInspections stay with planPoReceipt and the QC gate.
 */
export const poReceiveSchema = z.object({
  requestId: z.string({ error: 'A valid requestId is required for retry-safe receiving.' }).trim().min(1, 'A valid requestId is required for retry-safe receiving.').max(191, 'A valid requestId is required for retry-safe receiving.'),
  lines: z.preprocess(
    (value) => (Array.isArray(value) ? value : undefined),
    z.array(poReceiptLineSchema).min(1, 'At least one receipt line is required.').optional(),
  ),
});

/** PATCH /purchase-orders/:id/status */
export const purchaseOrderStatusSchema = z.object({
  // PO_STATUSES is typed as a plain readonly array; z.enum needs a tuple.
  status: z.enum(PO_STATUSES as unknown as [PoStatus, ...PoStatus[]], { error: 'Invalid purchase order status.' }),
});

/** POST /purchase-orders/plan/draft (per-group supplier/lines checks stay in the handler loop). */
export const poPlanDraftSchema = z.object({
  locationId: z.string({ error: 'A location and at least one supplier group are required.' }).min(1, 'A location and at least one supplier group are required.'),
  groups: z
    .array(z.object({ supplierId: z.unknown().optional(), lines: z.unknown().optional() }).passthrough())
    .min(1, 'A location and at least one supplier group are required.'),
});

/** POST /purchase-orders/:id/invoices (same filter transform as POST /orders). */
export const poInvoiceSchema = z
  .object({
    invoiceNumber: z.string({ error: 'Invoice number and at least one line are required.' }).trim().min(1, 'Invoice number and at least one line are required.'),
    lines: z
      .array(z.object({ itemId: z.unknown(), invoicedQty: z.unknown(), unitCost: z.unknown().optional() }).passthrough())
      .transform((rows) =>
        rows
          .map((line) => ({ itemId: String(line.itemId || ''), invoicedQty: Number(line.invoicedQty), unitCost: Number(line.unitCost) }))
          .filter((line) => line.itemId && Number.isFinite(line.invoicedQty) && line.invoicedQty > 0),
      ),
    invoiceDate: validDate('Invoice date is invalid.'),
  })
  .refine((data) => data.lines.length > 0, {
    message: 'Every line requires an item and a positive invoiced quantity.',
    path: ['lines'],
  });

/** POST /items/:itemId/prices (guardrail values stay with validatePrice). */
export const priceCreateSchema = z.object({
  priceType: z.string({ error: 'A price type and a positive price are required.' }).trim().min(1, 'A price type and a positive price are required.'),
  price: z.coerce.number({ error: 'A price type and a positive price are required.' }).positive('A price type and a positive price are required.'),
});

/**
 * PUT /suppliers/:id/price-breaks/:itemId. A non-array `breaks` used to
 * mean "clear the ladder", so it is preprocessed to [] rather than
 * rejected; the distinct-quantities and falling-costs rules are the
 * handler's, as refines, in the same order.
 */
export const priceBreaksSchema = z.object({
  breaks: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z
      .array(
        z.object({
          minQty: z.coerce.number({ error: 'Every break needs a positive quantity and unit cost.' }).positive('Every break needs a positive quantity and unit cost.'),
          unitCost: z.coerce.number({ error: 'Every break needs a positive quantity and unit cost.' }).positive('Every break needs a positive quantity and unit cost.'),
        }),
      )
      .refine(
        (tiers) => new Set([...tiers].sort((a, b) => a.minQty - b.minQty).map((tier) => tier.minQty)).size === tiers.length,
        { message: 'Break quantities must be distinct.' },
      )
      .refine(
        (tiers) => {
          const ordered = [...tiers].sort((a, b) => a.minQty - b.minQty);
          return !ordered.some((tier, index) => index > 0 && tier.unitCost >= ordered[index - 1].unitCost);
        },
        { message: 'A larger quantity must have a lower unit cost.' },
      ),
  ),
});

/** POST /saved-reports */
export const savedReportSchema = z.object({
  name: z.string({ error: 'Report name and a supported report type are required.' }).trim().min(2, 'Report name and a supported report type are required.'),
  reportType: z.enum(REPORT_TYPES, { error: 'Report name and a supported report type are required.' }),
});

/** POST /saved-views */
export const savedViewSchema = z.object({
  name: z.string({ error: 'A saved view name is required.' }).trim().min(2, 'A saved view name is required.'),
});
