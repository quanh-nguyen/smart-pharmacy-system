# MongoDB → MySQL conversion notes

## Preserved active behavior

- Same API endpoints, route versions and response payloads.
- Same user roles (CUSTOMER, PHARMACY, ADMIN), registration role restriction, password hashing, JWT token version, token invalidation and admin MFA challenge.
- Same refresh-token family rotation and replay revocation, using InnoDB conditional writes and transactions.
- Same pharmacy approval history and cursor encoding, with append-only SQL audit history.
- Same email token reservation, durable delivery queue, encrypted mail payloads and worker lease fencing.
- Same idempotency operation ledger and security operation lookup.

## MySQL-specific adaptations

| Original MongoDB | Converted MySQL |
| --- | --- |
| `mongoose.connect` | `mysql2/promise` connection pool |
| Mongoose schemas | SQL-backed repositories plus native JSON columns |
| ObjectId | 24-character hexadecimal identifier string (same external shape) |
| replica-set transaction | InnoDB transaction with READ COMMITTED |
| Mongo filters | compiled parameterized SQL predicates |
| unique email index | `uniq_users_email` database unique key |
| audit append-only Mongoose hooks | repository guards and SQL triggers |
| Mongo TTL index | scheduled `npm run db:purge` cleanup |
| Mongo migrations 001–010 | MySQL schema migration `001_mysql_auth_schema` |

## Remaining deployment work

1. Obtain the official MySQL schema before joining this module to the primary project database.
2. Agree on table names, column mapping, authorization/audit constraints and transactional strategy.
3. Run MySQL integration tests (the local sandbox has no MySQL server or npm-installed dependencies).
4. Configure runtime vs schema-migration privileges, mail worker, Redis, backups and scheduled cleanup.
5. If historical records exist in MongoDB, design and validate an **explicit one-time data migration** with ID and token lifecycle policy. This package does not silently copy production data.
