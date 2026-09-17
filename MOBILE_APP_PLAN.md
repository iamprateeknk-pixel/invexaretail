# 📱 Mobile App Architecture Plan

## Overview

React Native mobile app for iOS and Android with offline-first synchronization, barcode scanning, and camera integration.

---

## Tech Stack

### Core Framework
- **React Native**: Cross-platform development (iOS & Android)
- **Expo** (OR React Native CLI): Development and build tool
- **TypeScript**: Type safety
- **Redux Toolkit**: State management
- **React Query**: Server state management & caching
- **Axios**: HTTP client

### UI & Navigation
- **React Navigation**: App navigation
- **React Native Paper** OR **Native Base**: UI components
- **React Native Vector Icons**: Icons
- **React Native Linear Gradient**: Gradients

### Device Features
- **react-native-camera**: Camera access
- **react-native-barcode-scanner-universal**: Barcode scanning
- **react-native-sqlite-storage**: Offline database
- **NetInfo**: Network status detection
- **Geolocation**: GPS for location tracking

### Offline & Sync
- **WatermelonDB** OR **Realm**: Local database
- **Redux Persist**: Persist app state locally
- **Background Sync**: Queue operations when offline

### Testing & Quality
- **Jest**: Unit testing
- **Detox**: E2E testing
- **CodePush**: Hot code updates

---

## Project Structure

```
retail-inventory-mobile/
├── app.json                      # Expo configuration
├── package.json
├── tsconfig.json
├── src/
│   ├── api/
│   │   ├── client.ts            # Axios instance
│   │   ├── auth.ts              # Authentication APIs
│   │   ├── inventory.ts         # Inventory APIs
│   │   ├── transfers.ts         # Transfer APIs
│   │   └── sync.ts              # Sync management
│   ├── store/
│   │   ├── index.ts             # Redux store
│   │   ├── auth.ts              # Auth reducer
│   │   ├── inventory.ts         # Inventory reducer
│   │   ├── ui.ts                # UI state reducer
│   │   └── sync.ts              # Sync state reducer
│   ├── services/
│   │   ├── auth.service.ts      # Auth logic
│   │   ├── storage.service.ts   # Local storage
│   │   ├── sync.service.ts      # Offline sync
│   │   ├── camera.service.ts    # Camera operations
│   │   └── barcode.service.ts   # Barcode scanning
│   ├── screens/
│   │   ├── auth/
│   │   │   ├── LoginScreen.tsx
│   │   │   └── SplashScreen.tsx
│   │   ├── inventory/
│   │   │   ├── StockListScreen.tsx
│   │   │   ├── StockDetailScreen.tsx
│   │   │   ├── BlindCountScreen.tsx
│   │   │   └── ScanBarcodeScreen.tsx
│   │   ├── transfers/
│   │   │   ├── TransferListScreen.tsx
│   │   │   ├── CreateTransferScreen.tsx
│   │   │   ├── TransferDetailScreen.tsx
│   │   │   └── PickListScreen.tsx
│   │   ├── picker/
│   │   │   ├── PickTasksScreen.tsx
│   │   │   ├── PickDetailScreen.tsx
│   │   │   └── ScanPickScreen.tsx
│   │   ├── reports/
│   │   │   ├── ReportsScreen.tsx
│   │   │   ├── DashboardScreen.tsx
│   │   │   └── AuditScreen.tsx
│   │   └── settings/
│   │       ├── SettingsScreen.tsx
│   │       ├── ProfileScreen.tsx
│   │       └── SyncScreen.tsx
│   ├── components/
│   │   ├── common/
│   │   │   ├── Header.tsx
│   │   │   ├── Loading.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── Toast.tsx
│   │   │   └── Modal.tsx
│   │   ├── inventory/
│   │   │   ├── StockCard.tsx
│   │   │   ├── VarianceIndicator.tsx
│   │   │   └── StockForm.tsx
│   │   ├── forms/
│   │   │   ├── BlindCountForm.tsx
│   │   │   ├── TransferForm.tsx
│   │   │   ├── BarcodeInput.tsx
│   │   │   └── PhotoUpload.tsx
│   │   └── picker/
│   │       ├── PickTaskCard.tsx
│   │       ├── PickLineItem.tsx
│   │       └── PickSummary.tsx
│   ├── navigation/
│   │   ├── RootNavigator.tsx
│   │   ├── AuthNavigator.tsx
│   │   ├── AppNavigator.tsx
│   │   └── types.ts
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useInventory.ts
│   │   ├── useOfflineSync.ts
│   │   ├── useCamera.ts
│   │   └── useBarcode.ts
│   ├── utils/
│   │   ├── validation.ts
│   │   ├── formatting.ts
│   │   ├── date-utils.ts
│   │   ├── storage.ts
│   │   └── constants.ts
│   ├── types/
│   │   ├── api.ts
│   │   ├── models.ts
│   │   ├── errors.ts
│   │   └── navigation.ts
│   ├── config/
│   │   ├── api.config.ts
│   │   ├── theme.ts
│   │   └── constants.ts
│   └── App.tsx
├── e2e/                          # E2E tests
│   ├── firstTest.e2e.js
│   └── config.json
├── __tests__/                    # Unit tests
│   ├── services/
│   ├── utils/
│   └── components/
└── assets/
    ├── icons/
    ├── images/
    └── fonts/
```

---

## Key Features & Implementation

### 1. Authentication

**Login Screen**
```typescript
// LoginScreen.tsx
- Email/password input
- Remember me checkbox
- Offline mode option (demo login)
- Face ID / Biometric support
- Error handling & validation
```

**JWT Token Management**
```typescript
// auth.service.ts
- Store token in secure storage (Keychain/Keystore)
- Auto-refresh token before expiry
- Logout on token expiration
- Role-based access control
```

### 2. Stock & Inventory Management

**Stock List Screen**
```typescript
Features:
- List all stocks for assigned location
- Role-based filtering (STORE_USER sees limited data)
- Search & filter by item code, name
- Swipe actions (blind count, transfer)
- Pull-to-refresh
- Offline indicator
```

**Blind Count Screen**
```typescript
Features:
- Form to submit physical count
- Barcode scanner integration
- Lot number tracking
- Quantity input with validation
- Photo evidence upload (optional)
- Variance calculation (server-side)
- Offline queue (syncs when online)
```

### 3. Transfer Management

**Create Transfer Screen**
```typescript
Features:
- Source & destination location selection
- Item picker with search
- Quantity input
- Lot selection
- Notes/comments
- Submit for approval (ADMIN role)
- Track transfer status
```

**Picker Tasks Screen**
```typescript
Features:
- List assigned pick tasks
- Real-time status updates
- Barcode scanning for lot validation
- Quantity confirmation
- Damage reporting
- Photo evidence upload
- Mark as picked
- Sync with server
```

### 4. Barcode Scanning

```typescript
// BarcodeScanner component
- Real-time camera preview
- Barcode detection (Code128, EAN13, QR, etc.)
- Auto-fill form fields
- Duplicate prevention
- Vibration feedback
- Flashlight toggle
```

### 5. Camera & Evidence

```typescript
// Camera Service
- Capture photos for evidence
- Compress images before upload
- Metadata attachment (timestamp, location)
- Gallery integration
- Cloud upload with retry
```

### 6. Offline-First Architecture

**Local Storage**
```typescript
// WatermelonDB setup
- Mirror server data structures locally
- Automatic synchronization
- Conflict resolution
- Data consistency
```

**Sync Service**
```typescript
Features:
- Queue operations when offline
- Background sync when online
- Conflict detection & resolution
- Batch sync for performance
- Sync status indicator
- Manual sync trigger
```

### 7. UI/UX Design

**Theme & Colors**
```typescript
- Dark theme with blue accents
- Large touch targets (48px minimum)
- High contrast for readability
- Accessibility support (WCAG AA)
```

**Navigation**
```typescript
- Bottom tab navigation (Inventory, Transfers, Reports, Settings)
- Stack navigation per tab
- Deep linking support
- Gesture-based navigation
```

### 8. State Management

**Redux Store Structure**
```typescript
{
  auth: {
    user: User | null,
    token: string | null,
    loading: boolean,
    error: string | null,
  },
  inventory: {
    stocks: Stock[],
    counts: StockCount[],
    loading: boolean,
  },
  transfers: {
    transfers: Transfer[],
    pickerTasks: PickerTask[],
    loading: boolean,
  },
  sync: {
    isOnline: boolean,
    pendingOperations: Operation[],
    lastSync: Date | null,
    syncing: boolean,
  },
  ui: {
    activeTab: string,
    notifications: Toast[],
  }
}
```

---

## Development Phases

### Phase 1: Setup & Auth (1-2 weeks)
- [ ] Create React Native project with Expo
- [ ] Setup Redux & RTK Query
- [ ] Implement authentication screens
- [ ] Configure API client
- [ ] Setup local storage

### Phase 2: Core Features (2-3 weeks)
- [ ] Inventory list screens
- [ ] Blind count functionality
- [ ] Transfer creation & tracking
- [ ] Basic forms & validation
- [ ] Offline state management

### Phase 3: Advanced Features (2-3 weeks)
- [ ] Barcode scanner integration
- [ ] Camera & photo upload
- [ ] Picker tasks workflow
- [ ] Offline-first synchronization
- [ ] Real-time updates via WebSocket

### Phase 4: Polish & Testing (1-2 weeks)
- [ ] UI/UX refinements
- [ ] Performance optimization
- [ ] Unit & E2E testing
- [ ] Error handling & edge cases
- [ ] Accessibility audit

### Phase 5: Release (1 week)
- [ ] App signing & provisioning
- [ ] TestFlight/Internal Testing
- [ ] Submit to App Store & Google Play
- [ ] Monitor for issues

---

## API Integration

### Authentication
```typescript
POST /api/v1/login
- email, password
- Returns: token, user, assignedLocationIds
```

### Inventory
```typescript
GET /api/v1/stock/:locationId
- Returns: [{ itemId, physicalQty, bookQty, variance }]

POST /api/v1/stock-counts
- itemId, lotNo, physicalQuantity, locationId, mode
- Returns: count record

GET /api/v1/counts
- Returns: [{ id, itemId, qty, status }]
```

### Transfers
```typescript
POST /api/v1/transfers
- sourceLocationId, destinationLocationId, lines[]
- Returns: transfer record

GET /api/v1/transfers/list
- Returns: [transfer records]

GET /api/v1/picker-tasks
- Returns: [{ transferId, lines, status }]

PATCH /api/v1/transfers/:id/status
- status (PICKED, DISPATCHED, RECEIVED)
```

---

## Performance Optimization

1. **Image Optimization**
   - Compress photos before upload
   - Lazy load images
   - Use WebP format

2. **Bundle Size**
   - Code splitting
   - Remove unused packages
   - Optimize dependencies

3. **Caching**
   - Cache API responses
   - Persist important data locally
   - Invalidate cache strategically

4. **Network**
   - Batch API requests
   - Implement exponential backoff
   - Handle slow/flaky networks gracefully

---

## Testing Strategy

### Unit Tests
```typescript
- Utility functions
- Reducers
- Services
- API integration (mocked)
```

### Integration Tests
```typescript
- Full workflows
- Auth flows
- Data synchronization
- Error scenarios
```

### E2E Tests
```typescript
- User login
- Submit blind count
- Create transfer
- Complete picker task
- Offline sync
```

---

## Deployment

### iOS
- Requires Apple Developer account ($99/year)
- Xcode build & signing
- TestFlight for beta testing
- App Store submission

### Android
- Google Play Developer account ($25 one-time)
- Keystore generation & signing
- Internal testing on Play Console
- Google Play submission

### Continuous Delivery
- GitHub Actions for automated builds
- Automated testing on every commit
- CodePush for hot updates
- Version management & release notes

---

## Security Considerations

- [ ] Secure storage for JWT tokens
- [ ] Certificate pinning for API calls
- [ ] Encryption for sensitive data
- [ ] Biometric authentication
- [ ] App integrity verification
- [ ] Code obfuscation
- [ ] Regular security audits

---

## Resources & Packages

```json
{
  "dependencies": {
    "react-native": "0.73.x",
    "react-native-paper": "^5.x",
    "react-navigation": "^6.x",
    "@reduxjs/toolkit": "^1.9.x",
    "react-query": "^3.x",
    "axios": "^1.x",
    "react-native-camera": "^4.x",
    "react-native-barcode-scanner-universal": "^1.x",
    "react-native-sqlite-storage": "^6.x",
    "realm": "^12.x",
    "redux-persist": "^6.x"
  }
}
```

---

## Timeline

- **Phase 1-2**: 4 weeks
- **Phase 3-4**: 4 weeks
- **Phase 5**: 1 week
- **Total**: 9 weeks (~2 months)

---

## Success Metrics

- [ ] Sub-2 second app launch
- [ ] 95%+ offline functionality
- [ ] Zero data loss during sync
- [ ] <100MB app bundle size
- [ ] 4.5+ rating on app stores
- [ ] <1% crash rate
- [ ] 99% API uptime

---

**Last Updated**: 2026-09-08

