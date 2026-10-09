# Transfer picker assignment and transfer notifications

## The flow

1. A transfer is created (admin, branch manager or store user). It enters the pick queue as `REQUESTED`.
2. An admin or the source branch manager may **assign a named picker** (Transfers page, "Assign picker").
   Only active `WAREHOUSE_PICKER` users of the same company who work the source location qualify.
   The picker gets an inbox notification (`transfer.pick_assigned`).
3. The picker picks (`PICKING` / `PARTIAL`), then finishes (`READY_FOR_ADMIN`).
4. An admin reviews and confirms (`CONFIRMED`). Source stock is deducted here.
5. Pack and dispatch (`DISPATCHED`). Every active store user and branch manager of the
   destination location gets an inbox notification (`transfer.dispatched`) with the carrier,
   vehicle, AWB and ETA when given.
6. The destination store user receives. They enter good, damaged, short and excess quantities
   and remarks per line (`RECEIVED` / `PARTIAL_RECEIVED`).
7. An admin closes the transfer (`CLOSED`).

## Assignment rules

- `Transfer.assignedPickerId` is nullable (migration `20261210090000_transfer_assigned_picker`,
  additive). Null keeps the old behaviour: any picker at the source location may pick.
- Once a picker is assigned, every other picker loses the transfer from `GET /picker-tasks` and
  `GET /transfers/list`. They also get `403` from the picker detail, allocation preview,
  pick-slip and status routes.
- Admins and branch managers can still open the transfer; the restriction applies to pickers only.
- A picker can be (re)assigned or unassigned (`pickerId: null`) while the transfer is `DRAFT`,
  `SUBMITTED`, `REQUESTED`, `PENDING_PICK`, `PICKING` or `PARTIAL`. After that it returns `409`.
- A picker of another company gets the same `400` as a user id that does not exist, so the
  response never confirms that the user exists.

## Endpoints

- `GET /transfers/:transferId/eligible-pickers`: `{ assignedPickerId, pickers: [{ id, name, email }] }`.
- `PATCH /transfers/:transferId/picker` with body `{ pickerId: string | null }`.

Both are in `api/contracts/openapi.json` (2026.43.0).

## Notifications

Notifications are written to `UserNotification`, the inbox the web bell already reads
(`GET /notification-inbox`). A failed notification is logged and never fails the dispatch or the
assignment that triggered it. Memory mode has no inbox table, so notifications there go to an
in-process list (`memoryNotifications`) for tests.

## Contract repair in the same change

Merge `623d619` had interleaved the `/items/version` block with `/imports/sales/template`, which
left `api/contracts/openapi.json` as invalid JSON on `main`. The spec was rebuilt from the union of
that merge's two parents (no path was changed on both sides), and `contracts/generated/types.ts`
was regenerated.

## Tests

- `api/src/routes/transfer-picker-assignment.http.test.ts`: memory mode, end to end.
- `api/src/lib/transfer-assignment.postgres.test.ts`: real Postgres. Covers the column write and
  clear, a cross-company write being refused, and both notifications landing under the right company.
- `web/src/components/transfers/AssignPickerDialog.test.jsx`, plus additions to
  `web/src/lib/transfer-lifecycle.test.js` and `web/src/lib/workspace-queues.test.js`.
