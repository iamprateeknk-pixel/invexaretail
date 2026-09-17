import { controlPlaneHtml, DEFAULT_API_BASE, DEFAULT_WEB_APP_URL } from './login-html.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: securityHeaders() });
    }
    if (url.pathname === '/health') {
      return Response.json(
        { ok: true, panel: 'control-plane' },
        { headers: securityHeaders() },
      );
    }

    const html = controlPlaneHtml(env?.VITE_API_BASE || DEFAULT_API_BASE, env?.VITE_WEB_APP_URL || DEFAULT_WEB_APP_URL);
    return new Response(html, {
      headers: {
        ...securityHeaders(),
        'content-type': 'text/html; charset=UTF-8',
      },
    });
  },
};

function securityHeaders() {
  return {
    'cache-control': 'no-store, no-cache, must-revalidate',
    'x-invexa-panel': 'control-plane',
  };
}
