import { useEffect, useState } from 'react';
import TransferEvidenceGallery from './components/TransferEvidenceGallery';
import ItemPhotoGallery from './components/ItemPhotoGallery';
import ItemSerialPanel from './components/ItemSerialPanel';
import ItemForecastPanel from './components/ItemForecastPanel';
import ItemPricingPanel from './components/ItemPricingPanel';
import ItemMasterPanel from './components/ItemMasterPanel';
import { LoginCard } from './components/auth/LoginCard';
import { ControlPlaneApp } from './control-plane/ControlPlaneApp';
import { isControlPlaneRoute } from './control-plane/control-route';
import { Workspace } from './components/workspace/Workspace';
import { WorkspaceChrome } from './components/workspace/WorkspaceChrome';
import { WorkspaceDialogs } from './components/workspace/WorkspaceDialogs';
import { WorkspaceProvider, useWorkspace } from './components/workspace/WorkspaceContext';
import { useWorkspaceApp } from './hooks/useWorkspaceApp';
import { API_BASE } from './lib/api-client';
import { Toaster } from '@/components/ui/sonner';

function useLocationHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  return hash;
}

function AppShell() {
  const {
    session,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginOtp,
    setLoginOtp,
    otpSent,
    otpNotice,
    devOtpCode,
    authError,
    authLoading,
    handleLogin,
    handleSendOtp,
    handleVerifyOtp,
    evidenceTransfer,
    authToken,
    role,
    setEvidenceTransfer,
    photoItem,
    setPhotoItem,
    serialItem,
    setSerialItem,
    forecastItem,
    setForecastItem,
    pricingItem,
    setPricingItem,
    masterDialog,
    setMasterDialog,
    setItems,
    locationId,
    twoFactorToken,
    twoFactorCode,
    setTwoFactorCode,
    handleVerifyTwoFactor,
    handlePasskeySignIn,
    cancelTwoFactor,
  } = useWorkspace();

  if (!session) {
    return (
      <LoginCard
        loginEmail={loginEmail}
        setLoginEmail={setLoginEmail}
        loginPassword={loginPassword}
        setLoginPassword={setLoginPassword}
        loginOtp={loginOtp}
        setLoginOtp={setLoginOtp}
        otpSent={otpSent}
        otpNotice={otpNotice}
        devOtpCode={devOtpCode}
        authError={authError}
        authLoading={authLoading}
        onPasswordSubmit={handleLogin}
        onSendOtp={handleSendOtp}
        onVerifyOtp={handleVerifyOtp}
        twoFactorPending={Boolean(twoFactorToken)}
        twoFactorCode={twoFactorCode}
        setTwoFactorCode={setTwoFactorCode}
        onVerifyTwoFactor={handleVerifyTwoFactor}
        onPasskeySignIn={() => handlePasskeySignIn()}
        onCancelTwoFactor={cancelTwoFactor}
      />
    );
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <Toaster richColors position="top-right" />
      {evidenceTransfer && (
        <TransferEvidenceGallery
          key={evidenceTransfer.id}
          transfer={evidenceTransfer}
          token={authToken}
          apiBase={API_BASE}
          canUpload={['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER'].includes(role)}
          onClose={() => setEvidenceTransfer(null)}
        />
      )}
      {photoItem && (
        <ItemPhotoGallery
          key={photoItem.id}
          item={photoItem}
          token={authToken}
          apiBase={API_BASE}
          canUpload={['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER'].includes(role)}
          onClose={() => setPhotoItem(null)}
        />
      )}
      {serialItem && (
        <ItemSerialPanel
          key={serialItem.id}
          item={serialItem}
          token={authToken}
          apiBase={API_BASE}
          canManage={['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER'].includes(role)}
          onClose={() => setSerialItem(null)}
        />
      )}
      {forecastItem && (
        <ItemForecastPanel
          key={forecastItem.id}
          item={forecastItem}
          token={authToken}
          locationId={locationId}
          role={role}
          onClose={() => setForecastItem(null)}
        />
      )}
      {pricingItem && (
        <ItemPricingPanel
          key={pricingItem.id}
          item={pricingItem}
          token={authToken}
          canManage={['ADMIN', 'ADMIN_USER'].includes(role)}
          onClose={() => setPricingItem(null)}
        />
      )}
      {masterDialog && (
        <ItemMasterPanel
          key={masterDialog.item?.id ?? masterDialog.mode}
          mode={masterDialog.mode}
          item={masterDialog.item}
          token={authToken}
          role={role}
          onItemsChanged={setItems}
          onClose={() => setMasterDialog(null)}
        />
      )}
      <WorkspaceChrome>
        <Workspace />
      </WorkspaceChrome>
      <WorkspaceDialogs />
    </div>
  );
}

function App() {
  const hash = useLocationHash();
  const workspace = useWorkspaceApp();
  if (isControlPlaneRoute(hash)) {
    return <ControlPlaneApp />;
  }
  return (
    <WorkspaceProvider value={workspace}>
      <AppShell />
    </WorkspaceProvider>
  );
}

export default App;
