import { expect, test } from '@playwright/test';
import { currentSection } from '../support.js';
import { apiContext, apiLogin, discoverFixtures, guardStaging, signInViaUi } from './staging-support.js';

// Golden journey 3 — transfer create → (pick) → confirm (audit R10).
//
// What this proves on staging today:
//  - an admin can create a one-unit transfer between two real locations
//    for a stocked lot (POST /api/v1/transfers -> 201), and the transfer
//    is immediately visible in GET /api/v1/transfers/list;
//  - the Transfers section of the real web app loads for the same user;
//  - IF the created transfer is already READY_FOR_ADMIN, confirm succeeds
//    (POST /api/v1/transfers/:id/confirm).
//
// Honest limit, by design: a freshly created transfer normally waits for
// warehouse picking (pick slips under /api/v1/picker/transfers/:id/…)
// before it can be confirmed. Driving the picker half needs a second
// staging user with the WAREHOUSE_PICKER role and an assignment fixture;
// until that fixture exists the confirm leg runs only when the status
// already allows it, and the test annotates the actual status instead of
// faking a pass. The created draft is deleted again at the end
// (DELETE works while the transfer is still in an editable status).

guardStaging(test);

test('create a transfer, see it in the list, confirm when ready, clean up', async ({ page }) => {
  const { token } = await apiLogin();
  const api = await apiContext(token);
  let transferId;
  try {
    const { locations, stocked } = await discoverFixtures(api);
    test.skip(!stocked, 'Staging has no stocked location — seed opening stock before running R10.');
    const destination = locations.find((location) => location.id !== stocked.location.id);
    test.skip(!destination, 'Staging needs a second location to receive a transfer.');

    const create = await api.post('/api/v1/transfers', {
      data: {
        sourceLocationId: stocked.location.id,
        destinationLocationId: destination.id,
        lines: [{ itemId: stocked.row.itemId, lotId: stocked.row.lotId, quantity: 1 }],
        notes: 'R10 staging golden journey — safe to delete',
      },
    });
    const createBody = await create.json().catch(() => ({}));
    expect(create.status(), `transfer create: ${JSON.stringify(createBody)}`).toBe(201);
    const transfer = createBody.transfer;
    expect(transfer?.id).toBeTruthy();
    transferId = transfer.id;

    const list = await (await api.get('/api/v1/transfers/list')).json();
    const found = (list.transfers ?? []).find((entry) => entry.id === transferId);
    expect(found, 'the new transfer appears in the list').toBeTruthy();
    test.info().annotations.push({ type: 'transfer-status', description: `created with status ${found.status}` });

    if (found.status === 'READY_FOR_ADMIN' || found.status === 'PARTIAL') {
      const confirm = await api.post(`/api/v1/transfers/${transferId}/confirm`, { data: {} });
      const confirmBody = await confirm.json().catch(() => ({}));
      expect(confirm.status(), `transfer confirm: ${JSON.stringify(confirmBody)}`).toBe(200);
      transferId = undefined; // confirmed transfers are no longer deletable drafts
    } else {
      test.info().annotations.push({
        type: 'confirm-deferred',
        description: `status ${found.status} needs the picker flow (pick slips) before confirm — see README`,
      });
    }
  } finally {
    if (transferId) {
      await api.delete(`/api/v1/transfers/${transferId}`).catch(() => {});
    }
    await api.dispose();
  }

  await signInViaUi(page);
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  await rail.getByRole('button', { name: 'Transfers' }).click();
  await expect.poll(() => currentSection(page)).toBe('transfers');
  await expect(rail.getByRole('button', { name: 'Transfers' })).toHaveAttribute('aria-current', 'page');
});
