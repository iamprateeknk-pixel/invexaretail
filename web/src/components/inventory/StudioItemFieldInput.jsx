import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function StudioItemFieldInput({ field, ...inputProps }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      {field.type === 'boolean' ? (
        <select id={id} required={field.required} {...inputProps}
          className="h-9 min-w-28 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-ring">
          <option value="">Choose an answer</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <Input id={id} type={field.type} required={field.required}
          step={field.type === 'number' ? 'any' : undefined} maxLength={field.type === 'text' ? 2000 : undefined}
          {...inputProps} />
      )}
    </div>
  );
}
