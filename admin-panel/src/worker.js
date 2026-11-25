import { controlPlaneHtml, PanelConfigurationError, panelOrigins } from './login-html.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: securityHeaders() });
    }
    const health = url.pathname === '/health';
    try {
      if (health) {
        panelOrigins(env?.VITE_API_BASE, env?.VITE_WEB_APP_URL);
        return Response.json({ ok: true, panel: 'control-plane' }, { headers: securityHeaders() });
      }
      return new Response(controlPlaneHtml(env?.VITE_API_BASE, env?.VITE_WEB_APP_URL), {
        headers: { ...securityHeaders(), 'content-type': 'text/html; charset=UTF-8' },
      });
    } catch (error) {
      if (!(error instanceof PanelConfigurationError)) throw error;
      const options = { status: 503, headers: securityHeaders() };
      if (health) return Response.json({ ok: false, panel: 'control-plane' }, options);
      return new Response('Control Plane is temporarily unavailable. Contact your administrator.', options);
    }
  },
};

function securityHeaders() {
  return {
    'cache-control': 'no-store, no-cache, must-revalidate',
    'x-invexa-panel': 'control-plane',
  };
}
