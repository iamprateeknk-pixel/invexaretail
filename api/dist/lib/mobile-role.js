"use strict";
// Blueprint §15 Mobile Excellence: each role gets a task-first home, not
// the same four generic tabs. Keep this as data so Flutter HomeShell and
// tests share one source of truth.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFLINE_ACTION_TYPES = void 0;
exports.mobileHomeForRole = mobileHomeForRole;
exports.offlineActionSpec = offlineActionSpec;
const ALL = {
    home: { id: 'home', label: 'Home', icon: 'dashboard' },
    stock: { id: 'stock', label: 'Stock', icon: 'inventory' },
    count: { id: 'count', label: 'Count', icon: 'fact_check' },
    transfers: { id: 'transfers', label: 'Transfers', icon: 'local_shipping' },
    receive: { id: 'receive', label: 'Receive', icon: 'move_to_inbox' },
    pick: { id: 'pick', label: 'Pick', icon: 'playlist_add_check' },
    putaway: { id: 'putaway', label: 'Putaway', icon: 'inventory_2' },
    scan: { id: 'scan', label: 'Scan', icon: 'qr_code_scanner' },
    orders: { id: 'orders', label: 'Orders', icon: 'shopping_bag' },
};
function mobileHomeForRole(role) {
    switch (role) {
        case 'WAREHOUSE_PICKER':
            return {
                title: 'Pick & putaway',
                subtitle: 'Scan-first warehouse work. Walk bins in order; wrong scans are blocked.',
                defaultDestination: 'pick',
                destinations: [ALL.home, ALL.pick, ALL.putaway, ALL.scan],
            };
        case 'STORE_USER':
            return {
                title: 'Store floor',
                subtitle: 'Blind counts and inbound receiving for your branch.',
                defaultDestination: 'count',
                destinations: [ALL.home, ALL.count, ALL.receive, ALL.stock],
            };
        case 'AUDITOR':
            return {
                title: 'Audit',
                subtitle: 'Review stock truth and count evidence. No warehouse execution.',
                defaultDestination: 'count',
                destinations: [ALL.home, ALL.stock, ALL.count],
            };
        case 'BRANCH_MANAGER':
            return {
                title: 'Branch operations',
                subtitle: 'Stock, counts and transfers for your locations.',
                defaultDestination: 'home',
                destinations: [ALL.home, ALL.stock, ALL.count, ALL.transfers],
            };
        case 'ADMIN':
        case 'ADMIN_USER':
            return {
                title: 'Control center',
                subtitle: 'Network stock, counts, transfers and channel orders.',
                defaultDestination: 'home',
                destinations: [ALL.home, ALL.stock, ALL.count, ALL.transfers, ALL.orders],
            };
        default:
            return {
                title: 'Invexa Retail',
                subtitle: 'Frontline operations',
                defaultDestination: 'home',
                destinations: [ALL.home, ALL.stock, ALL.count, ALL.transfers],
            };
    }
}
exports.OFFLINE_ACTION_TYPES = [
    'COUNT',
    'TRANSFER_REQUEST',
    'TRANSFER_RECEIVE',
    'PICK',
    'PUTAWAY',
    'EXCEPTION',
    'QC_INSPECTION',
];
function offlineActionSpec(type) {
    switch (type) {
        case 'COUNT':
            return { type, method: 'POST', endpoint: '/api/v1/stock-counts' };
        case 'TRANSFER_REQUEST':
            return { type, method: 'POST', endpoint: '/api/v1/transfers' };
        case 'TRANSFER_RECEIVE':
            return { type, method: 'POST', endpoint: '/api/v1/transfers/:transferId/receive' };
        case 'PICK':
            return { type, method: 'POST', endpoint: '/api/v1/picker/transfers/:transferId/pick-slips' };
        case 'PUTAWAY':
            return { type, method: 'POST', endpoint: '/api/v1/putaway-tasks/:id/confirm' };
        case 'EXCEPTION':
            return { type, method: 'POST', endpoint: '/api/v1/exceptions' };
        case 'QC_INSPECTION':
            return { type, method: 'POST', endpoint: '/api/v1/qc-inspections' };
        default: {
            const _never = type;
            return _never;
        }
    }
}
