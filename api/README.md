# Retail Inventory API

This project implements the core inventory backend for the retail inventory, blind counting, and inter-location transfer requirements described in the supplied BRD/TRD/UI documents.

## Included capability

- Role-aware location scoping
- Blind count validation for store users
- Stock variance calculation
- Transfer request validation for admin-only operations
- Prisma schema for inventory, location, item, lot, count, and transfer entities
- Express API sample endpoints for health, stock visibility, stock counts, and transfer requests

## Quick start

1. Copy .env.example to .env and configure your database connection.
2. Run the Prisma migration or schema push for your environment.
3. Start the API:

```bash
npm install
npm run build
npm start
```

## API examples

### Get health

```http
GET /health
```

### Get stock by location

```http
GET /api/v1/stock/loc-1
Header: x-role: STORE_USER
```

### Submit blind count

```http
POST /api/v1/stock-counts
Header: x-role: STORE_USER
{
  "itemId": "sku-001",
  "locationId": "loc-1",
  "physicalQuantity": 28,
  "lotNo": "LOT-1001",
  "mode": "scan"
}
```

### Create transfer request

```http
POST /api/v1/transfers
Header: x-role: ADMIN
{
  "sourceLocationId": "loc-1",
  "destinationLocationId": "wh-1",
  "lines": [
    { "itemId": "sku-001", "lotId": "lot-01", "quantity": 12 }
  ]
}
```
