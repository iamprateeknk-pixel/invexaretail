import { useWorkspace } from './WorkspaceContext';
import { canAccessSection } from '../../lib/permissions';
import { DashboardPage } from './pages/DashboardPage';
import { StockUpdatePage } from './pages/StockUpdatePage';
import { InventoryPage } from './pages/InventoryPage';
import { ItemStockDetailPage } from './pages/ItemStockDetailPage';
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
import { ImportWizardPage } from './pages/ImportWizardPage';
import { InventoryHealthPage } from './pages/InventoryHealthPage';
import { EmptyState, PermissionDeniedState } from '@/components/ui/feedback-states';

const SECTION_PAGES = {
  dashboard: DashboardPage,
  'stock-update': StockUpdatePage,
  'import-wizard': ImportWizardPage,
  inventory: InventoryPage,
  'item-search': ItemStockDetailPage,
  'inventory-health': InventoryHealthPage,
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

export function Workspace() {
  const { activeSection, role, navigateTo, hiddenModules } = useWorkspace();
  if (!canAccessSection(activeSection, { role, hiddenModules })) {
    return <PermissionDeniedState onReturn={() => navigateTo('dashboard')} />;
  }
  const Page = SECTION_PAGES[activeSection];
  if (!Page) {
    return (
      <EmptyState
        title="Module ready for configuration"
        description="This workspace follows the shared Invexa navigation, permission and audit patterns."
      />
    );
  }
  return <Page />;
}
