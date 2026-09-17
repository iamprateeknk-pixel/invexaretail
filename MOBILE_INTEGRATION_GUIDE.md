# Mobile App Integration Guide

## Overview

The InvexaRetail Flutter mobile app is a complete cross-platform client for Android and iOS that implements all key features of the retail inventory management system with offline-first architecture.

## Architecture

### Client-Server Communication

```
Mobile App (Flutter)
    ↓↓↓ (HTTP/REST)
Backend API (Node.js/Express)
    ↓↓↓ (SQL)
PostgreSQL Database
```

### Offline-First Architecture

```
User Action
    ↓
Check Network
    ├─ Online → Send to Server + Cache
    └─ Offline → Cache + Queue for Sync
         ↓
    Monitor Network
         ↓
    Back Online → Auto Sync Queue
         ↓
    Sync Complete → Notify User
```

## Key Components

### 1. Authentication (`auth_provider.dart`)

**Flow:**
1. User enters email/password on login screen
2. ApiClient sends credentials to `/api/v1/login`
3. Server returns JWT token + user info
4. Token saved to Hive (secure local storage)
5. Token automatically added to all subsequent requests

**Features:**
- Secure token storage
- Auto token inclusion in headers
- Session persistence on app restart
- Logout clears token and local data

### 2. Inventory Management (`inventory_provider.dart`)

**Stock Management:**
- GET `/api/v1/stock/:locationId` → List stock by location
- Data cached locally → Works offline
- Pull-to-refresh updates cache

**Stock Counts:**
- GET `/api/v1/counts` → Get all counts
- POST `/api/v1/stock-counts` → Submit new count
- Offline: Queued in Hive sync queue
- When online: Auto-synced, max 3 retries

**Transfers:**
- GET `/api/v1/transfers/list` → Get all transfers
- Data cached for offline access
- Real-time polling every 12 seconds (web app)

### 3. Local Storage (`local_storage.dart`)

Uses Hive for offline data persistence:

```
Boxes:
├── auth          → Token, user info
├── stock         → Cached stock levels
├── counts        → Cached stock counts
├── transfers     → Cached transfers
├── sync_queue    → Pending actions (offline)
└── cache         → Generic cache
```

### 4. Sync Queue

**When Action Fails (Offline):**
```dart
// In api_client.dart - catch block
if (!navigator.onLine) {
  await addSyncAction({
    type: 'count',
    endpoint: '/api/v1/stock-counts',
    method: 'POST',
    data: submission.toJson(),
  });
  throw Error('Offline: Action queued for sync');
}
```

**When Back Online:**
```dart
// In auth_provider.dart - window 'online' event
const handleOnline = async () => {
  const pendingActions = await getPendingSyncActions();
  
  for (action of pendingActions) {
    if (action.retries > 3) continue;  // Give up after 3 retries
    
    try {
      response = await fetch(action.endpoint, {
        method: action.method,
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(action.data)
      });
      
      if (response.ok) {
        await removeSyncAction(action.id);
      } else {
        await updateSyncActionRetries(action.id, action.retries + 1);
      }
    } catch (error) {
      await updateSyncActionRetries(action.id, action.retries + 1);
    }
  }
};
```

## API Endpoints Used

### Authentication
```
POST /api/v1/login
├─ Request: { email, password }
└─ Response: { token, user: { id, email, role, name } }
```

### Locations
```
GET /api/v1/locations
└─ Response: { locations: [{ id, name, type }, ...] }
```

### Items & Inventory
```
GET /api/v1/items
└─ Response: { items: [{ id, name, sku, lots: [{ id, lotNo, expiryDate, quantity }] }, ...] }

GET /api/v1/stock/:locationId
└─ Response: { items: [{ itemId, itemName, locationId, bookQuantity, physicalQuantity, variance, stockValue }, ...] }

POST /api/v1/stock-counts
├─ Request: { itemId, locationId, physicalQuantity, lotNo, mode }
└─ Response: { id, itemId, item, lot, locationId, qty, mode, user, status }
```

### Counts
```
GET /api/v1/counts
└─ Response: { counts: [{ id, itemId, item, lot, locationId, qty, mode, user, status }, ...] }
```

### Transfers
```
GET /api/v1/transfers/list
└─ Response: { transfers: [{ id, from, to, item, qty, status, requestedBy, fromName, toName }, ...] }
```

### Dashboard
```
GET /api/v1/dashboard
└─ Response: { 
    dashboard: { 
      totalItems, 
      varianceItems, 
      variancePercentage, 
      pendingCounts, 
      inTransitTransfers 
    } 
  }
```

### Export/Import
```
GET /api/v1/export/stock
└─ Response: CSV file (stock levels)

GET /api/v1/export/counts
└─ Response: CSV file (counts with variance)
```

## State Management (Riverpod)

### Providers Structure

```
AuthNotifier
├─ State: User? (null when logged out)
├─ Methods:
│  ├─ login(email, password)
│  └─ logout()
└─ Depends on: ApiClient

InventoryProviders
├─ StockNotifier(locationId)
│  ├─ State: List<StockRow>
│  └─ Methods: refresh()
├─ CountsNotifier
│  ├─ State: List<StockCount>
│  └─ Methods: refresh(), submitCount()
├─ TransfersNotifier
│  ├─ State: List<Transfer>
│  └─ Methods: refresh()
├─ DashboardNotifier
│  ├─ State: Dashboard
│  └─ Methods: refresh()
└─ SyncQueueNotifier
   ├─ State: List<SyncAction>
   └─ Methods: processSyncQueue()
```

### Usage in Widgets

```dart
// Watch a provider
final stock = ref.watch(stockNotifierProvider('loc-1'));

// Read a provider (no listening)
final client = ref.read(apiClientProvider);

// Refresh data
await ref.refresh(stockNotifierProvider('loc-1').future);

// Handle async data
stock.when(
  data: (items) => Text('${items.length} items'),
  loading: () => CircularProgressIndicator(),
  error: (err, stack) => Text('Error: $err'),
)
```

## UI Screens

### LoginScreen
- Email/password input
- Error handling & validation
- Demo credentials display
- Loading state with spinner

### DashboardScreen
- Metrics cards (total items, variance, pending, in transit)
- Pending counts list with status
- Active transfers list
- Pull-to-refresh for all data
- Offline indicator

### (Future Screens)
- **StockListScreen**: Browse stock by location, search
- **CountSubmissionScreen**: Submit blind counts with camera/barcode
- **TransferScreen**: Create and track transfers
- **PickerTasksScreen**: Warehouse picking workflow
- **SettingsScreen**: App configuration, sync status

## Data Caching Strategy

### Cache-First (Static Assets)
- Item catalog (updated rarely)
- Location list (updated rarely)

### Network-First (Dynamic Data)
- Stock levels (changes frequently)
- Counts (real-time updates)
- Transfers (status changes)
- Dashboard (real-time metrics)

**Cache Policy:**
- On successful fetch: Update cache + return data
- On fetch failure & offline: Return cached data
- Offline actions: Queue for sync when back online

## Network Handling

### Connectivity Detection

```dart
// In app, via connectivity_plus package
final connectivity = ref.watch(connectivityProvider);

connectivity.when(
  data: (connectivityStatus) {
    if (connectivityStatus == ConnectivityResult.none) {
      // Show offline mode banner
    }
  },
  // ...
)
```

### Retry Logic

**Configuration:**
- Max retries per action: 3
- Exponential backoff: Not implemented yet (future)
- Timeout: 30 seconds per request

**Process:**
1. First attempt (immediate)
2. Retry 1 (stored with retries=1)
3. Retry 2 (stored with retries=2)
4. Retry 3 (stored with retries=3)
5. Give up (action stays in queue)

## Security Considerations

### Token Management
- Stored in Hive with encryption support
- Automatically cleared on logout
- Not logged or exposed in debugging

### Data Transmission
- HTTPS/TLS enforced in production
- JWT Bearer token in Authorization header
- No sensitive data in logs

### Local Storage
- Hive uses encrypted storage on iOS/Android
- Sync queue cleaned up after successful sync
- Token cleared on logout

## Offline Workflow Example

### Scenario: Submit Count While Offline

1. **User submits count:**
```dart
await ref.read(countsNotifierProvider.notifier).submitCount(
  CountSubmission(
    itemId: 'item-123',
    locationId: 'loc-1',
    physicalQuantity: 50,
    lotNo: 'LOT-001',
    mode: 'scan',
  ),
);
```

2. **ApiClient detects offline:**
```dart
// In apiRequest catch block
if (!navigator.onLine && method in ['POST', 'PUT', 'PATCH']) {
  await addSyncAction({
    type: 'count',
    endpoint: '/api/v1/stock-counts',
    method: 'POST',
    data: submission.toJson(),
  });
}
```

3. **Action stored in sync queue:**
```dart
// In Hive sync_queue box
{
  'id': '1694272800000_abc123',
  'action': 'count',
  'endpoint': '/api/v1/stock-counts',
  'data': '{...submission...}',
  'timestamp': '2024-09-09T12:00:00Z',
  'retries': 0,
}
```

4. **User goes back online:**
- System detects connectivity change
- Triggers sync queue processing
- Sends queued count to API
- On success: Removes from queue, shows notification
- On failure: Increments retries, keeps in queue

5. **User sees status:**
- "Count submitted" notification when online
- "Count queued for sync" notification when offline
- "Sync in progress..." during reconnection

## Performance Metrics

### Target Metrics
- App launch: <2 seconds
- Screen transition: <500ms
- List rendering: 60 FPS
- Offline mode: <100ms delay
- Sync queue processing: <5 seconds for 10 actions

### Optimization Strategies
- Lazy load images
- Pagination for long lists
- Provider invalidation only when needed
- Efficient state updates with Riverpod

## Error Handling

### Common Errors

| Error | Cause | Handling |
|-------|-------|----------|
| 401 Unauthorized | Token expired/invalid | Redirect to login |
| 403 Forbidden | User lacks permission | Show error message |
| 404 Not Found | Endpoint invalid | Check API version |
| 500 Server Error | Backend error | Retry, show error |
| Network Error | No connectivity | Queue for sync |
| Timeout | Slow network | Retry with backoff |

### Error Messages
- User-friendly error messages shown in Snackbars
- Technical errors logged to console
- No sensitive data in error UI

## Testing

### Unit Tests
```bash
flutter test
```

### Integration Tests (Planned)
- Login flow
- Stock submission offline/online
- Sync queue processing
- Network error recovery

### Manual Testing Checklist
- [ ] Login/logout works
- [ ] Dashboard loads data
- [ ] Offline mode works
- [ ] Sync queue processes
- [ ] Pull-to-refresh updates
- [ ] Error messages display
- [ ] Token persists on restart

## Deployment

### Android
```bash
flutter build apk --release
# Upload to Google Play Store
```

### iOS
```bash
flutter build ios --release
# Submit to App Store via Xcode
```

### Environment Configuration
```bash
flutter run --dart-define=API_BASE_URL=https://api.invexaretail.com
```

## Troubleshooting

### App won't build
```bash
flutter clean
flutter pub get
flutter pub run build_runner build
flutter run
```

### Packages missing
```bash
flutter pub get
```

### Models not syncing
```bash
# Regenerate JSON serialization
flutter pub run build_runner build --delete-conflicting-outputs
```

### Connectivity issues
- Check API_BASE_URL in main.dart
- Verify network permissions in AndroidManifest.xml
- Check iOS network security settings

## Future Enhancements

1. **Biometric Authentication**
   - Fingerprint/Face ID login
   - Secure token refresh

2. **Barcode/QR Scanning**
   - mobile_scanner integration
   - Real-time batch processing
   - Barcode format validation

3. **Photo Evidence**
   - Camera integration for transfers
   - Image compression
   - Cloud upload with progress

4. **Push Notifications**
   - Firebase Cloud Messaging
   - Real-time transfer status
   - Urgent alerts

5. **Reporting & Analytics**
   - Export reports to PDF
   - Charts & visualizations
   - Performance metrics

6. **Advanced Sync**
   - Conflict resolution
   - Multi-user collaboration
   - Change tracking

7. **Performance**
   - Code splitting
   - Lazy loading
   - Image optimization

---

**Integration Status**: Complete for Core Features
**Last Updated**: 2024-09-09
**Maintained By**: InvexaRetail Development Team
