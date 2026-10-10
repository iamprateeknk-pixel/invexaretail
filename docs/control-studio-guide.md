# Control Plane Studio - admin guide

For the person who sets up a company at `control.invexaretail.com`. No coding needed. Everything below is
per company: lock one company first (Company list -> **Lock session**), then open **Studio**.

Changes to table layouts and formulas go to a **draft**. Nothing changes for your team until you open
**Publish** and publish. Import columns are different: they apply as soon as you press **Save columns**.

## 1. Excel import columns (Studio -> Import columns)

Pick the import: **Stock / opening stock**, **Daily sales** or **Daily purchase**.

| You want to | Do this |
|---|---|
| Change the column order of the Excel file | Use the up / down arrows. The grey box on top shows the order your file will have. |
| Use your own header names | Type the new name in the box. Old standard names still work. |
| Accept other names a supplier file uses | Fill "Other header names" (comma separated). |
| Make a column compulsory | Tick **Required**. A file without it is rejected with the column name; a blank cell rejects only that row. |
| Fill an empty cell automatically | Type a **Default when empty**. |
| Ignore a column | Untick **Use**. |
| Work a number out instead of reading it (stock import) | Open **Calculate from other columns** under a number column, click the columns and `+ - * /` to build e.g. Cartons × Pack Qty. The value is calculated for every row; the column need not be in the file. A row with an empty input is rejected on its own. |
| Add your own column (stock import only) | **Add column**, choose Text / Number / Date. Values are saved on each item (matched by item code) when the import is confirmed. |

Always on (greyed out): item name for stock; bill no., bill date, item name, quantity (and branch for sales).
**Download template** on the import screens gives a file in exactly your layout. **Back to standard** restores the default.

Rate, Amount, Sales Return Qty and Purchase/Sale value start switched off; tick **Use** if your file has them.

## 2. Table columns (Studio -> Stock columns)

Choose the table: **Items & stock**, **Lots & expiry** or **Item detail: lots**.

- Arrows move a column, the name box renames it, **Shown / Hidden** hides it.
- **Who sees it** (under each column) limits it to chosen roles. Admin always sees every column.
- Item name / lot number and the Open / Print button cannot be hidden or restricted.
- **Show an item field as a column** adds a custom item field (Shelf Rack, MRP...) as a column.
- Press **Save to draft**, then publish.

## 3. Formulas (Studio -> Formulas)

Make a column that is calculated for every row, or change how **Available** is worked out.
Nothing here changes real stock numbers.

1. Choose the table, press **New calculated column** (or a ready-made recipe).
2. Name it, click fields and operators to build the formula, or type it.
3. The box under the formula shows the result for sample numbers, or says in plain words what is wrong.
4. **Save to draft**, then publish.

Fields: **Items & stock** - physical, book, variance, quarantine, reserved, value.
**Lots** - quantity, days_to_expiry, purchase_value, sale_value.
**Item detail lots** - days_to_expiry, purchase_value, sale_value.

Operators `+ - * / %`, brackets, comparisons `< > <= >= = !=`, and `MAX(a,b)`, `MIN(a,b)`, `ROUND(x,2)`,
`ABS(x)`, `FLOOR(x)`, `CEIL(x)`, `IF(test, then, else)`.

Examples: `max(0, physical - reserved - quarantine)`, `if(book = 0, 0, round(variance / book * 100, 1))`,
`round(days_to_expiry / 7, 1)`, `sale_value - purchase_value`.

A cell shows "-" when the formula cannot be worked out for that row (divide by zero, or a lot with no expiry date).
A formula that reads book / variance / reserved / quarantine / value is hidden from people who cannot see system stock.

## 4. Simple and Advanced (every screen)

The **Simple / Advanced** switch at the top of the Control Plane applies to every screen and is remembered on
your computer. **Simple** shows only plain choices (names, drop-downs, ticks) and a one-line summary of what
each entry does. **Advanced** also shows the technical bits: keys, raw column/scope lists, the rule's stored
condition, workflow version, the sample sync test and "Go back to version 1".

Every Studio list (Extra fields, Rules, Reports, Automations, Mobile app, and Approvals in the left menu) works
the same way as Import columns: edit in place, **Add**, the bin icon to remove, then **Save changes** (or
**Discard**). Saved changes go to the draft; **Publish** makes them live.

| Screen | What you set | Used by the app today? |
|---|---|---|
| Extra fields | Field name, what it is for (item, transfer, ...), kind of value, must be filled | Not yet - stored and published only |
| Rules | When *this* is more/less than *that* (several conditions = all must be true), then *do this*. **Try your rules** checks a made-up case. | Not yet - only the Try box runs them |
| Reports | Name, what it is about, which columns | Not yet |
| Automations | When something happens / on a schedule, then do something | Not yet |
| Mobile app | Per role: screens, what is kept offline, how long it may stay offline | Not yet - the phone app shows its standard screens |
| Approvals | For transfers / adjustments / ...: approve automatically up to Rs X, above that a branch manager or admin. **Try an amount** checks it. | Not yet - live approvals use the main app's approval rules |

Each of these screens shows a yellow note while the app does not act on it yet, so nobody expects an effect.

## 5. Going live and undoing

**Publish** tab: **See what this role gets**, then **Publish**. **Go back to version 1** (Advanced) returns to the first version.
Layouts are versioned together, so rollback restores columns and formulas of all three tables.

## For developers

- Engine: `api/src/lib/formula.ts`; `web/src/lib/formula.js` is generated from it
  (`node api/scripts/sync-formula-to-web.mjs`, checked by a test).
- Import profiles: `api/src/lib/import-profile.ts`; custom column values: `api/src/lib/import-custom-values.ts`.
- Table layouts live in the config version page (`page.columns`, `page.tables.{lots,itemLots}`),
  edited through `ControlPlane.setStockColumnLayout / setStockFormulaColumn / addItemFieldColumn`.
- Web: `web/src/control-plane/*` (editors), `web/src/lib/{stock,lots,item-lot}-table.js` (rendering).
- Simple / Advanced: `web/src/control-plane/studio-mode.jsx` (`StudioModeProvider`, `Advanced`, the shared
  `StudioListEditor`); plain-language catalogues and converters (rule rows <-> condition object, approval model
  <-> workflow graph): `studio-catalog.js`. New Studio lists should reuse `StudioListEditor` rather than a new form.
- Removing a draft entry: `DELETE /studio/v1/{fields|rules|reports|automations|workflows|mobile-policy}/:key`
  (`ControlPlane.removeDraftEntry`; a field's key is `entityType:fieldKey`). `POST /studio/v1/fields` with
  `replace: true` edits a field in place.
