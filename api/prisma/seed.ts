import bcrypt from 'bcryptjs';
import { PrismaClient, Role, TransferStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const locations = [
  { id: 'loc-1', code: 'MAIN-STORE', name: 'Main Store', type: 'store' },
  { id: 'loc-2', code: 'BRANCH-STORE', name: 'Branch Store', type: 'store' },
  { id: 'wh-1', code: 'CENTRAL-WH', name: 'Warehouse', type: 'warehouse' },
];

const items = [
  { id: 'item-1001', code: 'SKU-1001', name: 'Rice 5kg', category: 'Staples', unit: 'bag', lotId: 'lot-1001', lotNo: 'LOT-01', expiryDate: new Date('2027-12-31') },
  { id: 'item-1002', code: 'SKU-1002', name: 'Milk 1L', category: 'Dairy', unit: 'pack', lotId: 'lot-1002', lotNo: 'LOT-02', expiryDate: new Date('2026-12-15') },
  { id: 'item-1003', code: 'SKU-1003', name: 'Soap 200g', category: 'Household', unit: 'box', lotId: 'lot-1003', lotNo: 'LOT-03', expiryDate: new Date('2027-03-15') },
];

const users = [
  { id: 'user-admin-1', email: 'admin@retail.local', name: 'Admin User', role: Role.ADMIN, assignedLocations: ['loc-1', 'loc-2', 'wh-1'] },
  { id: 'user-manager-1', email: 'manager@retail.local', name: 'Branch Manager', role: Role.BRANCH_MANAGER, assignedLocations: ['loc-1'] },
  { id: 'user-store-1', email: 'store@retail.local', name: 'Store User', role: Role.STORE_USER, assignedLocations: ['loc-1'] },
  { id: 'user-picker-1', email: 'picker@retail.local', name: 'Warehouse Picker', role: Role.WAREHOUSE_PICKER, assignedLocations: ['wh-1'] },
  { id: 'user-auditor-1', email: 'auditor@retail.local', name: 'Auditor User', role: Role.AUDITOR, assignedLocations: ['loc-1'] },
];

async function main() {
  const passwordHash = await bcrypt.hash(process.env.SEED_PASSWORD ?? 'ChangeMe123!', 12);

  for (const location of locations) {
    await prisma.location.upsert({ where: { id: location.id }, update: location, create: location });
  }

  for (const item of items) {
    await prisma.item.upsert({
      where: { id: item.id },
      update: { code: item.code, name: item.name, category: item.category, unit: item.unit },
      create: { id: item.id, code: item.code, name: item.name, category: item.category, unit: item.unit },
    });
    await prisma.lot.upsert({
      where: { id: item.lotId },
      update: { lotNo: item.lotNo, expiryDate: item.expiryDate },
      create: { id: item.lotId, itemId: item.id, lotNo: item.lotNo, expiryDate: item.expiryDate, attributes: { source: 'seed' } },
    });
  }

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { name: user.name, email: user.email, role: user.role, assignedLocations: JSON.stringify(user.assignedLocations), passwordHash },
      create: { id: user.id, name: user.name, email: user.email, role: user.role, assignedLocations: JSON.stringify(user.assignedLocations), passwordHash },
    });
  }

  const stock = [
    ['item-1001', 'lot-1001', 'loc-1', 28],
    ['item-1001', 'lot-1001', 'wh-1', 40],
    ['item-1002', 'lot-1002', 'loc-1', 26],
    ['item-1002', 'lot-1002', 'loc-2', 26],
    ['item-1003', 'lot-1003', 'wh-1', 80],
  ] as const;

  for (const [itemId, lotId, locationId, onHand] of stock) {
    await prisma.stockLedger.upsert({
      where: { itemId_lotId_locationId: { itemId, lotId, locationId } },
      update: { onHand, reserved: 0, inTransit: 0 },
      create: { itemId, lotId, locationId, onHand, reserved: 0, inTransit: 0 },
    });
  }

  await prisma.stockCount.upsert({
    where: { id: 'count-1' },
    update: { physicalQty: 28, mode: 'scan' },
    create: { id: 'count-1', itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', physicalQty: 28, mode: 'scan', submittedById: 'user-store-1' },
  });
  await prisma.stockCount.upsert({
    where: { id: 'count-2' },
    update: { physicalQty: 26, mode: 'manual' },
    create: { id: 'count-2', itemId: 'item-1002', lotId: 'lot-1002', locationId: 'loc-2', physicalQty: 26, mode: 'manual', submittedById: 'user-store-1' },
  });

  await prisma.transfer.upsert({
    where: { id: 'transfer-1' },
    update: { status: TransferStatus.REQUESTED },
    create: {
      id: 'transfer-1', sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', requestedById: 'user-admin-1', status: TransferStatus.REQUESTED,
      lines: { create: [{ itemId: 'item-1001', lotId: 'lot-1001', requestedQty: 12 }] },
    },
  });
  await prisma.transfer.upsert({
    where: { id: 'transfer-2' },
    update: { status: TransferStatus.DISPATCHED },
    create: {
      id: 'transfer-2', sourceLocationId: 'wh-1', destinationLocationId: 'loc-2', requestedById: 'user-admin-1', status: TransferStatus.DISPATCHED,
      lines: { create: [{ itemId: 'item-1003', lotId: 'lot-1003', requestedQty: 18 }] },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
