# Smart Pharmacy API (FastAPI + existing MySQL Docker database)

This is a small API backend for the existing Smart Pharmacy frontend and admin page. It uses the tables in `pharmacy_marketplace_demo`; it does **not** recreate or drop your MySQL database.

## What is included

- Login and customer registration
- Pharmacy search, detail, inventory and owner registration
- Public pharmacy suggestions and admin review
- Pharmacy product and stock-batch management
- Prescription image upload and manually entered medicine items
- Pharmacy matching for prescription items
- Customer addresses, orders split across pharmacies, and order history
- Payment proof upload and admin verification
- Pharmacy order processing and delivery tracking
- Admin dashboard, user management, pharmacy review and audit log

Image recognition, medicine recommendation/diagnosis, payment-gateway integration and courier-provider integration are not implemented here. The API stores prescription files and the extracted/manual list; the recognition system can be connected later. A pharmacy member can view the prescription attached to that pharmacy order and review it before accepting the order.

## 1. Put the files beside your current MySQL compose file

Your existing directory should look like this:

```text
pharmacy_db_demo/
├── docker-compose.yml                 # Your existing MySQL service
├── pharmacy_marketplace.sql           # Your existing DB initialization SQL
├── docker-compose.api.yml             # From this package
├── .env                               # Copy from .env.example
└── backend/                           # From this package
    ├── Dockerfile
    ├── requirements.txt
    ├── app/
    ├── scripts/
    └── sql/
```

Copy the `backend` folder and `docker-compose.api.yml` from this package into the directory where your existing `docker-compose.yml` lives. Copy `.env.example` to `.env` in that same directory.

**Do not replace your existing `docker-compose.yml` or database SQL file.** The API compose file is an override that adds only the API service and an uploads volume.

## 2. Set the API database password

The `.env` value `DB_PASSWORD` must match the password in `backend/scripts/create_api_user.sql`.

For the included local-development defaults, both are:

```text
change-me-api-db-password
```

Change both values before using the API beyond local testing.

## 3. Create the restricted MySQL API account

Your MySQL volume may already exist, so Docker will not rerun its initialization scripts. Create the application account once:

**Linux / macOS / Git Bash:**

```bash
docker compose exec -T mysql mysql -uroot -plocal_root_password_change_me < backend/scripts/create_api_user.sql
```

**PowerShell:**

```powershell
Get-Content -Raw backend/scripts/create_api_user.sql | docker compose exec -T mysql mysql -uroot -plocal_root_password_change_me
```

The SQL grants the API account access only to `pharmacy_marketplace_demo`, rather than giving the API root access.

## 4. Apply the small migration for pharmacy suggestions

The previous database schema did not contain a table for the site's public "suggest a pharmacy" form. Apply this one-time additive migration:

**Linux / macOS / Git Bash:**

```bash
docker compose exec -T mysql mysql -uroot -plocal_root_password_change_me pharmacy_marketplace_demo < backend/sql/001_pharmacy_suggestions.sql
```

**PowerShell:**

```powershell
Get-Content -Raw backend/sql/001_pharmacy_suggestions.sql | docker compose exec -T mysql mysql -uroot -plocal_root_password_change_me pharmacy_marketplace_demo
```

It creates a new table only. It does not drop or alter existing tables or records.

## 5. Start the API alongside MySQL

From the same directory:

```bash
docker compose -f docker-compose.yml -f docker-compose.api.yml up -d --build
```

Check status:

```bash
docker compose -f docker-compose.yml -f docker-compose.api.yml ps
```

Check the API:

```text
http://localhost:8000/health
```

Interactive API documentation:

```text
http://localhost:8000/docs
```

The API container connects to MySQL using the Docker service hostname `mysql`, not `localhost`.

## 6. Set real passwords for the seeded users

The existing demo SQL deliberately inserts unusable placeholder password hashes. Set a local development password for each user from the API container:

```bash
docker compose -f docker-compose.yml -f docker-compose.api.yml exec api python -m app.set_password site_admin 'ChangeThisAdminPassword!'
docker compose -f docker-compose.yml -f docker-compose.api.yml exec api python -m app.set_password customer_demo 'ChangeThisCustomerPassword!'
docker compose -f docker-compose.yml -f docker-compose.api.yml exec api python -m app.set_password pharmacy_a_owner 'ChangeThisPharmacyPassword!'
docker compose -f docker-compose.yml -f docker-compose.api.yml exec api python -m app.set_password pharmacy_b_owner 'ChangeThisOtherPassword!'
```

The seeded accounts are:

| Username | Seed role / membership |
|---|---|
| `site_admin` | Site administrator |
| `customer_demo` | Customer |
| `pharmacy_a_owner` | Owner of Demo Pharmacy A |
| `pharmacy_b_owner` | Owner of Demo Pharmacy B |

The password command changes only the password hash. It does not reset other database data. The admin account creation endpoint only creates customer accounts; it does not let an administrator promote another account to site administrator.

## 7. Test the API

Login:

```http
POST http://localhost:8000/api/v1/auth/login
Content-Type: application/json

{"username":"site_admin","password":"ChangeThisAdminPassword!"}
```

Use the returned token on protected endpoints:

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

Try these public endpoints first:

```text
GET http://localhost:8000/api/v1/pharmacies
GET http://localhost:8000/api/v1/medicines?q=para
GET http://localhost:8000/api/v1/pharmacies/1/inventory
```

## Main endpoints

| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/v1/auth/register` | Public |
| POST | `/api/v1/auth/login` | Public |
| GET | `/api/v1/auth/me` | Signed in |
| GET | `/api/v1/pharmacies` | Public |
| GET | `/api/v1/pharmacies/{id}` | Public |
| POST | `/api/v1/pharmacy-registrations` | Signed in |
| POST | `/api/v1/pharmacy-suggestions` | Public |
| GET | `/api/v1/me/pharmacies` | Signed in |
| PATCH | `/api/v1/pharmacies/{id}` | Pharmacy owner/manager |
| GET | `/api/v1/pharmacies/{id}/inventory` | Public searchable pharmacy; owner/member can also view their own pending pharmacy |
| GET | `/api/v1/medicines` | Public |
| POST | `/api/v1/pharmacies/{id}/products` | Pharmacy member |
| PATCH / DELETE | `/api/v1/pharmacy-products/{id}` | Pharmacy member |
| POST | `/api/v1/pharmacy-products/{id}/batches` | Pharmacy member |
| PATCH | `/api/v1/inventory-batches/{id}` | Pharmacy member |
| POST | `/api/v1/prescriptions` | Customer |
| PUT | `/api/v1/prescriptions/{id}/items` | Prescription owner |
| GET | `/api/v1/prescriptions/{id}/matches?lat=...&lng=...&radius_km=...` | Prescription owner |
| GET / POST | `/api/v1/me/addresses` | Customer |
| POST | `/api/v1/orders` | Customer |
| GET | `/api/v1/me/orders` | Customer |
| GET | `/api/v1/orders/{id}` | Order owner / involved pharmacy / admin |
| GET | `/api/v1/pharmacies/{id}/orders` | Pharmacy member |
| PATCH | `/api/v1/pharmacy-orders/{id}/status` | Pharmacy member |
| GET | `/api/v1/pharmacy-orders/{id}/prescription-image` | Pharmacy member |
| POST | `/api/v1/pharmacy-orders/{id}/shipment` | Pharmacy member |
| GET | `/api/v1/orders/{id}/tracking` | Customer / admin |
| POST | `/api/v1/payments/{id}/proof` | Payment owner |
| GET | `/api/v1/admin/dashboard` | Admin |
| GET / POST | `/api/v1/admin/users` | Admin |
| PATCH | `/api/v1/admin/users/{id}/status` | Admin |
| GET | `/api/v1/admin/pharmacies` | Admin |
| GET | `/api/v1/admin/pharmacies/{id}/verifications` | Admin |
| PATCH | `/api/v1/admin/pharmacies/{id}/review` | Admin |
| GET / PATCH | `/api/v1/admin/pharmacy-suggestions` | Admin |
| GET | `/api/v1/admin/audit-logs` | Admin |
| PATCH | `/api/v1/admin/payment-proofs/{id}/review` | Admin |

## Notes

- The frontend hosted on GitHub Pages is static. This backend provides the API, but the frontend JavaScript still needs to be changed from `localStorage` operations to `fetch()` calls.
- CORS allows `https://sn-hwang.github.io` plus common local development origins by default. Add any other exact frontend origin to `CORS_ORIGINS` in `.env`.
- Prescription, pharmacy-verification and payment-proof documents are stored in the `pharmacy_uploads` Docker volume. Their paths are stored in MySQL; prescription images are returned only to the customer who uploaded them, admins, or a pharmacy member handling the linked pharmacy order.
- Product deletion is a soft deactivation so historical orders remain readable.
- Stock is reserved while an order is pending. Reservations older than 30 minutes are released when inventory, prescription matching, checkout or pharmacy-order status endpoints are next used. A pharmacy accepting the order converts the temporary reservation into a normal stock hold. This is a simple development behavior, not a substitute for a production background worker.
- A pharmacy's `registration_status` and `is_searchable` are separate. Only approved pharmacies can be made searchable.
- This is a development starter, not a production pharmaceutical dispensing or payment compliance system. Validate prescription and dispensing rules with the relevant local requirements before real use.
