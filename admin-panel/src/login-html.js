export const DEFAULT_API_BASE = 'https://invexaretail-api-production.up.railway.app';
export const DEFAULT_WEB_APP_URL = 'https://control.invexaretail.com';

export function controlPlaneHtml(apiBase = DEFAULT_API_BASE, webAppUrl = DEFAULT_WEB_APP_URL) {
  const safeApiBase = String(apiBase || DEFAULT_API_BASE).replace(/\/$/, '').replace(/</g, '');
  const safeWebAppUrl = String(webAppUrl || DEFAULT_WEB_APP_URL).replace(/\/$/, '').replace(/</g, '');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Invexa Retail Control Plane" />
    <title>Invexa Control Plane</title>
    <style>
      :root {
        --background: oklch(0.97 0.01 265);
        --foreground: oklch(0.21 0.03 265);
        --card: oklch(1 0 0);
        --muted: oklch(0.5 0.03 265);
        --primary: oklch(0.6 0.15 165);
        --primary-foreground: oklch(0.99 0.01 165);
        --border: oklch(0.91 0.01 265);
        --destructive: oklch(0.58 0.22 27);
        --radius: 12px;
        font-family: Inter, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      html, body, #root { min-height: 100%; margin: 0; }
      body { background: var(--background); color: var(--foreground); }
      .login-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .card {
        width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border);
        border-radius: var(--radius); box-shadow: 0 10px 30px rgb(15 23 42 / 6%); padding: 28px 24px;
      }
      .eyebrow { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      h2 { margin: 0 0 6px; font-size: 18px; }
      .lede { margin: 0 0 20px; font-size: 14px; line-height: 1.45; color: var(--muted); }
      form { display: grid; gap: 14px; }
      label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
      input {
        width: 100%; height: 40px; border: 1px solid var(--border); border-radius: 8px; padding: 0 12px;
        font: inherit; background: #fff; color: var(--foreground);
      }
      input:focus { outline: 3px solid color-mix(in oklch, var(--primary) 35%, white); border-color: var(--primary); }
      button {
        height: 40px; border: 0; border-radius: 8px; background: var(--primary); color: var(--primary-foreground);
        font: inherit; font-weight: 600; cursor: pointer;
      }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      button.secondary { background: transparent; color: var(--foreground); border: 1px solid var(--border); }
      .error {
        margin: 0; padding: 10px 12px; border-radius: 8px;
        border: 1px solid color-mix(in oklch, var(--destructive) 35%, white);
        background: color-mix(in oklch, var(--destructive) 8%, white); color: var(--destructive); font-size: 13px;
      }
      .panel { min-height: 100vh; padding: 32px 24px; }
      .panel-inner { max-width: 880px; margin: 0 auto; display: grid; gap: 20px; }
      .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
      .companies { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .company { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; display: grid; gap: 12px; }
      .company p { margin: 0; color: var(--muted); font-size: 13px; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body data-invexa="control-plane">
    <div id="root">
      <main class="login-shell" id="login-view">
        <section class="card">
          <p class="eyebrow">Invexa Platform</p>
          <h1>Control Plane</h1>
          <p class="lede">Super Admin login. Company configuration requires a hard-locked session.</p>
          <form id="login-form">
            <label for="control-email">
              Email
              <input id="control-email" name="email" type="email" autocomplete="username" required value="superadmin@invexa.local" />
            </label>
            <label for="control-password">
              Password
              <input id="control-password" name="password" type="password" autocomplete="current-password" required />
            </label>
            <p class="error" id="login-error" role="alert" hidden></p>
            <button type="submit" id="sign-in">Sign in</button>
          </form>
        </section>
      </main>
      <main class="panel" id="company-view" hidden>
        <div class="panel-inner">
          <div class="row">
            <div>
              <p class="eyebrow">Platform Super Admin</p>
              <h1>Select one company</h1>
              <p class="lede">Lock a company session to manage users, studio, and billing.</p>
            </div>
            <button type="button" class="secondary" id="sign-out-companies">Sign out</button>
          </div>
          <p class="error" id="company-error" role="alert" hidden></p>
          <div class="companies" id="company-list"></div>
        </div>
      </main>
      <main class="panel" id="locked-view" hidden>
        <div class="panel-inner">
          <div class="row">
            <div>
              <p class="eyebrow">Control Plane</p>
              <h1>Redirecting…</h1>
              <p class="lede">Taking you to the Control Plane dashboard.</p>
            </div>
            <button type="button" class="secondary" id="sign-out-locked">Sign out</button>
          </div>
        </div>
      </main>
    </div>
    <script>
      const API_BASE = ${JSON.stringify(safeApiBase)};
      const WEB_APP_URL = ${JSON.stringify(safeWebAppUrl)};
      const STORAGE_KEY = "invexa_control_session";
      const loginView = document.getElementById("login-view");
      const companyView = document.getElementById("company-view");
      const lockedView = document.getElementById("locked-view");
      const loginForm = document.getElementById("login-form");
      const loginError = document.getElementById("login-error");
      const companyError = document.getElementById("company-error");
      const companyList = document.getElementById("company-list");
      const signInButton = document.getElementById("sign-in");
      const emailInput = document.getElementById("control-email");
      const passwordInput = document.getElementById("control-password");

      function readSession() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      }

      function writeSession(session) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        return session;
      }

      function clearSession() {
        localStorage.removeItem(STORAGE_KEY);
      }

      function showError(node, message) {
        if (!message) {
          node.hidden = true;
          node.textContent = "";
          return;
        }
        node.hidden = false;
        node.textContent = message;
      }

      async function controlRequest(path, { token, method = "GET", body } = {}) {
        const response = await fetch(API_BASE + path, {
          method,
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = await response.json().catch(function () { return {}; });
        if (!response.ok) {
          throw new Error(payload.error || payload.message || ("Request failed (" + response.status + ")"));
        }
        return payload;
      }

      function render(session) {
        const platformToken = session && session.platformToken;
        const controlToken = session && session.controlToken;
        if (controlToken) {
          lockedView.hidden = false;
          loginView.hidden = true;
          companyView.hidden = true;
          window.location.href = WEB_APP_URL + "/#/control?session=" + encodeURIComponent(JSON.stringify(session));
          return;
        }
        loginView.hidden = Boolean(platformToken);
        companyView.hidden = !platformToken;
        lockedView.hidden = true;
        if (platformToken) {
          const companies = (session && session.companies) || [];
          companyList.innerHTML = companies.map(function (entry) {
            const disabled = entry.status !== "active" ? "disabled" : "";
            return '<article class="company"><div><h2>' + escapeHtml(entry.name) + '</h2><p>' +
              escapeHtml(entry.id) + ' · ' + escapeHtml(entry.planId) + ' · ' + escapeHtml(entry.status) +
              '</p></div><button type="button" data-company-id="' + escapeHtml(entry.id) + '" ' + disabled +
              '>Lock session</button></article>';
          }).join("");
        }
      }

      function escapeHtml(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        signInButton.disabled = true;
        signInButton.textContent = "Signing in…";
        showError(loginError, "");
        try {
          const login = await controlRequest("/control/v1/auth/login", {
            method: "POST",
            body: { email: emailInput.value.trim().toLowerCase(), password: passwordInput.value },
          });
          writeSession({
            platformToken: login.token,
            user: login.user,
            companies: login.companies || [],
          });
          passwordInput.value = "";
          render(readSession());
        } catch (caught) {
          showError(loginError, caught instanceof Error ? caught.message : "Login failed");
        } finally {
          signInButton.disabled = false;
          signInButton.textContent = "Sign in";
        }
      });

      companyList.addEventListener("click", async function (event) {
        const button = event.target.closest("button[data-company-id]");
        if (!button) return;
        const session = readSession();
        showError(companyError, "");
        button.disabled = true;
        try {
          const selected = await controlRequest("/control/v1/sessions/select-company", {
            token: session.platformToken,
            method: "POST",
            body: { companyId: button.getAttribute("data-company-id") },
          });
          writeSession({
            ...session,
            controlToken: selected.token,
            company: selected.company,
            controlSession: selected.session,
          });
          render(readSession());
        } catch (caught) {
          showError(companyError, caught instanceof Error ? caught.message : "Company lock failed");
          button.disabled = false;
        }
      });

      function signOut() {
        clearSession();
        showError(loginError, "");
        showError(companyError, "");
        render(null);
      }

      document.getElementById("sign-out-companies").addEventListener("click", signOut);
      document.getElementById("sign-out-locked").addEventListener("click", signOut);
      render(readSession());
    </script>
  </body>
</html>`;
}
