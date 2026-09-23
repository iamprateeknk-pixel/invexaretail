import { useCallback, useRef, useState } from 'react'
import { useItemSearch } from '@/hooks/useItemSearch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/feedback-states'

// Week 10: global item search - server cursor pagination (useItemSearch),
// keyboard selection (arrow keys move a highlighted row, Enter selects
// it - the same pattern a combobox/listbox needs for the guide's
// "keyboard flow" verification), and the shared loading/empty/error states
// from Week 9 instead of a one-off spinner/message.
export function ItemSearchPanel({ authToken, onSelectItem }) {
  const { query, setQuery, items, loading, error, hasMore, loadMore, retry } = useItemSearch({ authToken });
  const [highlighted, setHighlighted] = useState(-1);
  const listRef = useRef(null);

  const selectIndex = useCallback((index) => {
    const item = items[index];
    if (item) onSelectItem?.(item);
  }, [items, onSelectItem]);

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((prev) => Math.min(prev + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted >= 0) selectIndex(highlighted);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="item-search-input" className="sr-only">Search items by name or code</label>
      <Input
        id="item-search-input"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls="item-search-results"
        aria-activedescendant={highlighted >= 0 ? `item-search-result-${highlighted}` : undefined}
        placeholder="Search items by name or code…"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setHighlighted(-1); }}
        onKeyDown={onKeyDown}
      />

      {loading && items.length === 0 && <LoadingState label="Searching items…" />}
      {error && <ErrorState description={error} onRetry={retry} />}
      {!loading && !error && items.length === 0 && query.trim() && (
        <EmptyState title="No items match your search" description={`Nothing found for "${query}".`} />
      )}

      {items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul id="item-search-results" role="listbox" ref={listRef} aria-label="Item search results" className="divide-y">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  id={`item-search-result-${index}`}
                  role="option"
                  aria-selected={index === highlighted}
                  tabIndex={-1}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm ${index === highlighted ? 'bg-accent text-accent-foreground' : ''}`}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => selectIndex(index)}
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground">{item.code}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {hasMore && (
        <Button type="button" variant="outline" onClick={loadMore} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
