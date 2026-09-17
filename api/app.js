// Keep this entry dependency-free so failures before Express loads are visible.
const { writeSync } = require('node:fs');
const started = Date.now();
const report = (stage, detail = '') => {
  writeSync(2, '[invexa-startup] ' + stage + ' ' + (Date.now() - started) + 'ms' + (detail ? ' ' + detail : '') + '\n');
};

function corsHeaders() {
  return {
    'content-type': 'application/json',
    'access-control-allow-origin': 'https://invexaretail.com',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

function startFallback(reason) {
  const http = require('node:http');
  const port = Number(process.env.PORT || 4000);
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    res.writeHead(503, corsHeaders());
    res.end(JSON.stringify({
      ok: false,
      service: 'retail-inventory-api',
      error: reason,
      hint: 'The Node process is up, but the API bundle did not load. Open Runtime logs and search for [invexa-startup].',
    }));
  });
  server.listen(port, () => {
    report('FALLBACK_LISTEN', 'port=' + port + ' reason=' + reason);
  });
}

report('ENTRY_STARTED', 'node=' + process.version);
let entry;
try {
  entry = require.resolve('./dist/index.js');
} catch {
  report('BUILD_OUTPUT_MISSING', 'Build must generate api/dist/index.js before startup.');
  startFallback('BUILD_OUTPUT_MISSING');
}

if (entry) {
  report('BUILD_OUTPUT_FOUND');
  try {
    require(entry);
    report('MODULES_LOADED');
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : 'MODULE_INITIALIZATION_FAILED';
    const missing = typeof error?.message === 'string'
      ? error.message.match(/Cannot find module ['"]([@a-zA-Z0-9_./-]+)['"]/)?.[1] : undefined;
    report('STARTUP_FAILED', code + (missing ? ' module=' + missing : ''));
    startFallback(code);
  }
}
