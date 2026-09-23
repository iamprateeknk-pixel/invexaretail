-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT', 'ARCHIVE', 'REVERSE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_STOCK', 'PURCHASE_RECEIPT', 'SALES_DEDUCTION', 'SALES_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_VARIANCE', 'ADJUSTMENT', 'WASTE', 'DAMAGE', 'EXPIRY_WRITE_OFF');

-- CreateEnum
CREATE TYPE "ExpiryAlertStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'RESOLVED_BY_TRANSFER', 'RESOLVED_BY_WRITE_OFF');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'PENDING_PICK', 'REQUESTED', 'PICKING', 'PARTIAL', 'PICKED', 'READY_FOR_ADMIN', 'CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED', 'PARTIAL_RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('DAMAGE', 'SHORT_RECEIPT', 'EXCESS_RECEIPT', 'WRONG_ITEM', 'EXPIRED', 'MISSING_STOCK', 'QC_FAIL', 'TRANSFER_DISCREPANCY', 'COUNT_VARIANCE', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'RESOLVED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExceptionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExceptionDisposition" AS ENUM ('RESTOCK', 'VENDOR_RETURN', 'MARKDOWN', 'DESTROY', 'REWORK', 'WRITE_OFF', 'ACCEPT', 'RECOUNT', 'ESCALATE', 'NONE');

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "industry" TEXT,
    "industryKey" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedLocations" TEXT NOT NULL,
    "assignedBranches" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "otpSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "suspendedReason" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'WAREHOUSE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "managerId" TEXT,
    "workingHours" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "locationType" TEXT DEFAULT 'STANDARD',
    "branchId" TEXT,
    "parentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',
    "description" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "deliverySlaHours" DOUBLE PRECISION,
    "shippingCostPerKm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bin" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "aisle" TEXT,
    "rack" TEXT,
    "shelf" TEXT,
    "capacity" DOUBLE PRECISION,
    "storageClass" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isPickFace" BOOLEAN NOT NULL DEFAULT false,
    "pickFaceMin" DOUBLE PRECISION,
    "pickFaceMax" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "Bin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PutawayTask" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "locationId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "suggestedBinId" TEXT,
    "confirmedBinId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceDocument" TEXT,
    "sourceLineId" TEXT,
    "assignedToId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "PutawayTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickWave" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "transferIds" JSONB NOT NULL,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "PickWave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fulfillmentLocationId" TEXT NOT NULL,
    "customerName" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3),
    "reservationExpiresAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "estimatedDispatchAt" TIMESTAMP(3),
    "estimatedDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "cartonCount" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "lengthCm" DOUBLE PRECISION,
    "widthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "packedById" TEXT NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "PackSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackedLine" (
    "id" TEXT NOT NULL,
    "packSessionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "scannedById" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackedLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "refundStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "refundNote" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "disposition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packSessionId" TEXT,
    "carrierProvider" TEXT NOT NULL,
    "awbNumber" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "labelUrl" TEXT,
    "manifestId" TEXT,
    "weightKg" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "requestedQty" DOUBLE PRECISION NOT NULL,
    "fulfilledQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fulfillmentLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToleranceRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "branchId" TEXT,
    "valueThreshold" DOUBLE PRECISION,
    "percentThreshold" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToleranceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "category" TEXT,
    "branchId" TEXT,
    "valueThreshold" DOUBLE PRECISION NOT NULL,
    "requiredApproverRole" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "category" TEXT,
    "branchId" TEXT,
    "quantityThreshold" DOUBLE PRECISION,
    "valueThreshold" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "valueAtStake" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "subcategory" TEXT,
    "company" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',
    "unit" TEXT,
    "description" TEXT,
    "countMethod" TEXT NOT NULL DEFAULT 'LOT_SCAN',
    "pickMethod" TEXT NOT NULL DEFAULT 'LOT_SCAN',
    "allocationStrategy" TEXT NOT NULL DEFAULT 'FEFO',
    "lotRequired" BOOLEAN NOT NULL DEFAULT true,
    "expiryRequired" BOOLEAN NOT NULL DEFAULT false,
    "decimalQuantity" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "barcode" TEXT,
    "hsn" TEXT,
    "gstRate" DOUBLE PRECISION,
    "mrp" DOUBLE PRECISION,
    "leadTimeDays" INTEGER,
    "shelfLifeDays" INTEGER,
    "aliases" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "attributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inTransit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quarantine" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damaged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "physicalQty" DOUBLE PRECISION NOT NULL,
    "bookQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "submittedById" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewReason" TEXT,
    "parentCountId" TEXT,
    "requestId" TEXT,
    "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
    "reconciliationNote" TEXT,
    "reconciliationAt" TIMESTAMP(3),
    "bookQtyOriginal" DOUBLE PRECISION,
    "lateDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateMovementKeys" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountAssignment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "instructions" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "countId" TEXT,
    "parentCountId" TEXT,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "CountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "notes" TEXT,
    "cartonCount" INTEGER,
    "logistics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "requestedQty" DOUBLE PRECISION NOT NULL,
    "pickedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damagedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shortageQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "excessQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "TransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferReceipt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "TransferReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "transferLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damagedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shortageQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "excessQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "TransferReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "branchId" TEXT,
    "correlationId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "reason" TEXT,
    "sourceContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'emerald',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTag" (
    "itemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ItemTag_pkey" PRIMARY KEY ("itemId","tagId")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "contactName" TEXT,
    "leadTimeDays" INTEGER,
    "moq" DOUBLE PRECISION,
    "paymentTerms" TEXT,
    "categories" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "expectedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "notes" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freightCost" DOUBLE PRECISION DEFAULT 0,
    "customsCost" DOUBLE PRECISION DEFAULT 0,
    "insuranceCost" DOUBLE PRECISION DEFAULT 0,
    "handlingCost" DOUBLE PRECISION DEFAULT 0,
    "landedCostMethod" TEXT DEFAULT 'VALUE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "matchResult" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "invoicedQty" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "priceType" TEXT NOT NULL,
    "branchId" TEXT,
    "customerGroup" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderRule" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 0,
    "targetQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "ReorderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "locationId" TEXT,
    "config" JSONB,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'ITEM',
    "filter" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCheckout" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "assigneeName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'CHECKED_OUT',
    "dueAt" TIMESTAMP(3),
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    "checkedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "AssetCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLine" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "plannedQty" INTEGER NOT NULL,
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "JobLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextComment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretEncrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryLog" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "payloadHash" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "body" TEXT,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "WebhookDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "branchId" TEXT,
    "fileHash" TEXT,
    "sourceDateFrom" TIMESTAMP(3),
    "sourceDateTo" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "locationId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "qtyDelta" DOUBLE PRECISION NOT NULL,
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdById" TEXT NOT NULL,
    "metadata" JSONB,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "syncedThroughAt" TIMESTAMP(3) NOT NULL,
    "lastImportBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningStockSnapshot" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "OpeningStockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "locationId" TEXT NOT NULL,
    "binId" TEXT,
    "movementType" "StockMovementType" NOT NULL,
    "qtyDelta" DOUBLE PRECISION NOT NULL,
    "beforeBalance" DOUBLE PRECISION NOT NULL,
    "afterBalance" DOUBLE PRECISION NOT NULL,
    "sourceDocument" TEXT,
    "sourceLineId" TEXT,
    "actor" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "correlationId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "locationId" TEXT NOT NULL,
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inTransit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "available" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastPostedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystemRole" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scopeId" TEXT,
    "scopeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "denied" BOOLEAN NOT NULL DEFAULT false,
    "scopeId" TEXT,
    "scopeType" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "device" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkAssignment" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "branchId" TEXT,
    "locationId" TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "slaMinutes" INTEGER,
    "instructions" TEXT,
    "checklist" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "items" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkComment" (
    "id" TEXT NOT NULL,
    "workAssignmentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkAttachment" (
    "id" TEXT NOT NULL,
    "workAssignmentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCase" (
    "id" TEXT NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ExceptionPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "itemId" TEXT,
    "lotId" TEXT,
    "locationId" TEXT,
    "branchId" TEXT,
    "quantity" DOUBLE PRECISION,
    "valueAtRisk" DOUBLE PRECISION,
    "sourceDocument" TEXT,
    "sourceLineId" TEXT,
    "ownerId" TEXT,
    "reportedById" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "disposition" "ExceptionDisposition",
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "ExceptionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcChecklistTemplate" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "checks" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QcChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcInspection" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "itemId" TEXT,
    "lotId" TEXT,
    "locationId" TEXT,
    "sourceDocument" TEXT,
    "sourceLineId" TEXT,
    "results" JSONB NOT NULL,
    "overallResult" TEXT NOT NULL,
    "notes" TEXT,
    "inspectedById" TEXT NOT NULL,
    "exceptionCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "QcInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceDismissal" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "countId" TEXT,
    "reason" TEXT,
    "dismissedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpiryAlert" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "daysUntilExpiry" INTEGER NOT NULL,
    "status" "ExpiryAlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "recommendedAction" TEXT,
    "metadata" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "ExpiryAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplenishmentSuggestion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "suggestType" TEXT NOT NULL,
    "currentStock" DOUBLE PRECISION NOT NULL,
    "minRequired" DOUBLE PRECISION NOT NULL,
    "targetStock" DOUBLE PRECISION NOT NULL,
    "suggestedQty" DOUBLE PRECISION NOT NULL,
    "sourceLocation" TEXT,
    "salesVelocity" DOUBLE PRECISION,
    "daysOfCover" DOUBLE PRECISION,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "ReplenishmentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "errors" JSONB,
    "warnings" JSONB,
    "mappedData" JSONB,
    "sourceKey" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferCarton" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "cartonNumber" TEXT NOT NULL,
    "qrCode" TEXT,
    "contents" JSONB,
    "quantity" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PACKED',
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',

    CONSTRAINT "TransferCarton_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "betaMode" BOOLEAN NOT NULL DEFAULT false,
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "scopeId" TEXT,
    "config" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowConfiguration" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scopeId" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "varianceThreshold" DOUBLE PRECISION,
    "negativeStockRule" TEXT NOT NULL DEFAULT 'BLOCK',
    "fefoEnforced" BOOLEAN NOT NULL DEFAULT true,
    "expiryBlocking" BOOLEAN NOT NULL DEFAULT false,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlPlaneState" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlPlaneState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BinStock" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL DEFAULT '',
    "locationId" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BinStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BinMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL DEFAULT '',
    "locationId" TEXT NOT NULL,
    "fromBinId" TEXT NOT NULL,
    "toBinId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reference" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BinMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceConnector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tenantId" TEXT NOT NULL DEFAULT 'default-company',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIngestedAt" TIMESTAMP(3),

    CONSTRAINT "MarketplaceConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialNumber" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "serial" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "currentLocationId" TEXT,
    "currentBinId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),
    "returnState" TEXT,
    "warrantyEnd" TIMESTAMP(3),
    "metadata" JSONB,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerialNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialMovement" (
    "id" TEXT NOT NULL,
    "serialNumberId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reference" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerialMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTakeCampaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',
    "name" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dailyItemsPerUser" INTEGER NOT NULL,
    "userIds" JSONB NOT NULL,
    "priorityOrder" JSONB NOT NULL,
    "includeNewStock" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "lastRunDate" TEXT,
    "pausedFrom" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "StockTakeCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTakeCampaignItem" (
    "campaignId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "excludedReason" TEXT,
    "assignedToId" TEXT,
    "assignmentId" TEXT,
    "countId" TEXT,
    "assignedDate" TIMESTAMP(3),
    "lastCountedAt" TIMESTAMP(3),
    "recounts" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTakeCampaignItem_pkey" PRIMARY KEY ("campaignId","itemId")
);

-- CreateTable
CREATE TABLE "TransferEvidence" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contents" BYTEA NOT NULL,

    CONSTRAINT "TransferEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contents" BYTEA NOT NULL,

    CONSTRAINT "ItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEventOutbox" (
    "id" BIGSERIAL NOT NULL,
    "topic" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationIds" JSONB,
    "actorId" TEXT,
    "requestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyProfile_tenantId_idx" ON "CompanyProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "Branch_code_status_idx" ON "Branch"("code", "status");

-- CreateIndex
CREATE INDEX "Branch_companyId_idx" ON "Branch"("companyId");

-- CreateIndex
CREATE INDEX "Branch_tenantId_idx" ON "Branch"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE INDEX "Location_code_branchId_status_idx" ON "Location"("code", "branchId", "status");

-- CreateIndex
CREATE INDEX "Location_companyId_idx" ON "Location"("companyId");

-- CreateIndex
CREATE INDEX "Location_tenantId_idx" ON "Location"("tenantId");

-- CreateIndex
CREATE INDEX "Bin_tenantId_idx" ON "Bin"("tenantId");

-- CreateIndex
CREATE INDEX "Bin_locationId_status_idx" ON "Bin"("locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_locationId_code_key" ON "Bin"("locationId", "code");

-- CreateIndex
CREATE INDEX "PutawayTask_tenantId_idx" ON "PutawayTask"("tenantId");

-- CreateIndex
CREATE INDEX "PutawayTask_locationId_status_idx" ON "PutawayTask"("locationId", "status");

-- CreateIndex
CREATE INDEX "PutawayTask_status_idx" ON "PutawayTask"("status");

-- CreateIndex
CREATE INDEX "PickWave_tenantId_idx" ON "PickWave"("tenantId");

-- CreateIndex
CREATE INDEX "PickWave_locationId_status_idx" ON "PickWave"("locationId", "status");

-- CreateIndex
CREATE INDEX "Order_tenantId_idx" ON "Order"("tenantId");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_channel_status_idx" ON "Order"("channel", "status");

-- CreateIndex
CREATE INDEX "Order_fulfillmentLocationId_status_idx" ON "Order"("fulfillmentLocationId", "status");

-- CreateIndex
CREATE INDEX "Order_status_reservationExpiresAt_idx" ON "Order"("status", "reservationExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_channel_externalReference_key" ON "Order"("channel", "externalReference");

-- CreateIndex
CREATE INDEX "PackSession_orderId_status_idx" ON "PackSession"("orderId", "status");

-- CreateIndex
CREATE INDEX "PackSession_companyId_idx" ON "PackSession"("companyId");

-- CreateIndex
CREATE INDEX "PackedLine_packSessionId_idx" ON "PackedLine"("packSessionId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_status_idx" ON "ReturnRequest"("orderId", "status");

-- CreateIndex
CREATE INDEX "ReturnRequest_companyId_idx" ON "ReturnRequest"("companyId");

-- CreateIndex
CREATE INDEX "ReturnLine_returnRequestId_idx" ON "ReturnLine"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnLine_orderLineId_idx" ON "ReturnLine"("orderLineId");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_companyId_idx" ON "Shipment"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_awbNumber_key" ON "Shipment"("awbNumber");

-- CreateIndex
CREATE INDEX "OrderLine_tenantId_idx" ON "OrderLine"("tenantId");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "ToleranceRule_active_category_idx" ON "ToleranceRule"("active", "category");

-- CreateIndex
CREATE INDEX "ToleranceRule_branchId_active_idx" ON "ToleranceRule"("branchId", "active");

-- CreateIndex
CREATE INDEX "ApprovalRule_triggerType_active_idx" ON "ApprovalRule"("triggerType", "active");

-- CreateIndex
CREATE INDEX "ApprovalRule_branchId_active_idx" ON "ApprovalRule"("branchId", "active");

-- CreateIndex
CREATE INDEX "EvidenceRule_triggerType_active_idx" ON "EvidenceRule"("triggerType", "active");

-- CreateIndex
CREATE INDEX "EvidenceRule_branchId_active_idx" ON "EvidenceRule"("branchId", "active");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entityType_entityId_status_idx" ON "ApprovalRequest"("entityType", "entityId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_triggerType_idx" ON "ApprovalRequest"("status", "triggerType");

-- CreateIndex
CREATE UNIQUE INDEX "Item_code_key" ON "Item"("code");

-- CreateIndex
CREATE INDEX "Item_companyId_idx" ON "Item"("companyId");

-- CreateIndex
CREATE INDEX "Item_tenantId_idx" ON "Item"("tenantId");

-- CreateIndex
CREATE INDEX "Item_status_idx" ON "Item"("status");

-- CreateIndex
CREATE INDEX "Item_barcode_idx" ON "Item"("barcode");

-- CreateIndex
CREATE INDEX "Lot_tenantId_idx" ON "Lot"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_itemId_lotNo_key" ON "Lot"("itemId", "lotNo");

-- CreateIndex
CREATE INDEX "StockLedger_tenantId_idx" ON "StockLedger"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedger_itemId_lotId_locationId_key" ON "StockLedger"("itemId", "lotId", "locationId");

-- CreateIndex
CREATE INDEX "StockCount_tenantId_idx" ON "StockCount"("tenantId");

-- CreateIndex
CREATE INDEX "StockCount_reconciliationRequired_idx" ON "StockCount"("reconciliationRequired");

-- CreateIndex
CREATE INDEX "StockCount_submittedById_requestId_idx" ON "StockCount"("submittedById", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CountAssignment_countId_key" ON "CountAssignment"("countId");

-- CreateIndex
CREATE INDEX "CountAssignment_tenantId_idx" ON "CountAssignment"("tenantId");

-- CreateIndex
CREATE INDEX "CountAssignment_campaignId_idx" ON "CountAssignment"("campaignId");

-- CreateIndex
CREATE INDEX "CountAssignment_assignedToId_status_idx" ON "CountAssignment"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "Transfer_tenantId_idx" ON "Transfer"("tenantId");

-- CreateIndex
CREATE INDEX "TransferLine_tenantId_idx" ON "TransferLine"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferReceipt_requestId_key" ON "TransferReceipt"("requestId");

-- CreateIndex
CREATE INDEX "TransferReceipt_tenantId_idx" ON "TransferReceipt"("tenantId");

-- CreateIndex
CREATE INDEX "TransferReceipt_transferId_createdAt_idx" ON "TransferReceipt"("transferId", "createdAt");

-- CreateIndex
CREATE INDEX "TransferReceiptLine_tenantId_idx" ON "TransferReceiptLine"("tenantId");

-- CreateIndex
CREATE INDEX "TransferReceiptLine_transferLineId_idx" ON "TransferReceiptLine"("transferLineId");

-- CreateIndex
CREATE INDEX "TransferReceiptLine_receiptId_idx" ON "TransferReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "ItemTag_tagId_idx" ON "ItemTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_name_key" ON "CustomFieldDefinition"("name");

-- CreateIndex
CREATE INDEX "CustomFieldValue_fieldId_idx" ON "CustomFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_itemId_fieldId_key" ON "CustomFieldValue"("itemId", "fieldId");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_requestId_key" ON "PurchaseReceipt"("requestId");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_purchaseOrderId_idx" ON "PurchaseReceipt"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_idx" ON "PurchaseOrder"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_locationId_status_idx" ON "PurchaseOrder"("locationId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_tenantId_idx" ON "PurchaseOrderLine"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_itemId_idx" ON "PurchaseOrderLine"("itemId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_purchaseOrderId_idx" ON "SupplierInvoice"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_tenantId_idx" ON "SupplierInvoice"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_supplierInvoiceId_idx" ON "SupplierInvoiceLine"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "PriceList_itemId_priceType_branchId_idx" ON "PriceList"("itemId", "priceType", "branchId");

-- CreateIndex
CREATE INDEX "PriceList_companyId_idx" ON "PriceList"("companyId");

-- CreateIndex
CREATE INDEX "ReorderRule_tenantId_idx" ON "ReorderRule"("tenantId");

-- CreateIndex
CREATE INDEX "ReorderRule_locationId_idx" ON "ReorderRule"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderRule_itemId_locationId_key" ON "ReorderRule"("itemId", "locationId");

-- CreateIndex
CREATE INDEX "SavedReport_tenantId_idx" ON "SavedReport"("tenantId");

-- CreateIndex
CREATE INDEX "SavedReport_ownerId_updatedAt_idx" ON "SavedReport"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "SavedReport_isShared_updatedAt_idx" ON "SavedReport"("isShared", "updatedAt");

-- CreateIndex
CREATE INDEX "SavedView_ownerId_updatedAt_idx" ON "SavedView"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "SavedView_isShared_updatedAt_idx" ON "SavedView"("isShared", "updatedAt");

-- CreateIndex
CREATE INDEX "SavedView_companyId_idx" ON "SavedView"("companyId");

-- CreateIndex
CREATE INDEX "AssetCheckout_tenantId_idx" ON "AssetCheckout"("tenantId");

-- CreateIndex
CREATE INDEX "AssetCheckout_locationId_status_idx" ON "AssetCheckout"("locationId", "status");

-- CreateIndex
CREATE INDEX "AssetCheckout_itemId_status_idx" ON "AssetCheckout"("itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Job_number_key" ON "Job"("number");

-- CreateIndex
CREATE INDEX "Job_tenantId_idx" ON "Job"("tenantId");

-- CreateIndex
CREATE INDEX "Job_locationId_status_idx" ON "Job"("locationId", "status");

-- CreateIndex
CREATE INDEX "JobLine_tenantId_idx" ON "JobLine"("tenantId");

-- CreateIndex
CREATE INDEX "JobLine_jobId_idx" ON "JobLine"("jobId");

-- CreateIndex
CREATE INDEX "JobLine_itemId_idx" ON "JobLine"("itemId");

-- CreateIndex
CREATE INDEX "ContextComment_entityType_entityId_createdAt_idx" ON "ContextComment"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "UserNotification_userId_readAt_createdAt_idx" ON "UserNotification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "UserNotification_role_readAt_createdAt_idx" ON "UserNotification"("role", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookSubscription_tenantId_idx" ON "WebhookSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_status_createdAt_idx" ON "WebhookSubscription"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_tenantId_idx" ON "WebhookDeliveryLog"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_subscriptionId_createdAt_idx" ON "WebhookDeliveryLog"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_status_createdAt_idx" ON "WebhookDeliveryLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_status_nextRetryAt_idx" ON "WebhookDeliveryLog"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "ImportBatch_tenantId_idx" ON "ImportBatch"("tenantId");

-- CreateIndex
CREATE INDEX "ImportBatch_type_importedAt_idx" ON "ImportBatch"("type", "importedAt");

-- CreateIndex
CREATE INDEX "ImportBatch_importedById_importedAt_idx" ON "ImportBatch"("importedById", "importedAt");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ImportBatch_branchId_fileHash_idx" ON "ImportBatch"("branchId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_dedupeKey_key" ON "InventoryMovement"("dedupeKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_tenantId_idx" ON "InventoryMovement"("tenantId");

-- CreateIndex
CREATE INDEX "InventoryMovement_locationId_transactionAt_idx" ON "InventoryMovement"("locationId", "transactionAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_locationId_transactionAt_idx" ON "InventoryMovement"("itemId", "locationId", "transactionAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_sourceType_sourceReference_idx" ON "InventoryMovement"("sourceType", "sourceReference");

-- CreateIndex
CREATE INDEX "SyncCheckpoint_tenantId_idx" ON "SyncCheckpoint"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCheckpoint_locationId_sourceType_key" ON "SyncCheckpoint"("locationId", "sourceType");

-- CreateIndex
CREATE INDEX "OpeningStockSnapshot_tenantId_idx" ON "OpeningStockSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "OpeningStockSnapshot_itemId_locationId_snapshotAt_idx" ON "OpeningStockSnapshot"("itemId", "locationId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningStockSnapshot_importBatchId_itemId_lotId_locationId_key" ON "OpeningStockSnapshot"("importBatchId", "itemId", "lotId", "locationId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_idx" ON "StockMovement"("tenantId");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_locationId_timestamp_idx" ON "StockMovement"("itemId", "locationId", "timestamp");

-- CreateIndex
CREATE INDEX "StockMovement_correlationId_idx" ON "StockMovement"("correlationId");

-- CreateIndex
CREATE INDEX "StockMovement_sourceDocument_sourceLineId_idx" ON "StockMovement"("sourceDocument", "sourceLineId");

-- CreateIndex
CREATE INDEX "StockMovement_timestamp_idx" ON "StockMovement"("timestamp");

-- CreateIndex
CREATE INDEX "StockBalance_tenantId_idx" ON "StockBalance"("tenantId");

-- CreateIndex
CREATE INDEX "StockBalance_locationId_available_idx" ON "StockBalance"("locationId", "available");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_itemId_lotId_locationId_key" ON "StockBalance"("itemId", "lotId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_module_action_key" ON "Permission"("module", "action");

-- CreateIndex
CREATE UNIQUE INDEX "RoleTemplate_name_key" ON "RoleTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_scopeId_key" ON "UserRole"("userId", "roleId", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permissionId_scopeId_key" ON "UserPermission"("userId", "permissionId", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_token_key" ON "UserSession"("token");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "LoginHistory_userId_createdAt_idx" ON "LoginHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginHistory_createdAt_idx" ON "LoginHistory"("createdAt");

-- CreateIndex
CREATE INDEX "WorkAssignment_assignedToId_status_idx" ON "WorkAssignment"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "WorkAssignment_type_status_idx" ON "WorkAssignment"("type", "status");

-- CreateIndex
CREATE INDEX "WorkAssignment_dueAt_status_idx" ON "WorkAssignment"("dueAt", "status");

-- CreateIndex
CREATE INDEX "WorkComment_workAssignmentId_createdAt_idx" ON "WorkComment"("workAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkAttachment_workAssignmentId_idx" ON "WorkAttachment"("workAssignmentId");

-- CreateIndex
CREATE INDEX "ExceptionCase_tenantId_idx" ON "ExceptionCase"("tenantId");

-- CreateIndex
CREATE INDEX "ExceptionCase_status_priority_dueAt_idx" ON "ExceptionCase"("status", "priority", "dueAt");

-- CreateIndex
CREATE INDEX "ExceptionCase_type_status_idx" ON "ExceptionCase"("type", "status");

-- CreateIndex
CREATE INDEX "ExceptionCase_ownerId_status_idx" ON "ExceptionCase"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ExceptionCase_locationId_status_idx" ON "ExceptionCase"("locationId", "status");

-- CreateIndex
CREATE INDEX "ExceptionCase_sourceDocument_sourceLineId_idx" ON "ExceptionCase"("sourceDocument", "sourceLineId");

-- CreateIndex
CREATE INDEX "QcChecklistTemplate_active_category_idx" ON "QcChecklistTemplate"("active", "category");

-- CreateIndex
CREATE INDEX "QcInspection_tenantId_idx" ON "QcInspection"("tenantId");

-- CreateIndex
CREATE INDEX "QcInspection_sourceDocument_sourceLineId_idx" ON "QcInspection"("sourceDocument", "sourceLineId");

-- CreateIndex
CREATE INDEX "QcInspection_overallResult_createdAt_idx" ON "QcInspection"("overallResult", "createdAt");

-- CreateIndex
CREATE INDEX "IntelligenceDismissal_locationId_itemId_type_createdAt_idx" ON "IntelligenceDismissal"("locationId", "itemId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ExpiryAlert_tenantId_idx" ON "ExpiryAlert"("tenantId");

-- CreateIndex
CREATE INDEX "ExpiryAlert_status_locationId_expiryDate_idx" ON "ExpiryAlert"("status", "locationId", "expiryDate");

-- CreateIndex
CREATE INDEX "ExpiryAlert_itemId_expiryDate_idx" ON "ExpiryAlert"("itemId", "expiryDate");

-- CreateIndex
CREATE INDEX "ReplenishmentSuggestion_tenantId_idx" ON "ReplenishmentSuggestion"("tenantId");

-- CreateIndex
CREATE INDEX "ReplenishmentSuggestion_locationId_status_priority_idx" ON "ReplenishmentSuggestion"("locationId", "status", "priority");

-- CreateIndex
CREATE INDEX "ImportRow_tenantId_idx" ON "ImportRow"("tenantId");

-- CreateIndex
CREATE INDEX "ImportRow_importBatchId_status_idx" ON "ImportRow"("importBatchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_importBatchId_rowNumber_key" ON "ImportRow"("importBatchId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportTemplate_importType_idx" ON "ImportTemplate"("importType");

-- CreateIndex
CREATE UNIQUE INDEX "ImportTemplate_name_importType_key" ON "ImportTemplate"("name", "importType");

-- CreateIndex
CREATE INDEX "TransferCarton_tenantId_idx" ON "TransferCarton"("tenantId");

-- CreateIndex
CREATE INDEX "TransferCarton_transferId_status_idx" ON "TransferCarton"("transferId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransferCarton_transferId_cartonNumber_key" ON "TransferCarton"("transferId", "cartonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_name_key" ON "FeatureFlag"("name");

-- CreateIndex
CREATE INDEX "FeatureFlag_scope_scopeId_enabled_idx" ON "FeatureFlag"("scope", "scopeId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowConfiguration_type_scopeId_key" ON "WorkflowConfiguration"("type", "scopeId");

-- CreateIndex
CREATE INDEX "BinStock_locationId_binId_idx" ON "BinStock"("locationId", "binId");

-- CreateIndex
CREATE UNIQUE INDEX "BinStock_itemId_lotId_locationId_binId_key" ON "BinStock"("itemId", "lotId", "locationId", "binId");

-- CreateIndex
CREATE INDEX "BinMovement_locationId_createdAt_idx" ON "BinMovement"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "BinMovement_itemId_idx" ON "BinMovement"("itemId");

-- CreateIndex
CREATE INDEX "MarketplaceConnector_tenantId_status_idx" ON "MarketplaceConnector"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MarketplaceConnector_platform_status_idx" ON "MarketplaceConnector"("platform", "status");

-- CreateIndex
CREATE INDEX "SerialNumber_currentLocationId_status_idx" ON "SerialNumber"("currentLocationId", "status");

-- CreateIndex
CREATE INDEX "SerialNumber_companyId_idx" ON "SerialNumber"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_itemId_serial_key" ON "SerialNumber"("itemId", "serial");

-- CreateIndex
CREATE INDEX "SerialMovement_serialNumberId_createdAt_idx" ON "SerialMovement"("serialNumberId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTakeCampaign_companyId_locationId_status_idx" ON "StockTakeCampaign"("companyId", "locationId", "status");

-- CreateIndex
CREATE INDEX "StockTakeCampaign_tenantId_idx" ON "StockTakeCampaign"("tenantId");

-- CreateIndex
CREATE INDEX "StockTakeCampaignItem_campaignId_status_idx" ON "StockTakeCampaignItem"("campaignId", "status");

-- CreateIndex
CREATE INDEX "TransferEvidence_transferId_idx" ON "TransferEvidence"("transferId");

-- CreateIndex
CREATE INDEX "ItemPhoto_itemId_idx" ON "ItemPhoto"("itemId");

-- CreateIndex
CREATE INDEX "DomainEventOutbox_companyId_id_idx" ON "DomainEventOutbox"("companyId", "id");

-- CreateIndex
CREATE INDEX "DomainEventOutbox_occurredAt_idx" ON "DomainEventOutbox"("occurredAt");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayTask" ADD CONSTRAINT "PutawayTask_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayTask" ADD CONSTRAINT "PutawayTask_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayTask" ADD CONSTRAINT "PutawayTask_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayTask" ADD CONSTRAINT "PutawayTask_suggestedBinId_fkey" FOREIGN KEY ("suggestedBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayTask" ADD CONSTRAINT "PutawayTask_confirmedBinId_fkey" FOREIGN KEY ("confirmedBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayTask" ADD CONSTRAINT "PutawayTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickWave" ADD CONSTRAINT "PickWave_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickWave" ADD CONSTRAINT "PickWave_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickWave" ADD CONSTRAINT "PickWave_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_fulfillmentLocationId_fkey" FOREIGN KEY ("fulfillmentLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackSession" ADD CONSTRAINT "PackSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackedLine" ADD CONSTRAINT "PackedLine_packSessionId_fkey" FOREIGN KEY ("packSessionId") REFERENCES "PackSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToleranceRule" ADD CONSTRAINT "ToleranceRule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToleranceRule" ADD CONSTRAINT "ToleranceRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRule" ADD CONSTRAINT "EvidenceRule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRule" ADD CONSTRAINT "EvidenceRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ApprovalRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountAssignment" ADD CONSTRAINT "CountAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountAssignment" ADD CONSTRAINT "CountAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountAssignment" ADD CONSTRAINT "CountAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountAssignment" ADD CONSTRAINT "CountAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceiptLine" ADD CONSTRAINT "TransferReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "TransferReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLine" ADD CONSTRAINT "JobLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockSnapshot" ADD CONSTRAINT "OpeningStockSnapshot_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockSnapshot" ADD CONSTRAINT "OpeningStockSnapshot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockSnapshot" ADD CONSTRAINT "OpeningStockSnapshot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockSnapshot" ADD CONSTRAINT "OpeningStockSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAssignment" ADD CONSTRAINT "WorkAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAssignment" ADD CONSTRAINT "WorkAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAssignment" ADD CONSTRAINT "WorkAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAssignment" ADD CONSTRAINT "WorkAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkComment" ADD CONSTRAINT "WorkComment_workAssignmentId_fkey" FOREIGN KEY ("workAssignmentId") REFERENCES "WorkAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkComment" ADD CONSTRAINT "WorkComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAttachment" ADD CONSTRAINT "WorkAttachment_workAssignmentId_fkey" FOREIGN KEY ("workAssignmentId") REFERENCES "WorkAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcChecklistTemplate" ADD CONSTRAINT "QcChecklistTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QcChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_exceptionCaseId_fkey" FOREIGN KEY ("exceptionCaseId") REFERENCES "ExceptionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDismissal" ADD CONSTRAINT "IntelligenceDismissal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDismissal" ADD CONSTRAINT "IntelligenceDismissal_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDismissal" ADD CONSTRAINT "IntelligenceDismissal_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryAlert" ADD CONSTRAINT "ExpiryAlert_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryAlert" ADD CONSTRAINT "ExpiryAlert_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryAlert" ADD CONSTRAINT "ExpiryAlert_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentSuggestion" ADD CONSTRAINT "ReplenishmentSuggestion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentSuggestion" ADD CONSTRAINT "ReplenishmentSuggestion_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportTemplate" ADD CONSTRAINT "ImportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferCarton" ADD CONSTRAINT "TransferCarton_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinStock" ADD CONSTRAINT "BinStock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinStock" ADD CONSTRAINT "BinStock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinMovement" ADD CONSTRAINT "BinMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinMovement" ADD CONSTRAINT "BinMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialMovement" ADD CONSTRAINT "SerialMovement_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "SerialNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
