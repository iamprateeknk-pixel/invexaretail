// Blueprint v4 §16/§17 on the web: pure helpers behind the Pack & dispatch dialog.

const round3 = (value) => Math.round(value * 1000) / 1000;

/** What is still to be packed per expected line, given the sealed cartons. */
export function remainingLines(state) {
  const packed = new Map();
  for (const carton of state?.cartons ?? []) {
    if (carton.status !== 'SEALED') continue;
    for (const line of carton.lines ?? []) {
      const key = `${line.itemId}|${line.lotId}`;
      packed.set(key, round3((packed.get(key) ?? 0) + line.quantity));
    }
  }
  return (state?.expected ?? []).map((line) => {
    const key = `${line.itemId}|${line.lotId}`;
    return { itemId: line.itemId, lotId: line.lotId, expected: line.requestedQty, packed: packed.get(key) ?? 0, remaining: round3(Math.max(0, line.requestedQty - (packed.get(key) ?? 0))) };
  });
}

/** A new carton's request body from the quantities typed per line; blank and zero lines are left out. */
export function cartonPayload(lines, quantities, weightKg, requestId) {
  const body = { requestId, lines: [] };
  for (const line of lines) {
    const raw = quantities[`${line.itemId}|${line.lotId}`];
    if (raw === undefined || raw === '') continue;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Enter a valid quantity for every line.');
    if (quantity > line.remaining + 1e-8) throw new Error('A carton cannot hold more than is left to pack.');
    if (quantity > 0) body.lines.push({ itemId: line.itemId, lotId: line.lotId, quantity: round3(quantity) });
  }
  if (!body.lines.length) throw new Error('Put at least one item in the carton.');
  if (weightKg !== undefined && weightKg !== '') {
    const weight = Number(weightKg);
    if (!Number.isFinite(weight) || weight <= 0) throw new Error('Carton weight must be a positive number.');
    body.weightKg = weight;
  }
  return body;
}

/** The dispatch request body; at least a carrier, vehicle or AWB is needed. */
export function dispatchPayload(form) {
  const body = {};
  for (const key of ['carrier', 'awb', 'vehicleNo']) {
    const value = String(form?.[key] ?? '').trim();
    if (value) body[key] = value;
  }
  if (!Object.keys(body).length) throw new Error('Enter the vehicle number, courier or AWB before dispatching.');
  if (form?.expectedArrivalAt) {
    const parsed = new Date(form.expectedArrivalAt);
    if (Number.isNaN(parsed.getTime())) throw new Error('Expected arrival must be a valid date and time.');
    body.expectedArrivalAt = parsed.toISOString();
  }
  return body;
}

/** One line of text for the queue: how far along packing/dispatch is. */
export function logisticsLabel(transfer) {
  if (transfer.delayed) return 'Delayed';
  if (transfer.dispatch) return 'Dispatched';
  if (transfer.packing) return 'Packed';
  if ((transfer.cartons ?? []).length) return 'Packing';
  return '';
}
