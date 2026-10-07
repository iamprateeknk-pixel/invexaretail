import { lazy, Suspense } from 'react';
import { useWorkspace } from './WorkspaceContext';
import { canAccessSection } from '../../lib/permissions';
import { DashboardPage } from './pages/DashboardPage';
const StockUpdatePage = lazy(() => import('./pages/StockUpdatePage').then((module) => ({ default: module.StockUpdatePage })));
const InventoryPage = lazy(() => import('./pages/InventoryPage').then((module) => ({ default: module.InventoryPage })));
const ItemStockDetailPage = lazy(() => import('./pages/ItemStockDetailPage').then((module) => ({ default: module.ItemStockDetailPage })));
const CatalogPage = lazy(() => import('./pages/CatalogPage').then((module) => ({ default: module.CatalogPage })));
const ExpiryPage = lazy(() => import('./pages/ExpiryPage').then((module) => ({ default: module.ExpiryPage })));
const CountsPage = lazy(() => import('./pages/CountsPage').then((module) => ({ default: module.CountsPage })));
const TransfersPage = lazy(() => import('./pages/TransfersPage').then((module) => ({ default: module.TransfersPage })));
const PickingPage = lazy(() => import('./pages/PickingPage').then((module) => ({ default: module.PickingPage })));
const CommandCenterPage = lazy(() => import('./pages/CommandCenterPage').then((module) => ({ default: module.CommandCenterPage })));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage').then((module) => ({ default: module.CampaignsPage })));
const PutawayPage = lazy(() => import('./pages/PutawayPage').then((module) => ({ default: module.PutawayPage })));
const QcPage = lazy(() => import('./pages/QcPage').then((module) => ({ default: module.QcPage })));
const ConnectorsPage = lazy(() => import('./pages/ConnectorsPage').then((module) => ({ default: module.ConnectorsPage })));
const SaasPage = lazy(() => import('./pages/SaasPage').then((module) => ({ default: module.SaasPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((module) => ({ default: module.OrdersPage })));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage').then((module) => ({ default: module.PurchaseOrdersPage })));
const AssetsPage = lazy(() => import('./pages/AssetsPage').then((module) => ({ default: module.AssetsPage })));
const JobsPage = lazy(() => import('./pages/JobsPage').then((module) => ({ default: module.JobsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const IntelligencePage = lazy(() => import('./pages/IntelligencePage').then((module) => ({ default: module.IntelligencePage })));
const ExceptionsPage = lazy(() => import('./pages/ExceptionsPage').then((module) => ({ default: module.ExceptionsPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then((module) => ({ default: module.IntegrationsPage })));
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((module) => ({ default: module.AlertsPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const ImportWizardPage = lazy(() => import('./pages/ImportWizardPage').then((module) => ({ default: module.ImportWizardPage })));
const Entity360Page = lazy(() => import('./pages/Entity360Page').then((module) => ({ default: module.Entity360Page })));
const InventoryHealthPage = lazy(() => import('./pages/InventoryHealthPage').then((module) => ({ default: module.InventoryHealthPage })));
import { EmptyState, LoadingState, PermissionDeniedState } from '@/components/ui/feedback-states';

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
  entity: Entity360Page,
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
  // Every page except the dashboard is its own chunk, fetched when first opened.
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <Page />
    </Suspense>
  );
}
