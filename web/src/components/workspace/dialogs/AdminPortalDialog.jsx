import { useState } from 'react';
import { DEFAULT_WORKSPACE_PROFILE, ROLE_LABELS } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowDown, ArrowUp } from 'lucide-react';

export function AdminPortalDialog() {
  const {
    adminLoading, adminPortalOpen, adminTab, allUsers,
    companyForm, copyPermissionsFrom, createLocation, createUser, darkMode,
    deleteLocationById, deleteUserById, editLocationForm, editUserForm, moveLocation,
    editingLocationId, editingUserId, industryApplyPending, isMobile,
    locations, newLocationForm, newUserForm, openUserPermissions,
    permissionCatalog, permissionDraft, permissionScopeId, permissionUser,
    saveCompanyProfile, saveLocationEdit,
    saveUserEdit, saveUserPermissions, session, setAdminPortalOpen,
    setAdminTab, setCompanyForm, setDarkMode, setEditLocationForm,
    setEditUserForm, setEditingLocationId, setEditingUserId, setNewLocationForm,
    setNewUserForm, setPermissionDraft, setPermissionScopeId, setSidebarCompact,
    sidebarCompact, startEditLocation, startEditUser, toggleFormLocation,
    workspaceProfile,
  } = useWorkspace();
  const [copySourceId, setCopySourceId] = useState('');
  return (
    <>
      <Dialog open={adminPortalOpen} onOpenChange={setAdminPortalOpen}>
        <DialogContent className={isMobile ? 'inset-x-0 top-auto bottom-0 max-h-[94vh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none' : 'sm:max-w-3xl'}>
          <DialogHeader>
            <DialogTitle>Admin Portal</DialogTitle>
            <DialogDescription>Manage the company profile, branches, and user accounts.</DialogDescription>
          </DialogHeader>

          <Tabs value={adminTab} onValueChange={setAdminTab}>
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="company">Company</TabsTrigger>
              <TabsTrigger value="locations">Branches</TabsTrigger>
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="permissions" disabled={!permissionUser}>Permissions</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="company" className="grid gap-4 pt-2">
              <form onSubmit={saveCompanyProfile} className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Company Name *</Label>
                  <Input required value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Email</Label>
                    <Input type="email" value={companyForm.email} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Phone</Label>
                    <Input value={companyForm.phone} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Industry</Label>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                    <Badge variant="secondary">Grocery</Badge>
                    <p className="text-sm text-muted-foreground">Lot, expiry, FEFO and category/unit item master</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {workspaceProfile.pack?.description ?? DEFAULT_WORKSPACE_PROFILE.pack.description}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Address</Label>
                  <Textarea value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} />
                </div>
                <Button type="submit" className="justify-self-start" disabled={adminLoading || industryApplyPending}>
                  {adminLoading || industryApplyPending ? 'Saving…' : 'Save Company Profile'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="locations" className="grid gap-4 pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Order</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((location, index) => (
                    <TableRow key={location.id}>
                      <TableCell>
                        {/* Order here is the order of the location switcher, on web and mobile. */}
                        <div className="flex gap-1">
                          <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Move ${location.name} up`} title="Move up" onClick={() => moveLocation(location.id, -1)} disabled={adminLoading || index === 0}><ArrowUp className="size-4" /></Button>
                          <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Move ${location.name} down`} title="Move down" onClick={() => moveLocation(location.id, 1)} disabled={adminLoading || index === locations.length - 1}><ArrowDown className="size-4" /></Button>
                        </div>
                      </TableCell>
                      {editingLocationId === location.id ? (
                        <>
                          <TableCell>
                            <Input
                              value={editLocationForm.name}
                              onChange={(e) => setEditLocationForm({ ...editLocationForm, name: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Select value={editLocationForm.type} onValueChange={(value) => setEditLocationForm({ ...editLocationForm, type: value })}>
                              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="store">Store</SelectItem>
                                <SelectItem value="warehouse">Warehouse</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button type="button" size="sm" onClick={() => saveLocationEdit(location.id)} disabled={adminLoading}>Save</Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => setEditingLocationId(null)}>Cancel</Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="font-medium">{location.name}</TableCell>
                          <TableCell><Badge variant="secondary">{location.type}</Badge></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button type="button" size="sm" variant="outline" onClick={() => startEditLocation(location)}>Edit</Button>
                              <Button type="button" size="sm" variant="destructive" onClick={() => deleteLocationById(location.id)} disabled={adminLoading}>Delete</Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <form onSubmit={createLocation} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto]">
                <div className="grid gap-2">
                  <Label>New branch name</Label>
                  <Input required placeholder="e.g., South Store" value={newLocationForm.name} onChange={(e) => setNewLocationForm({ ...newLocationForm, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={newLocationForm.type} onValueChange={(value) => setNewLocationForm({ ...newLocationForm, type: value })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="store">Store</SelectItem>
                      <SelectItem value="warehouse">Warehouse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={adminLoading}>Add Branch</Button>
              </form>
            </TabsContent>

            <TabsContent value="users" className="grid gap-4 pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Assigned Branches</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allUsers.map((user) => (
                    <TableRow key={user.id}>
                      {editingUserId === user.id ? (
                        <>
                          <TableCell>
                            <Input value={editUserForm.name} onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })} />
                            <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
                            <Input
                              type="password"
                              placeholder="New password (optional)"
                              className="mt-1"
                              value={editUserForm.password}
                              onChange={(e) => setEditUserForm({ ...editUserForm, password: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Select value={editUserForm.role} onValueChange={(value) => setEditUserForm({ ...editUserForm, role: value })}>
                              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="grid gap-1">
                              {locations.map((location) => (
                                <label key={location.id} className="flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={editUserForm.assignedLocationIds.includes(location.id)}
                                    onCheckedChange={() => toggleFormLocation(editUserForm, setEditUserForm, location.id)}
                                  />
                                  {location.name}
                                </label>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button type="button" size="sm" onClick={() => saveUserEdit(user.id)} disabled={adminLoading}>Save</Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => setEditingUserId(null)}>Cancel</Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell>
                            <p className="font-medium">{user.name}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </TableCell>
                          <TableCell><Badge variant="secondary">{ROLE_LABELS[user.role] ?? user.role}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {(user.assignedLocationIds ?? [])
                              .map((id) => locations.find((location) => location.id === id)?.name ?? id)
                              .join(', ') || '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button type="button" size="sm" variant="outline" onClick={() => startEditUser(user)}>Edit</Button>
                              {user.role !== 'ADMIN' && <Button type="button" size="sm" variant="outline" onClick={() => openUserPermissions(user)} disabled={adminLoading}>Permissions</Button>}
                              <Button type="button" size="sm" variant="destructive" onClick={() => deleteUserById(user.id)} disabled={adminLoading || user.id === session?.user?.id}>Delete</Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <form onSubmit={createUser} className="grid gap-3 rounded-lg border p-3">
                <p className="text-sm font-medium">Add a new user</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Name</Label>
                    <Input required value={newUserForm.name} onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Email</Label>
                    <Input type="email" required value={newUserForm.email} onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Password</Label>
                    <Input type="password" required placeholder="Min 6 characters" value={newUserForm.password} onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Role</Label>
                    <Select value={newUserForm.role} onValueChange={(value) => setNewUserForm({ ...newUserForm, role: value })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Assigned Branches</Label>
                  <div className="flex flex-wrap gap-3">
                    {locations.map((location) => (
                      <label key={location.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={newUserForm.assignedLocationIds.includes(location.id)}
                          onCheckedChange={() => toggleFormLocation(newUserForm, setNewUserForm, location.id)}
                        />
                        {location.name}
                      </label>
                    ))}
                  </div>
                </div>
                <Button type="submit" className="justify-self-start" disabled={adminLoading}>
                  {adminLoading ? 'Creating…' : 'Add User'}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="permissions" className="grid gap-4 pt-2">
              {permissionUser ? (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div>
                      <p className="font-medium">{permissionUser.name}</p>
                      <p className="text-xs text-muted-foreground">{permissionUser.email} · {ROLE_LABELS[permissionUser.role] ?? permissionUser.role}</p>
                    </div>
                    <div className="grid min-w-52 gap-1">
                      <Label>Permission scope</Label>
                      <Select value={permissionScopeId} onValueChange={setPermissionScopeId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GLOBAL">All assigned branches</SelectItem>
                          {locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid min-w-52 gap-1">
                      <Label>Copy permissions from</Label>
                      <div className="flex gap-2">
                        <Select value={copySourceId} onValueChange={setCopySourceId}>
                          <SelectTrigger><SelectValue placeholder="Choose a user" /></SelectTrigger>
                          <SelectContent>
                            {(allUsers ?? []).filter((user) => user.id !== permissionUser.id && user.role !== 'ADMIN').map((user) => (
                              <SelectItem key={user.id} value={user.id}>{user.name} · {ROLE_LABELS[user.role] ?? user.role}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!copySourceId || adminLoading}
                          onClick={() => copyPermissionsFrom(copySourceId)}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Deny always wins over Allow. Default keeps the user's existing role access. Branch-specific rules override only that branch. "Copy permissions from" gives this user the exact same function-level access as another user in one click - e.g. a warehouse picker who should work like a specific store user - without their base role changing.</p>
                  <div className="max-h-[52vh] overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          <TableHead className="min-w-32">Module</TableHead>
                          {permissionCatalog.actions.map((action) => <TableHead key={action} className="min-w-28 text-center">{action}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {permissionCatalog.modules.map((module) => (
                          <TableRow key={module}>
                            <TableCell className="font-medium">{module}</TableCell>
                            {permissionCatalog.actions.map((action) => {
                              const key = `${permissionScopeId}:${module}:${action}`;
                              return <TableCell key={action} className="p-1">
                                <Select value={permissionDraft[key] ?? 'DEFAULT'} onValueChange={(value) => setPermissionDraft((current) => ({ ...current, [key]: value }))}>
                                  <SelectTrigger className="h-8 min-w-24"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="DEFAULT">Default</SelectItem>
                                    <SelectItem value="ALLOW">Allow</SelectItem>
                                    <SelectItem value="DENY">Deny</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>;
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setAdminTab('users')}>Back to users</Button>
                    <Button type="button" onClick={saveUserPermissions} disabled={adminLoading}>{adminLoading ? 'Saving…' : 'Save permissions'}</Button>
                  </div>
                </>
              ) : <p className="text-sm text-muted-foreground">Choose Permissions beside a user.</p>}
            </TabsContent>

            <TabsContent value="settings" className="grid gap-3 pt-2">
              <div className="flex items-center justify-between rounded-lg border p-4"><div><p className="text-sm font-medium">Appearance</p><p className="text-xs text-muted-foreground">Switch between light and dark workspace themes.</p></div><Button type="button" variant="outline" onClick={() => setDarkMode((value) => !value)}>{darkMode ? 'Use light theme' : 'Use dark theme'}</Button></div>
              <div className="flex items-center justify-between rounded-lg border p-4"><div><p className="text-sm font-medium">Sidebar density</p><p className="text-xs text-muted-foreground">Use compact navigation when more screen space is needed.</p></div><Button type="button" variant="outline" onClick={() => setSidebarCompact((value) => !value)}>{sidebarCompact ? 'Expand sidebar' : 'Compact sidebar'}</Button></div>
              <div className="flex items-center justify-between rounded-lg border p-4"><div><p className="text-sm font-medium">Operational alerts</p><p className="text-xs text-muted-foreground">Low stock, expiry, count and transfer alerts remain enabled.</p></div><Badge variant="success">Enabled</Badge></div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
