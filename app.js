// Repo-root entry: lets a platform that resolves the entry file from the git
// repo root (instead of `api`) still boot the API. Prefer Application root
// `api` + Entry `app.js` when the platform allows it.
require('./api/app.js');
