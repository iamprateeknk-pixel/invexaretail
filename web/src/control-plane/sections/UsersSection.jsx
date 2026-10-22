import { controlRequest } from '../control-api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { labelOf, ROLE_OPTIONS } from '../studio-catalog';

export function UsersSection(props) {
  const { email, users, userEmail, setUserEmail, userName, setUserName, userRole, setUserRole, controlToken, refreshLocked } = props;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Company users</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Input placeholder="Name" value={userName} onChange={(event) => setUserName(event.target.value)} />
          <Input placeholder="Email" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} />
          <Select value={userRole} onValueChange={setUserRole}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['STORE_USER', 'WAREHOUSE_PICKER', 'BRANCH_MANAGER', 'AUDITOR', 'ADMIN'].map((role) => (
                <SelectItem key={role} value={role}>{labelOf(ROLE_OPTIONS, role)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={async () => {
            await controlRequest('/control/v1/users', { token: controlToken, method: 'POST', body: { name: userName, email: userEmail, role: userRole } });
            setUserEmail('');
            setUserName('');
            await refreshLocked();
            toast.success('User created');
          }}>Create user</Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{labelOf(ROLE_OPTIONS, user.role)}{user.isPrimaryAdmin ? ' · main admin' : ''}</TableCell>
                <TableCell>{user.status === 'active' ? 'Active' : 'Inactive'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
