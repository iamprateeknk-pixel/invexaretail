#!/usr/bin/env node
// Gives every stock balance that has no movement history one opening-balance journal row, so the
// movement journal explains the balance (see src/lib/opening-journal-backfill.ts for the rules).
// Dry run by default; nothing is written without --apply. Run `npm run build` first.
//
//   DATABASE_URL=postgresql://... node scripts/backfill-opening-journal.cjs                 # report only
//   DATABASE_URL=postgresql://... node scripts/backfill-opening-journal.cjs --apply         # write
//   DATABASE_URL=postgresql://... node scripts/backfill-opening-journal.cjs --company <id>  # one company
//
// Run POST /ops/reconciliation/run afterwards: NO_JOURNAL_HISTORY should be 0.
const args = process.argv.slice(2);
const companyIndex = args.indexOf('--company');
const companyId = companyIndex >= 0 ? args[companyIndex + 1] : undefined;
const apply = args.includes('--apply');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  const { backfillOpeningJournal } = require('../dist/lib/opening-journal-backfill.js');
  const result = await backfillOpeningJournal({ companyId, apply });
  console.log(apply
    ? `Opening journal rows added: ${result.inserted} of ${result.candidates} balance(s) that had no history.`
    : `Dry run: ${result.candidates} balance(s) have no movement history and would get one opening row. Re-run with --apply to write them.`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
