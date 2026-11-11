# Smart Medicine Auth & Users — MySQL Edition

This edition migrates the supplied Node.js / Express authentication and authorization backend from **MongoDB/Mongoose** to **MySQL 8.0+ (InnoDB)**. The original HTTP routes, service functions, role semantics, JWT contract, 24-hex-character IDs, admin MFA, refresh-token families, pharmacy approval, email verification and audit-history response formats are retained.

## 1. What changed

- Replaced `mongoose` with `mysql2` and a **small project-local SQL-backed repository adapter** (`src/db/mysql.js`, `src/db/query.js`, `src/db/models.js`). The adapter translates the existing method calls (`findOne`, `updateOne`, `findOneAndUpdate`, `select`, `lean`, `session`) into parametrized MySQL queries; **there is no MongoDB driver at runtime**.
- Kept controllers, routes, validation, middlewares, services, response envelopes and role rules in their original locations. Transactions use InnoDB with `READ COMMITTED`, atomic conditional updates and row locking (`SELECT ... FOR UPDATE`).
- Created native MySQL tables: `users`, `pharmacyverificationevents`, `refresh_sessions`, `email_outbox`, `security_operations`, `schema_migrations`.
- Uses native MySQL `JSON` payload columns plus indexed **STORED generated columns** for unique email, role, pagination, refresh session, outbox and idempotency lookups. This preserves the original document field shapes, while providing real MySQL constraints and SQL transactions. It is **not** a normalized relational redesign.
- Added database triggers to prevent role changes and to make pharmacy audit history append-only.
- Replaced MongoDB TTL indexes with `npm run db:purge` (run on a schedule; stale expired records are independently rejected by application expiry checks).
- Original Mongo-specific migrations, test suites and documentation are preserved under `archived-mongodb/` and **must not be executed against MySQL**.

## 2. Start a local demo (Windows, PowerShell or a terminal)

Prerequisites: **Node.js 22.16+**, npm 10.9+, **MySQL 8.0/8.4**, Redis only if enabled, and optionally Docker Desktop.

1. Start a new MySQL database using `docker compose up -d mysql`. The included local-only credentials and database name are in `docker-compose.yml`.
2. Run `npm install` in this project folder.
3. Copy `.env.example` to `.env`. Set the MySQL credentials to match your installation. With the supplied compose file:

   ```dotenv
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_USER=smart_medicine
   MYSQL_PASSWORD=dev_local_password
   MYSQL_DATABASE=smart_medicine_demo
   MYSQL_POOL_SIZE=10
   JWT_SECRET=your_own_random_secret_of_at_least_32_characters
   REFRESH_TOKENS_ENABLED=true
   ```

   Keep any other original configuration flags in `.env`. Never commit `.env` or production secrets.

4. Run `npm run migrate` **once before starting the API**. The migration requires a MySQL principal allowed to create tables, indexes and triggers; it is safe to rerun if objects are already present.
5. Start the API with `npm run dev` or `npm start`.
6. Check `GET http://localhost:3000/health/ready` (expect a `mysql` dependency status), and use `POST http://localhost:3000/api/v1/auth/register`, `POST /api/v1/auth/login` and the existing other auth/admin/pharmacy endpoints. The legacy `/api/auth` aliases remain.
7. To create an initial admin, run `npm run create-admin` interactively and complete the existing MFA enrollment process. Do **not** self-register an ADMIN account.

The email worker is a separate process: `npm run mail:worker`, only when mail-related environment keys are configured. When running on multiple replicas, configure Redis as before. Schedule `npm run db:purge` at least daily (or more frequently to meet retention requirements).

## 3. Database schema and compatibility

The MySQL DDL is in `sql/001_mysql_auth_schema.sql`. IDs remain 24-character hex strings for compatibility with current URLs, validators, JWTs, audit cursors and refresh tokens. Fields are held as native MySQL JSON, and indexed generated columns expose the fields used by the original query plans. No MongoDB server or replica set is required.

**Important:** This edition creates and expects **its own schema**. If the official project database already has ordinary relational tables (`users`, `roles`, etc.) managed by another developer, **do not run this migration into that database without agreeing on the schema**. You would then need to map the repository SQL and migrations to that existing schema. No automatic migration/import of MongoDB documents into MySQL is included. This ZIP is useful as a self-contained Auth & Users MySQL backend or demo.

## 4. Security and test verification

- SQL predicates use prepared placeholders, not interpolated request data. SQL identifiers are from fixed allow-lists.
- Email uniqueness is enforced by the database. Admin role mutations and audit history mutations are rejected by SQL triggers.
- Registration and refresh token rotation share the same transaction boundaries as before; token family replay revocation remains enabled.
- `npm test` runs SQL translation / model tests without requiring a live database.
- To run **real MySQL HTTP integration tests**, first create the schema, then set `RUN_MYSQL_INTEGRATION=1`, `REFRESH_TOKENS_ENABLED=true`, all `MYSQL_*` connection values and a test `JWT_SECRET`, and run `npm test`. The GitHub Actions workflow provisions MySQL and executes these tests.

The conversion has been statically checked and the included unit tests passed during packaging; **live MySQL integration testing has not been performed in this sandbox**. Test against your own MySQL instance before deploying or merging with the official system.

Maintenance scripts accept `MYSQL_MAINTENANCE_USER` and `MYSQL_MAINTENANCE_PASSWORD` as optional separate credentials; production maintenance requires a distinct account. Application and schema-migration database privileges should be separated in production.
