"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// Enterprise analytics and dashboard routes
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const access_control_js_1 = require("../lib/access-control.js");
const repo = __importStar(require("../lib/enterprise-repository.js"));
const router = (0, express_1.Router)();
// Apply middleware to all routes
router.use(enterprise_auth_js_1.extractToken);
router.use(enterprise_auth_js_1.requireAuth);
router.use(access_control_js_1.enforcePermissionOverrides);
// ============================================
// DASHBOARD SUMMARY (KEY METRICS ONLY)
// ============================================
router.get('/companies/:companyId/dashboard/summary', (req, res) => {
    try {
        const { companyId, branchId } = req.query;
        if (req.companyId !== companyId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        // Filter by branch if provided
        let counts = repo.listCountsByBranch(companyId);
        let transfers = repo.listTransfersByBranch(branchId || '');
        if (branchId) {
            counts = counts.filter((c) => c.branchId === branchId);
        }
        // Calculate metrics
        const totalItems = repo.listItems().filter((i) => i.companyId === companyId).length;
        const pendingCounts = counts.filter((c) => c.status === 'ASSIGNED').length;
        const pendingReview = counts.filter((c) => c.status === 'SUBMITTED' || c.status === 'PENDING_REVIEW').length;
        const inTransitTransfers = transfers.filter((t) => ['PICKING', 'PICKED', 'IN_TRANSIT', 'DISPATCHED'].includes(t.status)).length;
        // Calculate variance stats
        const approvedCounts = counts.filter((c) => c.status === 'APPROVED');
        const avgVariance = approvedCounts.length > 0
            ? (approvedCounts.reduce((sum, c) => sum + (c.variancePercentage || 0), 0) / approvedCounts.length).toFixed(2)
            : '0';
        const overageCounts = approvedCounts.filter((c) => (c.variance ?? 0) > 0).length;
        const shortageCounts = approvedCounts.filter((c) => (c.variance ?? 0) < 0).length;
        res.json({
            success: true,
            summary: {
                totalItems,
                pendingTasksCount: pendingCounts,
                todayTasksCount: pendingCounts, // Tasks assigned today
                inTransitTransfersCount: inTransitTransfers,
                stockVariancePercentage: parseFloat(avgVariance),
                overageCount: overageCounts,
                shortageCount: shortageCounts,
                pendingReviewCount: pendingReview,
                approvedCountsCount: approvedCounts.length,
                totalCountsSubmitted: counts.filter((c) => c.status !== 'ASSIGNED').length,
            },
            branches: branchId ? undefined : repo.listBranchesByCompany(companyId).map((b) => ({
                id: b.id,
                name: b.name,
                type: b.type,
            })),
        });
    }
    catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
});
// ============================================
// PENDING TASKS (ASSIGNED COUNTS)
// ============================================
router.get('/companies/:companyId/analytics/pending-tasks', (req, res) => {
    try {
        const { companyId, branchId } = req.query;
        if (req.companyId !== companyId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        let counts = repo.listCountsByBranch(companyId, 'ASSIGNED');
        if (branchId) {
            counts = counts.filter((c) => c.branchId === branchId);
        }
        const items = repo.listItems();
        const itemMap = new Map(items.map((i) => [i.id, i]));
        const locationMap = new Map(repo.locations.map((l) => [l.id, l]));
        const pendingTasks = counts
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((c) => ({
            id: c.id,
            itemId: c.itemId,
            itemName: itemMap.get(c.itemId)?.name || 'Unknown',
            lotId: c.lotId,
            locationId: c.locationId,
            locationName: locationMap.get(c.locationId)?.name || 'Unknown',
            assignedBy: c.assignedBy || 'Unknown',
            assignedByName: c.assignedBy ? repo.findUserById(c.assignedBy)?.name || 'Unknown' : 'Unknown',
            assignedAt: c.assignedAt,
            dueDate: c.dueDate,
            status: c.status,
            mode: c.mode,
            createdAt: c.createdAt,
            daysOverdue: c.dueDate ? Math.max(0, Math.floor((Date.now() - new Date(c.dueDate).getTime()) / (1000 * 60 * 60 * 24))) : 0,
        }));
        res.json({
            success: true,
            pendingTasks,
            totalPending: pendingTasks.length,
            overdueTasks: pendingTasks.filter((t) => t.daysOverdue > 0).length,
        });
    }
    catch (error) {
        console.error('Pending tasks error:', error);
        res.status(500).json({ error: 'Failed to fetch pending tasks' });
    }
});
// ============================================
// TODAY'S TASKS (ASSIGNED TODAY)
// ============================================
router.get('/companies/:companyId/analytics/today-tasks', (req, res) => {
    try {
        const { companyId, branchId } = req.query;
        if (req.companyId !== companyId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let counts = repo.listCountsByBranch(companyId).filter((c) => c.assignedAt && new Date(c.assignedAt) >= today && c.status === 'ASSIGNED');
        if (branchId) {
            counts = counts.filter((c) => c.branchId === branchId);
        }
        const items2 = repo.listItems();
        const itemMap2 = new Map(items2.map((i) => [i.id, i]));
        const todayTasks = counts
            .sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime())
            .map((c) => ({
            id: c.id,
            itemId: c.itemId,
            itemName: itemMap2.get(c.itemId)?.name || 'Unknown',
            assignedByName: c.assignedBy ? repo.findUserById(c.assignedBy)?.name || 'Unknown' : 'Unknown',
            assignedAt: c.assignedAt,
            dueDate: c.dueDate,
            priority: c.dueDate ? (new Date(c.dueDate) < new Date(Date.now() + 24 * 60 * 60 * 1000) ? 'high' : 'medium') : 'low',
        }));
        res.json({
            success: true,
            todayTasks,
            totalToday: todayTasks.length,
            highPriorityCount: todayTasks.filter((t) => t.priority === 'high').length,
        });
    }
    catch (error) {
        console.error('Today tasks error:', error);
        res.status(500).json({ error: 'Failed to fetch today tasks' });
    }
});
// ============================================
// STOCK RECEIVING SUMMARY
// ============================================
router.get('/companies/:companyId/analytics/stock-receiving', (req, res) => {
    try {
        const { companyId, branchId, locationId } = req.query;
        if (req.companyId !== companyId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        // Get recent transfers that are being received
        let transfers = repo.listTransfersByBranch(branchId || '');
        if (locationId) {
            transfers = transfers.filter((t) => t.destinationLocationId === locationId);
        }
        const receivingTransfers = transfers
            .filter((t) => ['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(t.status))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 20)
            .map((t) => {
            const sourceLocation = repo.locations.find((l) => l.id === t.sourceLocationId)?.name || 'Unknown';
            const destLocation = repo.locations.find((l) => l.id === t.destinationLocationId)?.name || 'Unknown';
            return {
                id: t.id,
                from: sourceLocation,
                to: destLocation,
                status: t.status,
                totalLines: t.lines.length,
                cartonCount: t.cartonCount,
                dispatchedAt: t.dispatchedAt,
                receivedQty: t.receivedQty || 0,
                damagedQty: t.damagedQty || 0,
                shortageQty: t.shortageQty || 0,
                totalQty: t.lines.reduce((sum, line) => sum + line.quantity, 0),
                receiveStatus: t.receivedQty === t.lines.reduce((sum, line) => sum + line.quantity, 0) ? 'COMPLETE' : 'PARTIAL',
            };
        });
        res.json({
            success: true,
            receivingTransfers,
            totalIncoming: receivingTransfers.length,
            completeReceipts: receivingTransfers.filter((t) => t.receiveStatus === 'COMPLETE').length,
            partialReceipts: receivingTransfers.filter((t) => t.receiveStatus === 'PARTIAL').length,
            totalDamagedQty: receivingTransfers.reduce((sum, t) => sum + (t.damagedQty || 0), 0),
            totalShortageQty: receivingTransfers.reduce((sum, t) => sum + (t.shortageQty || 0), 0),
        });
    }
    catch (error) {
        console.error('Stock receiving error:', error);
        res.status(500).json({ error: 'Failed to fetch stock receiving data' });
    }
});
// ============================================
// PERFORMANCE ANALYTICS
// ============================================
router.get('/companies/:companyId/analytics/performance', (req, res) => {
    try {
        const { companyId, branchId } = req.query;
        if (req.companyId !== companyId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        let counts = repo.listCountsByBranch(companyId);
        if (branchId) {
            counts = counts.filter((c) => c.branchId === branchId);
        }
        // Calculate performance metrics
        const approvedCounts = counts.filter((c) => c.status === 'APPROVED');
        const rejectedCounts = counts.filter((c) => c.status === 'REJECTED');
        const totalVariance = approvedCounts.reduce((sum, c) => sum + (c.variance ?? 0), 0);
        const avgVariancePercentage = approvedCounts.length > 0
            ? (approvedCounts.reduce((sum, c) => sum + (c.variancePercentage ?? 0), 0) / approvedCounts.length).toFixed(2)
            : '0';
        // Count by user
        const userPerformance = new Map();
        counts.forEach((c) => {
            const userId = c.submittedBy;
            const userName = repo.findUserById(userId)?.name || 'Unknown';
            if (!userPerformance.has(userId)) {
                userPerformance.set(userId, { name: userName, submitted: 0, approved: 0, rejected: 0 });
            }
            const stats = userPerformance.get(userId);
            stats.submitted += 1;
            if (c.status === 'APPROVED')
                stats.approved += 1;
            if (c.status === 'REJECTED')
                stats.rejected += 1;
        });
        const userStats = Array.from(userPerformance.values()).sort((a, b) => b.submitted - a.submitted);
        res.json({
            success: true,
            metrics: {
                totalCountsSubmitted: counts.filter((c) => c.status !== 'ASSIGNED').length,
                approvedCounts: approvedCounts.length,
                rejectedCounts: rejectedCounts.length,
                approvalRate: counts.length > 0 ? ((approvedCounts.length / counts.length) * 100).toFixed(2) + '%' : '0%',
                totalVariance,
                avgVariancePercentage: parseFloat(avgVariancePercentage),
                overageCount: approvedCounts.filter((c) => (c.variance ?? 0) > 0).length,
                shortageCount: approvedCounts.filter((c) => (c.variance ?? 0) < 0).length,
            },
            userPerformance: userStats,
        });
    }
    catch (error) {
        console.error('Performance analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch performance analytics' });
    }
});
// ============================================
// AUDIT LOG
// ============================================
router.get('/companies/:companyId/audit-logs', (req, res) => {
    try {
        const { companyId } = req.params;
        const { limit = '100' } = req.query;
        if (req.companyId !== companyId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only company admins can view audit logs' });
        }
        const logs = repo.listAuditLogsByCompany(companyId, parseInt(limit) || 100);
        res.json({
            success: true,
            auditLogs: logs.map((log) => ({
                id: log.id,
                userId: log.userId,
                userName: log.userName,
                action: log.action,
                entityType: log.entityType,
                entityId: log.entityId,
                entityDescription: log.entityDescription,
                createdAt: log.createdAt,
            })),
            totalLogs: logs.length,
        });
    }
    catch (error) {
        console.error('Audit logs error:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});
exports.default = router;
