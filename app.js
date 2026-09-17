// Hostinger often resolves the Entry file from the git repo root even when
// Application root is `api`. This file exists so Entry = app.js still boots
// the API. Prefer Application root `api` + Entry `app.js` when the panel allows it.
require('./api/app.js');
