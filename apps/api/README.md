# PhotoBunker Identity server — R2-03 only

This isolated Laravel 13 backend exposes only \`/identity/v2/*\`. It contains no Photo, S3, Matrix or Messenger runtime.

Codex prepares the environment and installs dependencies before testing:

- PHP 8.4, extensions openssl, pdo_pgsql or pdo_sqlite, mbstring; Composer
- \`cd apps/api && composer install && cp .env.example .env && php artisan key:generate && php artisan migrate\`
- Use a dedicated PostgreSQL database (SQLite in tests), never live legacy data.
- Configure \`APP_URL\` to the **actual browser-facing HTTPS origin**. Serve \`/identity/v2/*\` via a same-origin reverse proxy; Laravel origin checks and CSRF require it. Do not expose API cross-origin.
- Use TLS, host-only \`__Host-pb_session\`, Secure/HttpOnly/SameSite=Strict and \`SESSION_DRIVER=file\` or managed secure server-side session store. Ensure session/data directories exist and aren't publicly readable.
- Run \`composer test\` plus real browser E2E, two browser profiles, Safari capability check, lost ACK/cross-tab/revocation/rotation/pairing. No full security verification was possible in this connector-only implementation environment.
- Deployment: strict allowlist origins and trusted reverse proxies, rate-limiting storage, secure headers/CSP and session/DB backup/rollback. Never log JSON request bodies, Recovery Keys, decrypted account packages or session cookies.

R2-03 does **not** connect Garage/S3/Photo schema. Photos use separate per-asset DEKs in R2-04+.
