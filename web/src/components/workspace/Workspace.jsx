import { useWorkspace } from './WorkspaceContext';
import { DashboardPage } from './pages/DashboardPage';
import { StockUpdatePage } from './pages/StockUpdatePage';
import { InventoryPage } from './pages/InventoryPage';
import { CatalogPage } from './pages/CatalogPage';
import { ExpiryPage } from './pages/ExpiryPage';
import { CountsPage } from './pages/CountsPage';
import { TransfersPage } from './pages/TransfersPage';
import { PickingPage } from './pages/PickingPage';
import { CommandCenterPage } from './pages/CommandCenterPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { PutawayPage } from './pages/PutawayPage';
import { QcPage } from './pages/QcPage';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { SaasPage } from './pages/SaasPage';
import { OrdersPage } from './pages/OrdersPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { AssetsPage } from './pages/AssetsPage';
import { JobsPage } from './pages/JobsPage';
import { ReportsPage } from './pages/ReportsPage';
import { IntelligencePage } from './pages/IntelligencePage';
import { ExceptionsPage } from './pages/ExceptionsPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { AlertsPage } from './pages/AlertsPage';
import { AdminPage } from './pages/AdminPage';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, ShieldCheck, Warehouse } from 'lucide-react';

const SECTION_ROLES = {
  admin: ['ADMIN', 'ADMIN_USER'],
  approvals: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'],
  reports: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'],
  picking: ['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'],
  putaway: ['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'],
  orders: ['ADMIN', 'ADMIN_USER'],
  qc: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'],
  connectors: ['ADMIN', 'ADMIN_USER'],
  saas: ['ADMIN'],
};

const SECTION_PAGES = {
  dashboard: DashboardPage,
  'stock-update': StockUpdatePage,
  inventory: InventoryPage,
  catalog: CatalogPage,
  expiry: ExpiryPage,
  counts: CountsPage,
  campaigns: CampaignsPage,
  approvals: CountsPage,
  'command-center': CommandCenterPage,
  transfers: TransfersPage,
  picking: PickingPage,
  putaway: PutawayPage,
  orders: OrdersPage,
  qc: QcPage,
  connectors: ConnectorsPage,
  saas: SaasPage,
  'purchase-orders': PurchaseOrdersPage,
  assets: AssetsPage,
  jobs: JobsPage,
  reports: ReportsPage,
  intelligence: IntelligencePage,
  exceptions: ExceptionsPage,
  integrations: IntegrationsPage,
  alerts: AlertsPage,
  admin: AdminPage,
};

function AccessRestricted({ navigateTo }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-72 flex-col items-center justify-center text-center">
        <ShieldCheck className="mb-4 size-10 text-muted-foreground" />
        <h2 className="font-semibold">Access restricted</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">Your role does not have permission to open this workspace.</p>
        <Button className="mt-5" onClick={() => navigateTo('dashboard')}>Return to dashboard</Button>
      </CardContent>
    </Card>
  );
}

function EmptyModule({ showToast }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Warehouse className="size-6" />
        </div>
        <h3 className="text-base font-semibold">Module ready for configuration</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">This workspace follows the shared Invexa navigation, permission and audit patterns.</p>
        <Button type="button" className="mt-5" onClick={() => showToast('Configure module workflow is ready for the next implementation phase.', 'info')}>
          Configure module<ArrowRight className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

export function Workspace() {
  const { activeSection, role, navigateTo, showToast } = useWorkspace();
  if (SECTION_ROLES[activeSection] && !SECTION_ROLES[activeSection].includes(role)) {
    return <AccessRestricted navigateTo={navigateTo} />;
  }
  const Page = SECTION_PAGES[activeSection];
  if (!Page) return <EmptyModule showToast={showToast} />;
  return <Page />;
}
