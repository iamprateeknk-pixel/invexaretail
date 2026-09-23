# 📚 API Documentation

## Retail Inventory Warehouse Transfer API

Base URL: `http://localhost:4000/api/v1`  
Production: `https://your-domain.com/api/v1`

---

## Authentication

All endpoints (except `/login`) require JWT token in Authorization header:

```
Authorization: Bearer <JWT_TOKEN>
```

### Login

**Endpoint:** `POST /login`

Request:
```json
{
  "email": "admin@retail.local",
  "password": "ChangeMe123!"
}
```

Response (200):
```json
{
  "token": "<ACCESS_TOKEN>",
  "user": {
    "id": "user-1",
    "email": "admin@retail.local",
    "role": "ADMIN",
    "assignedLocationIds": ["loc-1", "loc-2", "wh-1"]
  }
}
```

**Roles:**
- `ADMIN`: Full system access, approves counts, manages transfers
- `STORE_USER`: Can submit blind counts, initiate transfers
- `WAREHOUSE_PICKER`: Can pick items, confirm receipts
- `AUDITOR`: Read-only access, audit reports

---

## Location Management

### List Locations

**Endpoint:** `GET /locations`

Response (200):
```json
{
  "locations": [
    {
      "id": "loc-1",
      "code": "ST-001",
      "name": "Downtown Store",
      "type": "store"
    },
    {
      "id": "wh-1",
      "code": "WH-001",
      "name": "Central Warehouse",
      "type": "warehouse"
    }
  ],
  "activeLocationId": "loc-1"
}
```

---

## Stock Management

### Get Stock by Location

**Endpoint:** `GET /stock/:locationId`

Parameters:
- `locationId` (path): Location ID

Response (200):
```json
{
  "locationId": "loc-1",
  "items": [
    {
      "itemId": "sku-001",
      "locationId": "loc-1",
      "itemName": "Premium Rice 5kg",
      "physicalQuantity": 41,
      "bookQuantity": 45,
      "variance": -4,
      "stockValue": 1325
    }
  ]
}
```

**Access Control:**
- `STORE_USER`: Only sees `physicalQuantity`
- `ADMIN`, `AUDITOR`: See all fields
- `WAREHOUSE_PICKER`: Sees assigned locations only

---

## Blind Count Operations

### Submit Stock Count

**Endpoint:** `POST /stock-counts`

Request:
```json
{
  "itemId": "sku-001",
  "locationId": "loc-1",
  "lotNo": "LOT-331",
  "physicalQuantity": 41,
  "mode": "scan"
}
```

Response (201):
```json
{
  "success": true,
  "count": {
    "id": "count-001",
    "itemId": "sku-001",
    "lotId": "LOT-331",
    "locationId": "loc-1",
    "physicalQuantity": 41,
    "mode": "scan",
    "variance": -4,
    "submittedBy": "user-1",
    "createdAt": "2026-09-08T10:30:00Z"
  }
}
```

**Validation Rules:**
- `STORE_USER` and `WAREHOUSE_PICKER` can submit counts
- `ADMIN` cannot submit (can only review)
- Must have access to the location

---

### Get Counts

**Endpoint:** `GET /counts`

Query Parameters:
- `locationId` (optional): Filter by location
- `status` (optional): PENDING_REVIEW, APPROVED, REJECTED

Response (200):
```json
{
  "counts": [
    {
      "id": "count-101",
      "itemId": "sku-001",
      "item": "Premium Rice 5kg",
      "lotId": "lot-1",
      "lot": "LOT-331",
      "locationId": "loc-1",
      "locationName": "Downtown Store",
      "physicalQuantity": 41,
      "mode": "manual",
      "submittedBy": "Store User A",
      "status": "PENDING_REVIEW",
      "createdAt": "2026-09-08T10:30:00Z",
      "variance": -4
    }
  ]
}
```

---

### Review Count

**Endpoint:** `PATCH /stock-counts/:countId/review`

Parameters:
- `countId` (path): Count ID

Request:
```json
{
  "status": "APPROVED"
}
```

Response (200):
```json
{
  "success": true,
  "count": {
    "id": "count-101",
    "status": "APPROVED",
    "approvedBy": "admin-1",
    "approvedAt": "2026-09-08T11:00:00Z"
  }
}
```

**Requirements:**
- Only `ADMIN` role can review
- Status must be `APPROVED` or `REJECTED`

---

## Transfer Management

### Create Transfer Request

**Endpoint:** `POST /transfers`

Request:
```json
{
  "sourceLocationId": "loc-1",
  "destinationLocationId": "wh-1",
  "lines": [
    {
      "itemId": "sku-001",
      "lotId": "lot-01",
      "quantity": 12
    }
  ],
  "notes": "Stock replenishment"
}
```

Response (201):
```json
{
  "success": true,
  "transfer": {
    "id": "tr-001",
    "sourceLocationId": "loc-1",
    "sourceLocation": {
      "id": "loc-1",
      "name": "Downtown Store"
    },
    "destinationLocationId": "wh-1",
    "destinationLocation": {
      "id": "wh-1",
      "name": "Central Warehouse"
    },
    "status": "REQUESTED",
    "lines": [
      {
        "id": "line-001",
        "itemId": "sku-001",
        "lotId": "lot-01",
        "requestedQty": 12,
        "pickedQty": 0,
        "receivedQty": 0,
        "damagedQty": 0
      }
    ],
    "requestedBy": "user-1",
    "createdAt": "2026-09-08T10:30:00Z"
  }
}
```

**Rules:**
- `ADMIN` and `STORE_USER` can create transfers
- `STORE_USER` can only request from their assigned location
- `STORE_USER` can only request to warehouse destinations

---

### List Transfers

**Endpoint:** `GET /transfers/list`

Response (200):
```json
{
  "transfers": [
    {
      "id": "tr-001",
      "sourceLocationId": "loc-1",
      "destinationLocationId": "wh-1",
      "status": "REQUESTED",
      "lines": [
        {
          "itemId": "sku-001",
          "quantity": 12
        }
      ],
      "createdAt": "2026-09-08T10:30:00Z"
    }
  ]
}
```

---

### Update Transfer Status

**Endpoint:** `PATCH /transfers/:transferId/status`

Parameters:
- `transferId` (path): Transfer ID

Request:
```json
{
  "status": "PICKED"
}
```

Response (200):
```json
{
  "success": true,
  "transfer": {
    "id": "tr-001",
    "status": "PICKED",
    "updatedAt": "2026-09-08T11:00:00Z"
  }
}
```

**Status Workflow:**
```
REQUESTED → PICKED → DISPATCHED → RECEIVED → CLOSED
         ↓
      REJECTED (any time)
```

**Status Change Rules:**
- `ADMIN`: Can move from REQUESTED → PICKED, PICKED → DISPATCHED, DISPATCHED → RECEIVED
- `WAREHOUSE_PICKER`: Can move REQUESTED → PICKED
- `STORE_USER`: Can move DISPATCHED → RECEIVED
- Any role: Can reject at any point

---

### Upload Transfer Evidence

**Endpoint:** `POST /transfers/:transferId/evidence`

Parameters:
- `transferId` (path): Transfer ID

Multipart Form Data:
- `evidence` (file): Image/PDF file (max 10MB)

Response (201):
```json
{
  "success": true,
  "evidence": {
    "transferId": "tr-001",
    "fileName": "photo.jpg",
    "storedName": "uuid-uuid.jpg",
    "size": 256000,
    "mimeType": "image/jpeg"
  }
}
```

---

## Inventory Items

### List Items

**Endpoint:** `GET /items`

Response (200):
```json
{
  "items": [
    {
      "id": "item-001",
      "code": "SKU-001",
      "name": "Premium Rice 5kg",
      "category": "Food",
      "unit": "bags",
      "description": "High-quality rice",
      "lots": [
        {
          "id": "lot-001",
          "lotNo": "LOT-331",
          "expiryDate": "2027-12-31"
        }
      ]
    }
  ]
}
```

---

### Create Item

**Endpoint:** `POST /items`

Request:
```json
{
  "code": "SKU-999",
  "name": "New Item",
  "category": "Category",
  "unit": "units"
}
```

Response (201):
```json
{
  "success": true,
  "item": {
    "id": "item-999",
    "code": "SKU-999",
    "name": "New Item",
    "category": "Category",
    "unit": "units"
  }
}
```

---

### Bulk Import Items

**Endpoint:** `POST /imports/items`

Request:
```json
{
  "items": [
    { "code": "SKU-001", "name": "Item 1", "category": "Cat1", "unit": "pieces" },
    { "code": "SKU-002", "name": "Item 2", "category": "Cat2", "unit": "boxes" }
  ]
}
```

Response (201):
```json
{
  "success": true,
  "items": [...]
}
```

---

## Picker Tasks

### Get Picker Tasks

**Endpoint:** `GET /picker-tasks`

Response (200):
```json
{
  "tasks": [
    {
      "transferId": "tr-001",
      "locationId": "wh-1",
      "lines": [
        {
          "itemId": "sku-001",
          "lotId": "lot-01",
          "quantity": 12
        }
      ],
      "status": "ASSIGNED"
    }
  ]
}
```

---

### Complete Picker Task

**Endpoint:** `POST /picker-tasks/complete`

Request:
```json
{
  "transferId": "tr-001",
  "pickedQty": 12
}
```

Response (200):
```json
{
  "success": true,
  "result": {
    "transferId": "tr-001",
    "pickedQuantity": 12,
    "status": "PICKED"
  },
  "transfer": {
    "id": "tr-001",
    "status": "PICKED"
  }
}
```

---

## Dashboard & Reports

### Get Dashboard Summary

**Endpoint:** `GET /dashboard`

Response (200):
```json
{
  "dashboard": {
    "pendingCounts": 3,
    "approvedCounts": 8,
    "pendingTransfers": 2,
    "completedTransfers": 15,
    "discrepancyCount": 1,
    "avgVariance": 2.5
  }
}
```

---

### Get Location Report

**Endpoint:** `GET /reports/:locationId`

Response (200):
```json
{
  "report": {
    "locationId": "loc-1",
    "totalCounts": 10,
    "approvedCounts": 8,
    "rejectedCounts": 2,
    "totalTransfers": 5,
    "avgVariance": 1.8,
    "lastCountDate": "2026-09-08T10:30:00Z"
  }
}
```

---

## Audit & Logging

### Get Audit Log

**Endpoint:** `GET /audit`

Response (200):
```json
{
  "events": [
    {
      "id": "audit-001",
      "action": "STOCK_COUNT_SUBMITTED",
      "actorId": "user-1",
      "actorRole": "STORE_USER",
      "entityType": "StockCount",
      "entityId": "count-001",
      "createdAt": "2026-09-08T10:30:00Z"
    }
  ]
}
```

---

## Data Export

### Export Counts as CSV

**Endpoint:** `GET /exports/counts.csv`

Response: CSV file download
```csv
id,itemId,lotId,locationId,physicalQuantity,mode,status,createdAt
count-101,sku-001,lot-1,loc-1,41,manual,PENDING_REVIEW,2026-09-08T10:30:00Z
```

---

## Error Handling

### Error Response Format

```json
{
  "message": "Error description",
  "statusCode": 400,
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### HTTP Status Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 500 | Server Error |

---

## Rate Limiting

- **Limit**: 240 requests per minute per IP
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Pagination

Some endpoints support pagination:

```
GET /counts?limit=20&offset=0
```

Response includes:
```json
{
  "data": [...],
  "total": 100,
  "limit": 20,
  "offset": 0,
  "hasMore": true
}
```

---

## Testing Endpoints with cURL

### Login
```bash
curl -X POST http://localhost:4000/api/v1/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@retail.local",
    "password": "ChangeMe123!"
  }'
```

### Get Stock
```bash
curl -X GET http://localhost:4000/api/v1/stock/loc-1 \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Submit Count
```bash
curl -X POST http://localhost:4000/api/v1/stock-counts \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemId": "sku-001",
    "locationId": "loc-1",
    "lotNo": "LOT-331",
    "physicalQuantity": 41,
    "mode": "manual"
  }'
```

---

## Changelog

### v1.0.0 (2026-09-08)
- Initial API release
- Stock management
- Blind count workflow
- Transfer request system
- Audit logging
- Role-based access control

---

**Last Updated**: 2026-09-08
