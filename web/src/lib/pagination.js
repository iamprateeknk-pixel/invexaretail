export function normalizePageSize(value, fallback = 25) {
  const size = Number(value);
  return Number.isInteger(size) && size > 0 && size <= 100 ? size : fallback;
}

export function paginateRows(rows, requestedPage = 1, requestedPageSize = 25) {
  const source = Array.isArray(rows) ? rows : [];
  const pageSize = normalizePageSize(requestedPageSize);
  const pageCount = Math.max(1, Math.ceil(source.length / pageSize));
  const page = Math.min(Math.max(1, Number(requestedPage) || 1), pageCount);
  const startIndex = (page - 1) * pageSize;
  return {
    rows: source.slice(startIndex, startIndex + pageSize),
    page,
    pageSize,
    pageCount,
    total: source.length,
    from: source.length ? startIndex + 1 : 0,
    to: Math.min(startIndex + pageSize, source.length),
  };
}
