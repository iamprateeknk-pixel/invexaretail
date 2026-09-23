# Full-history secret scan — 23 September 2026

Gitleaks scanned 66 commits (approximately 6.78 MB) with redaction enabled.

Initial result: three findings, all the same intentionally truncated JWT example in `API_DOCUMENTATION.md`. The current documentation now uses `<ACCESS_TOKEN>` / `$ACCESS_TOKEN`. A repository Gitleaks configuration narrowly allowlists only that exact historical fake token in that exact documentation path.

Final result: **no leaks found**.
