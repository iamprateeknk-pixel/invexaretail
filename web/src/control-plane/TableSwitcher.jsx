import { Button } from '@/components/ui/button';

export const TABLE_OPTIONS = [
  { value: 'stock', label: 'Items & stock table' },
  { value: 'lots', label: 'Lots & expiry table' },
];

/** Small tab-like switch between the tables a layout or formula applies to. */
export function TableSwitcher({ table, onChange, disabled = false }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which table">
      {TABLE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          role="tab"
          size="sm"
          aria-selected={table === option.value}
          variant={table === option.value ? 'default' : 'outline'}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
