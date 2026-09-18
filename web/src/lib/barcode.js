const CODE39_PATTERNS = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
  S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

export function matchScannedInventory(items, rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) return { code: '', matches: [] };
  const matches = (items ?? []).flatMap((item) => {
    const matchedLot = item.lots?.find((lot) => String(lot.lotNo).toUpperCase() === code) ?? null;
    const itemMatch = [item.id, item.code, item.barcode].some((value) => String(value ?? '').toUpperCase() === code);
    return itemMatch || matchedLot ? [{ item, matchedLot }] : [];
  });
  return { code, matches };
}

export function code39Svg(value) {
  const safe = String(value ?? '').toUpperCase().replace(/[^0-9A-Z. -]/g, '-');
  let x = 8;
  const bars = [];
  for (const character of `*${safe}*`) {
    const pattern = CODE39_PATTERNS[character] ?? CODE39_PATTERNS['-'];
    [...pattern].forEach((widthCode, index) => {
      const width = widthCode === 'w' ? 3 : 1;
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="4" width="${width}" height="52" fill="#020617"/>`);
      x += width;
    });
    x += 1;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 8} 60" role="img" aria-label="Barcode ${safe}">${bars.join('')}</svg>`;
}
