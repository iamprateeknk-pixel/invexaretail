import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function FileDropZone({ accept = '.xlsx,.xls,.csv', file, onFile, disabled, label = 'Drop an Excel or CSV file, or browse' }) {
  const [over, setOver] = useState(false);

  function takeFile(nextFile) {
    if (!nextFile || disabled) return;
    onFile(nextFile);
  }

  return (
    <div
      className={cn(
        'grid gap-2 rounded-lg border border-dashed bg-muted/30 p-4 text-center transition-colors',
        over && 'border-primary bg-primary/5',
        disabled && 'pointer-events-none opacity-60',
      )}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        takeFile(event.dataTransfer.files?.[0]);
      }}
    >
      <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-background text-muted-foreground">
        <Upload className="size-4" />
      </div>
      <p className="text-sm font-medium">{file ? file.name : label}</p>
      <p className="text-xs text-muted-foreground">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB selected` : 'XLSX, XLS or CSV up to the server limit'}</p>
      <Input type="file" aria-label="Choose a spreadsheet or CSV file" accept={accept} disabled={disabled} onChange={(event) => takeFile(event.target.files?.[0] || null)} />
    </div>
  );
}
