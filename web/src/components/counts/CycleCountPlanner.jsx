import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ABC_CADENCE,
  ABC_CLASSES,
  abcBadgeVariant,
  displayAbcCadence,
  displayAbcClass,
  formatCycleCountValue,
  toggleAbcClass,
} from '../../lib/abc-cycle-count';

export function CycleCountPlanner({
  plan,
  locationName,
  storeUsers,
  storeUserId,
  setStoreUserId,
  selectedClasses,
  setSelectedClasses,
  submitLoading,
  onAssign,
  formatDateTime,
}) {
  const summary = plan?.summary ?? { A: { count: 0, eligible: 0 }, B: { count: 0, eligible: 0 }, C: { count: 0, eligible: 0 } };
  const items = plan?.items ?? [];
  const eligibleSelected = items.filter((item) => item.eligible && selectedClasses.includes(item.abcClass)).length;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">ABC cycle-count planner</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Pareto ranking of on-hand value at {locationName}. Class A is counted weekly, B monthly, and C quarterly. Items already assigned are skipped.
            </p>
          </div>
          <Badge variant="secondary">{eligibleSelected} eligible</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {ABC_CLASSES.map((abcClass) => (
            <div key={abcClass} className="rounded-lg border bg-muted/25 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={abcBadgeVariant(abcClass)}>{displayAbcClass(abcClass)}</Badge>
                <span className="text-xs text-muted-foreground">{displayAbcCadence(abcClass)}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{summary[abcClass]?.count ?? 0}</p>
              <p className="text-xs text-muted-foreground">{summary[abcClass]?.eligible ?? 0} ready · {ABC_CADENCE[abcClass].dueInDays}d · {ABC_CADENCE[abcClass].priority === 'HIGH' ? 'Urgent' : ABC_CADENCE[abcClass].priority === 'LOW' ? 'Low' : 'Normal'}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-52 gap-2">
            <Label>Store user</Label>
            <Select value={storeUserId} onValueChange={setStoreUserId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a store user" /></SelectTrigger>
              <SelectContent>
                {storeUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name} ({user.email})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Classes to assign</Label>
            <div className="flex flex-wrap gap-3 pt-1">
              {ABC_CLASSES.map((abcClass) => (
                <label key={abcClass} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedClasses.includes(abcClass)}
                    onCheckedChange={() => setSelectedClasses(toggleAbcClass(selectedClasses, abcClass))}
                  />
                  {abcClass}
                </label>
              ))}
            </div>
          </div>
          <Button onClick={onAssign} disabled={submitLoading || !storeUserId || eligibleSelected === 0}>
            {submitLoading ? 'Assigning...' : `Assign ${selectedClasses.join(', ')}`}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>On hand</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length ? items.map((item) => (
              <TableRow key={item.itemId}>
                <TableCell>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.code}</p>
                </TableCell>
                <TableCell><Badge variant={abcBadgeVariant(item.abcClass)}>{item.abcClass}</Badge></TableCell>
                <TableCell>{item.onHand}</TableCell>
                <TableCell>{formatCycleCountValue(item.extendedValue, item.valueSource)}</TableCell>
                <TableCell>{formatDateTime(item.dueDate)}</TableCell>
                <TableCell><Badge variant={item.priority === 'HIGH' ? 'destructive' : 'outline'}>{item.priority === 'HIGH' ? 'Urgent' : item.priority === 'LOW' ? 'Low' : 'Normal'}</Badge></TableCell>
                <TableCell className="text-right">
                  <Badge variant={item.assigned ? 'secondary' : 'outline'}>{item.assigned ? 'Assigned' : 'Ready'}</Badge>
                </TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No on-hand items to classify at this location.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
