# CHATHIS CockroachDB migration status

Implemented in this build:
- `pg` PostgreSQL-wire-protocol driver for CockroachDB.
- CockroachDB JSONB document table and startup schema/index creation.
- Async model/query/save/create/update/delete operations preserving the existing route API.
- Serializable transaction wrapper with bounded retries for SQLSTATE `40001`.
- Atomic wallet/gift purchase, gift transfer, top-up approval and gift-transfer approval operations.
- Admin-only JSON snapshot export endpoint and a snapshot import CLI.
- `DATABASE_URL` and optional `DATABASE_CA_CERT` Render configuration.
- SQLite fallback remains available only when `DATABASE_URL` is not set.

Validation:
- `npm run check` passes JavaScript syntax checks.
- A full live CockroachDB integration test could not be run in this environment because no cluster credentials are available and dependency installation timed out.
- Before production use, run `npm install`, `npm run db:check`, verify a staging deployment, and test concurrent wallet/gift transactions.

Data warning:
- The old Render config used `/tmp/chathsi.db`, which is ephemeral. Export existing data before switching if the old database file is still available. This migration cannot recover an already-lost SQLite database.
- Do not expose or share exported snapshot files; they contain private user records and password hashes.
