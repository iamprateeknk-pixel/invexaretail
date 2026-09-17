export function isControlPlaneHash(hash = globalThis.location?.hash ?? '') {
  return String(hash).replace(/^#\/?/, '').startsWith('control');
}

export function isControlPlaneDeployment(env = import.meta.env) {
  return String(env?.VITE_APP_MODE || '').toLowerCase() === 'control';
}

export function isControlPlaneRoute(
  hash = globalThis.location?.hash ?? '',
  pathname = globalThis.location?.pathname ?? '/',
  env = import.meta.env,
) {
  if (isControlPlaneDeployment(env)) return true;
  const path = String(pathname).replace(/\/+$/, '') || '/';
  if (path === '/control') return true;
  return isControlPlaneHash(hash);
}
