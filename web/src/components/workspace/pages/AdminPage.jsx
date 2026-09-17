import { useWorkspace } from '../WorkspaceContext';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, ChevronRight, Settings, Users, Warehouse } from 'lucide-react';

export function AdminPage() {
  const {
        openAdminPortal,
  } = useWorkspace();
  const adminCards = [
    { id: 'company', title: 'Company profile', description: 'Name, industry pack, contact and branding.', icon: Building2 },
    { id: 'locations', title: 'Branches', description: 'Stores and warehouses for this company.', icon: Warehouse },
    { id: 'users', title: 'Users & roles', description: 'Access, assignments and location scope.', icon: Users },
    { id: 'settings', title: 'Workspace settings', description: 'Company configuration and preferences.', icon: Settings },
  ];
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{adminCards.map(({ id, title, description, icon: Icon }) => <Card key={id} className="group overflow-hidden transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-within:ring-2 focus-within:ring-ring"><button type="button" className="w-full text-left" onClick={() => openAdminPortal(id)} aria-label={`Open ${title}`}><CardContent className="flex min-h-52 flex-col p-5"><div className="flex items-start justify-between"><Icon className="size-6 text-primary" /><ChevronRight className="size-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" /></div><h3 className="mt-7 font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p><span className="mt-auto pt-5 text-xs font-semibold text-primary">Open workspace</span></CardContent></button></Card>)}</div>;
}
