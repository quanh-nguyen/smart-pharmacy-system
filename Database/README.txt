Files:
- pharmacy_marketplace.sql : creates the schema and inserts demo records
- docker-compose.yml       : starts MySQL 8.4 and imports SQL on first init

START:
1. Keep both files in the same folder.
2. Run: docker compose up -d
3. Connect to 127.0.0.1:3306, database pharmacy_marketplace_demo.

Connection:
  Host: 127.0.0.1
  Port: 3306
  User: root
  Password: local_root_password_change_me

Open a MySQL shell:
  docker exec -it pharmacy-mysql mysql -uroot -plocal_root_password_change_me pharmacy_marketplace_demo

DATA PERSISTENCE:
- `docker compose stop` stops the container but keeps the database.
- `docker compose down` removes the container/network but keeps the named volume.
- `docker compose up -d` starts it again using the existing database.
- `docker compose restart` restarts MySQL without reinitializing the database.
- `docker compose down -v` DELETES the named volume and all database data. Avoid
  this unless you intentionally want a completely fresh database.

IMPORTANT:
- Docker runs files in /docker-entrypoint-initdb.d only when /var/lib/mysql is
  being initialized on an empty data directory. It does not rerun them on each
  container start.
- Do not manually re-run this full schema script on an already-created schema: it
  will stop when it reaches tables that already exist. Use numbered migration
  scripts for future schema changes (for example, 002_add_some_column.sql).
- The demo user password_hash values are placeholders, not valid login hashes.
- This is a development schema, not a production-ready medicine
  dispensing, prescription validation, payment, or delivery compliance system.
- Application code must enforce permissions, check pharmacy ownership, reserve
  stock transactionally, and update stock quantities consistently.
