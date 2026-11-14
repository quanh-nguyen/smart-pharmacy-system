from __future__ import annotations

import json
import math
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import jwt
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import config
from .database import get_db
from .schemas import (
    AddressCreate,
    AdminUserCreate,
    BatchCreate,
    BatchUpdate,
    LoginRequest,
    OrderCreate,
    PharmacyCreate,
    PharmacyOrderStatusUpdate,
    PharmacyReview,
    PharmacySuggestionCreate,
    PharmacyUpdate,
    PaymentReview,
    PrescriptionItemsReplace,
    ProductCreate,
    ProductUpdate,
    RegisterRequest,
    ShipmentCreate,
    SuggestionReview,
    UserStatusUpdate,
)
from .security import create_access_token, decode_access_token, hash_password, verify_password

app = FastAPI(
    title="Smart Pharmacy API",
    description="Backend API for the Smart Pharmacy website and admin panel.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

bearer_scheme = HTTPBearer(auto_error=False)


# -----------------------------------------------------------------------------
# Small helpers
# -----------------------------------------------------------------------------


def as_dict(row: Any) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def as_dicts(rows: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def fetch_one(db: Session, sql: str, params: dict[str, Any] | None = None):
    return db.execute(text(sql), params or {}).mappings().first()


def fetch_all(db: Session, sql: str, params: dict[str, Any] | None = None):
    return db.execute(text(sql), params or {}).mappings().all()


def audit(
    db: Session,
    user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | None,
    old_value: Any = None,
    new_value: Any = None,
    ip_address: str | None = None,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO audit_logs
                (user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
            VALUES
                (:user_id, :action, :entity_type, :entity_id,
                 :old_value, :new_value, :ip_address)
            """
        ),
        {
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "old_value": json.dumps(old_value, default=str) if old_value is not None else None,
            "new_value": json.dumps(new_value, default=str) if new_value is not None else None,
            "ip_address": ip_address,
        },
    )


def get_user_roles(db: Session, user_id: int) -> list[str]:
    rows = fetch_all(
        db,
        """
        SELECT sr.role_name
        FROM user_system_roles usr
        JOIN system_roles sr ON sr.role_id = usr.role_id
        WHERE usr.user_id = :user_id
        """,
        {"user_id": user_id},
    )
    return [row["role_name"] for row in rows]


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")

    user = fetch_one(
        db,
        """
        SELECT user_id, username, email, phone, full_name, account_status
        FROM users
        WHERE user_id = :user_id
        """,
        {"user_id": user_id},
    )
    if user is None or user["account_status"] != "ACTIVE":
        raise HTTPException(status_code=401, detail="User account is not active")

    result = dict(user)
    result["roles"] = get_user_roles(db, user_id)
    return result



def optional_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, Any] | None:
    if credentials is None:
        return None
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    user = fetch_one(
        db,
        "SELECT user_id, username, email, phone, full_name, account_status FROM users WHERE user_id = :user_id",
        {"user_id": user_id},
    )
    if user is None or user["account_status"] != "ACTIVE":
        raise HTTPException(status_code=401, detail="User account is not active")
    result = dict(user)
    result["roles"] = get_user_roles(db, user_id)
    return result


def admin_user(user: dict = Depends(current_user)) -> dict[str, Any]:
    if "ADMIN" not in user["roles"]:
        raise HTTPException(status_code=403, detail="Administrator permission required")
    return user


def require_pharmacy_member(
    db: Session,
    user_id: int,
    pharmacy_id: int,
    allowed_roles: tuple[str, ...] = ("OWNER", "MANAGER", "STAFF"),
) -> dict[str, Any]:
    member = fetch_one(
        db,
        """
        SELECT pharmacy_id, user_id, pharmacy_role, member_status
        FROM pharmacy_members
        WHERE pharmacy_id = :pharmacy_id AND user_id = :user_id
        """,
        {"pharmacy_id": pharmacy_id, "user_id": user_id},
    )
    if member is None or member["member_status"] != "ACTIVE":
        raise HTTPException(status_code=403, detail="You are not a member of this pharmacy")
    if member["pharmacy_role"] not in allowed_roles:
        raise HTTPException(status_code=403, detail="Insufficient pharmacy permission")
    return dict(member)


def ensure_prescription_access(db: Session, prescription_id: int, user: dict) -> dict[str, Any]:
    prescription = fetch_one(
        db,
        "SELECT * FROM prescriptions WHERE prescription_id = :id",
        {"id": prescription_id},
    )
    if prescription is None:
        raise HTTPException(status_code=404, detail="Prescription not found")
    if "ADMIN" not in user["roles"] and prescription["customer_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="You cannot access this prescription")
    return dict(prescription)


def save_upload(upload: UploadFile, folder: str) -> tuple[str, Path]:
    allowed_types = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "application/pdf": ".pdf",
    }
    extension = allowed_types.get(upload.content_type or "")
    if extension is None:
        raise HTTPException(status_code=415, detail="Only JPG, PNG, WEBP or PDF files are accepted")

    content = upload.file.read(config.MAX_UPLOAD_BYTES + 1)
    if len(content) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    target_dir = Path(config.UPLOAD_DIR) / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    target_path = target_dir / filename
    target_path.write_bytes(content)
    return f"{folder}/{filename}", target_path


def file_response(relative_path: str) -> FileResponse:
    # Paths are generated by save_upload; don't accept arbitrary filesystem paths.
    safe_path = Path(config.UPLOAD_DIR) / relative_path
    if not safe_path.resolve().is_relative_to(Path(config.UPLOAD_DIR).resolve()):
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not safe_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(safe_path)



def release_expired_reservations(db: Session) -> int:
    expired = fetch_all(
        db,
        "SELECT reservation_id, batch_id, quantity_reserved FROM inventory_reservations WHERE reservation_status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= NOW() FOR UPDATE",
    )
    for reservation in expired:
        db.execute(
            text("UPDATE inventory_batches SET quantity_reserved = quantity_reserved - :qty WHERE batch_id = :bid"),
            {"qty": reservation["quantity_reserved"], "bid": reservation["batch_id"]},
        )
        db.execute(
            text("UPDATE inventory_reservations SET reservation_status = 'EXPIRED' WHERE reservation_id = :rid"),
            {"rid": reservation["reservation_id"]},
        )
    return len(expired)


def update_order_status_history(
    db: Session,
    *,
    order_id: int | None = None,
    pharmacy_order_id: int | None = None,
    old_status: str | None,
    new_status: str,
    changed_by: int | None,
    remarks: str | None = None,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO order_status_history
                (order_id, pharmacy_order_id, old_status, new_status, changed_by, remarks)
            VALUES (:order_id, :pharmacy_order_id, :old_status, :new_status, :changed_by, :remarks)
            """
        ),
        {
            "order_id": order_id,
            "pharmacy_order_id": pharmacy_order_id,
            "old_status": old_status,
            "new_status": new_status,
            "changed_by": changed_by,
            "remarks": remarks,
        },
    )


# -----------------------------------------------------------------------------
# Health and authentication
# -----------------------------------------------------------------------------


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}


@app.post("/api/v1/auth/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    try:
        result = db.execute(
            text(
                """
                INSERT INTO users (username, password_hash, email, phone, full_name)
                VALUES (:username, :password_hash, :email, :phone, :full_name)
                """
            ),
            {
                "username": body.username,
                "password_hash": hash_password(body.password),
                "email": body.email,
                "phone": body.phone,
                "full_name": body.full_name,
            },
        )
        user_id = int(result.lastrowid)
        role_id = db.execute(
            text("SELECT role_id FROM system_roles WHERE role_name = 'CUSTOMER'")
        ).scalar()
        if role_id is None:
            role_id = db.execute(
                text("INSERT INTO system_roles (role_name, description) VALUES ('CUSTOMER', 'Customer')")
            ).lastrowid
        db.execute(
            text("INSERT INTO user_system_roles (user_id, role_id) VALUES (:uid, :rid)"),
            {"uid": user_id, "rid": role_id},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists")
    except Exception:
        db.rollback()
        raise

    token = create_access_token(user_id)
    return {"access_token": token, "token_type": "bearer", "user_id": user_id}


@app.post("/api/v1/auth/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = fetch_one(
        db,
        """
        SELECT user_id, password_hash, account_status
        FROM users
        WHERE username = :identifier OR email = :identifier
        LIMIT 1
        """,
        {"identifier": body.username},
    )
    if (
        user is None
        or user["account_status"] != "ACTIVE"
        or not verify_password(body.password, user["password_hash"])
    ):
        raise HTTPException(status_code=401, detail="Incorrect username/email or password")

    return {
        "access_token": create_access_token(int(user["user_id"])),
        "token_type": "bearer",
    }


@app.get("/api/v1/auth/me")
def me(user: dict = Depends(current_user), db: Session = Depends(get_db)):
    pharmacies = fetch_all(
        db,
        """
        SELECT p.pharmacy_id, p.pharmacy_name, pm.pharmacy_role, pm.member_status
        FROM pharmacy_members pm
        JOIN pharmacies p ON p.pharmacy_id = pm.pharmacy_id
        WHERE pm.user_id = :uid
        ORDER BY p.pharmacy_name
        """,
        {"uid": user["user_id"]},
    )
    user["pharmacies"] = as_dicts(pharmacies)
    return user


# -----------------------------------------------------------------------------
# Pharmacy discovery, registration and verification
# -----------------------------------------------------------------------------


@app.get("/api/v1/pharmacies")
def list_pharmacies(
    q: str | None = None,
    province: str | None = None,
    district: str | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90, alias="lat"),
    longitude: float | None = Query(default=None, ge=-180, le=180, alias="lng"),
    radius_km: float = Query(default=10, gt=0, le=200),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    params: dict[str, Any] = {"limit": limit}
    filters = ["p.registration_status = 'APPROVED'", "p.is_searchable = TRUE"]
    if q:
        filters.append("(p.pharmacy_name LIKE :q OR p.street_address LIKE :q OR p.district LIKE :q)")
        params["q"] = f"%{q}%"
    if province:
        filters.append("p.province = :province")
        params["province"] = province
    if district:
        filters.append("p.district = :district")
        params["district"] = district

    distance_select = "NULL AS distance_km"
    if latitude is not None and longitude is not None:
        distance_select = (
            "ST_Distance_Sphere(POINT(p.longitude, p.latitude), "
            "POINT(:longitude, :latitude)) / 1000 AS distance_km"
        )
        params.update({"latitude": latitude, "longitude": longitude, "radius_m": radius_km * 1000})
        filters.append(
            "p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND "
            "ST_Distance_Sphere(POINT(p.longitude, p.latitude), POINT(:longitude, :latitude)) <= :radius_m"
        )

    sql = f"""
        SELECT p.pharmacy_id, p.pharmacy_name, p.phone, p.email,
               p.province, p.district, p.ward, p.street_address,
               p.latitude, p.longitude, {distance_select}
        FROM pharmacies p
        WHERE {' AND '.join(filters)}
        ORDER BY p.pharmacy_name
        LIMIT :limit
    """
    return {"items": as_dicts(fetch_all(db, sql, params))}


@app.get("/api/v1/pharmacies/{pharmacy_id}")
def pharmacy_detail(pharmacy_id: int, db: Session = Depends(get_db)):
    pharmacy = fetch_one(
        db,
        """
        SELECT pharmacy_id, pharmacy_name, phone, email, province, district, ward,
               street_address, latitude, longitude
        FROM pharmacies
        WHERE pharmacy_id = :id AND registration_status = 'APPROVED' AND is_searchable = TRUE
        """,
        {"id": pharmacy_id},
    )
    if pharmacy is None:
        raise HTTPException(status_code=404, detail="Pharmacy not found")
    return dict(pharmacy)


@app.post("/api/v1/pharmacy-registrations", status_code=status.HTTP_201_CREATED)
def register_pharmacy(
    body: PharmacyCreate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        result = db.execute(
            text(
                """
                INSERT INTO pharmacies
                    (pharmacy_name, license_number, phone, email, province, district, ward,
                     street_address, latitude, longitude, registration_status, is_searchable)
                VALUES
                    (:pharmacy_name, :license_number, :phone, :email, :province, :district, :ward,
                     :street_address, :latitude, :longitude, 'PENDING', FALSE)
                """
            ),
            body.model_dump(),
        )
        pharmacy_id = int(result.lastrowid)
        db.execute(
            text(
                """
                INSERT INTO pharmacy_members (pharmacy_id, user_id, pharmacy_role, member_status)
                VALUES (:pid, :uid, 'OWNER', 'ACTIVE')
                """
            ),
            {"pid": pharmacy_id, "uid": user["user_id"]},
        )
        audit(db, user["user_id"], "REGISTER_PHARMACY", "pharmacies", pharmacy_id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This pharmacy license number is already registered")
    except Exception:
        db.rollback()
        raise
    return {"pharmacy_id": pharmacy_id, "registration_status": "PENDING", "is_searchable": False}


@app.get("/api/v1/me/pharmacies")
def my_pharmacies(user: dict = Depends(current_user), db: Session = Depends(get_db)):
    rows = fetch_all(
        db,
        """
        SELECT p.*, pm.pharmacy_role, pm.member_status
        FROM pharmacy_members pm
        JOIN pharmacies p ON p.pharmacy_id = pm.pharmacy_id
        WHERE pm.user_id = :uid
        ORDER BY p.created_at DESC
        """,
        {"uid": user["user_id"]},
    )
    return {"items": as_dicts(rows)}


@app.patch("/api/v1/pharmacies/{pharmacy_id}")
def update_pharmacy_profile(
    pharmacy_id: int,
    body: PharmacyUpdate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_pharmacy_member(db, user["user_id"], pharmacy_id, ("OWNER", "MANAGER"))
    pharmacy = fetch_one(db, "SELECT * FROM pharmacies WHERE pharmacy_id = :id", {"id": pharmacy_id})
    if pharmacy is None:
        raise HTTPException(status_code=404, detail="Pharmacy not found")
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return {"message": "No changes"}
    assignments = ", ".join(f"{column} = :{column}" for column in changes)
    try:
        db.execute(text(f"UPDATE pharmacies SET {assignments} WHERE pharmacy_id = :id"), {**changes, "id": pharmacy_id})
        audit(db, user["user_id"], "UPDATE_PHARMACY_PROFILE", "pharmacies", pharmacy_id, dict(pharmacy), changes)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"message": "Pharmacy profile updated"}


@app.post("/api/v1/pharmacy-suggestions", status_code=status.HTTP_201_CREATED)
def suggest_pharmacy(
    body: PharmacySuggestionCreate,
    db: Session = Depends(get_db),
):
    # Public suggestion endpoint. A dedicated table is created by the included
    # one-time SQL migration in backend/sql/001_pharmacy_suggestions.sql.
    result = db.execute(
        text(
            """
            INSERT INTO pharmacy_suggestions
                (pharmacy_name, address, phone, opening_hours, website, additional_info)
            VALUES (:pharmacy_name, :address, :phone, :opening_hours, :website, :additional_info)
            """
        ),
        body.model_dump(),
    )
    suggestion_id = int(result.lastrowid)
    db.commit()
    return {"suggestion_id": suggestion_id, "review_status": "PENDING"}


@app.post("/api/v1/pharmacies/{pharmacy_id}/verification-documents", status_code=status.HTTP_201_CREATED)
def upload_pharmacy_document(
    pharmacy_id: int,
    document_type: str = Form(..., max_length=100),
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_pharmacy_member(db, user["user_id"], pharmacy_id, ("OWNER", "MANAGER"))
    relative_path, saved_path = save_upload(file, "pharmacy-documents")
    try:
        result = db.execute(
            text(
                """
                INSERT INTO pharmacy_verifications
                    (pharmacy_id, document_type, document_path, decision)
                VALUES (:pid, :document_type, :document_path, 'PENDING')
                """
            ),
            {"pid": pharmacy_id, "document_type": document_type, "document_path": relative_path},
        )
        db.commit()
    except Exception:
        db.rollback()
        saved_path.unlink(missing_ok=True)
        raise
    return {"verification_id": int(result.lastrowid), "decision": "PENDING"}


@app.get("/api/v1/pharmacies/{pharmacy_id}/inventory")
def pharmacy_inventory(
    pharmacy_id: int,
    q: str | None = None,
    user: dict | None = Depends(optional_current_user),
    db: Session = Depends(get_db),
):
    pharmacy = fetch_one(
        db,
        "SELECT pharmacy_id, registration_status, is_searchable FROM pharmacies WHERE pharmacy_id = :id",
        {"id": pharmacy_id},
    )
    if pharmacy is None:
        raise HTTPException(status_code=404, detail="Pharmacy not found")
    if pharmacy["registration_status"] != "APPROVED" or not pharmacy["is_searchable"]:
        if user is None:
            raise HTTPException(status_code=404, detail="Pharmacy is not publicly searchable")
        require_pharmacy_member(db, user["user_id"], pharmacy_id)

    if release_expired_reservations(db):
        db.commit()
    params: dict[str, Any] = {"pid": pharmacy_id}
    filter_sql = ""
    if q:
        filter_sql = "AND (pp.local_product_name LIKE :q OR m.canonical_name LIKE :q)"
        params["q"] = f"%{q}%"
    rows = fetch_all(
        db,
        f"""
        SELECT pp.pharmacy_product_id, pp.medicine_id, pp.local_product_name,
               pp.package_description, pp.barcode, pp.selling_price,
               m.canonical_name, m.strength, m.dosage_form,
               COALESCE(SUM(CASE WHEN ib.expiration_date >= CURDATE()
                   THEN ib.quantity_on_hand - ib.quantity_reserved ELSE 0 END), 0) AS available_stock
        FROM pharmacy_products pp
        LEFT JOIN medicines m ON m.medicine_id = pp.medicine_id
        LEFT JOIN inventory_batches ib ON ib.pharmacy_product_id = pp.pharmacy_product_id
        WHERE pp.pharmacy_id = :pid AND pp.is_available = TRUE {filter_sql}
        GROUP BY pp.pharmacy_product_id, pp.medicine_id, pp.local_product_name,
                 pp.package_description, pp.barcode, pp.selling_price,
                 m.canonical_name, m.strength, m.dosage_form
        ORDER BY pp.local_product_name
        """,
        params,
    )
    return {"pharmacy_id": pharmacy_id, "items": as_dicts(rows)}


# -----------------------------------------------------------------------------
# Medicine catalog and pharmacy inventory
# -----------------------------------------------------------------------------


@app.get("/api/v1/medicines")
def search_medicines(
    q: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    params: dict[str, Any] = {"limit": limit}
    where = "m.is_active = TRUE"
    if q:
        where += " AND (m.canonical_name LIKE :q OR EXISTS (SELECT 1 FROM medicine_ingredients mi WHERE mi.medicine_id = m.medicine_id AND mi.ingredient_name LIKE :q))"
        params["q"] = f"%{q}%"
    rows = fetch_all(
        db,
        f"""
        SELECT m.medicine_id, m.canonical_name, m.strength, m.dosage_form,
               m.route_of_administration, m.manufacturer_name, m.description
        FROM medicines m
        WHERE {where}
        ORDER BY m.canonical_name
        LIMIT :limit
        """,
        params,
    )
    return {"items": as_dicts(rows)}


@app.post("/api/v1/pharmacies/{pharmacy_id}/products", status_code=status.HTTP_201_CREATED)
def create_product(
    pharmacy_id: int,
    body: ProductCreate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_pharmacy_member(db, user["user_id"], pharmacy_id)
    try:
        product_result = db.execute(
            text(
                """
                INSERT INTO pharmacy_products
                    (pharmacy_id, medicine_id, local_product_name, package_description,
                     barcode, selling_price, is_available)
                VALUES (:pharmacy_id, :medicine_id, :local_product_name, :package_description,
                        :barcode, :selling_price, :is_available)
                """
            ),
            {
                "pharmacy_id": pharmacy_id,
                "medicine_id": body.medicine_id,
                "local_product_name": body.local_product_name,
                "package_description": body.package_description,
                "barcode": body.barcode,
                "selling_price": body.selling_price,
                "is_available": body.is_available,
            },
        )
        product_id = int(product_result.lastrowid)
        if body.initial_batch is not None:
            batch = body.initial_batch
            batch_result = db.execute(
                text(
                    """
                    INSERT INTO inventory_batches
                        (pharmacy_product_id, batch_number, quantity_on_hand,
                         expiration_date, purchase_price)
                    VALUES (:pid, :batch_number, :quantity, :expiration_date, :purchase_price)
                    """
                ),
                {
                    "pid": product_id,
                    "batch_number": batch.batch_number,
                    "quantity": batch.quantity_on_hand,
                    "expiration_date": batch.expiration_date,
                    "purchase_price": batch.purchase_price,
                },
            )
            if batch.quantity_on_hand > 0:
                db.execute(
                    text(
                        """
                        INSERT INTO stock_transactions
                            (batch_id, transaction_type, quantity_change, performed_by, notes)
                        VALUES (:batch_id, 'PURCHASE', :quantity, :user_id, 'Initial stock entry')
                        """
                    ),
                    {"batch_id": int(batch_result.lastrowid), "quantity": batch.quantity_on_hand, "user_id": user["user_id"]},
                )
        audit(db, user["user_id"], "CREATE_PRODUCT", "pharmacy_products", product_id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Product barcode already exists in this pharmacy, or medicine_id is invalid")
    except Exception:
        db.rollback()
        raise
    return {"pharmacy_product_id": product_id}


@app.patch("/api/v1/pharmacy-products/{product_id}")
def update_product(
    product_id: int,
    body: ProductUpdate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    product = fetch_one(db, "SELECT * FROM pharmacy_products WHERE pharmacy_product_id = :id", {"id": product_id})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    require_pharmacy_member(db, user["user_id"], product["pharmacy_id"])
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return dict(product)
    allowed = {"local_product_name", "package_description", "barcode", "selling_price", "is_available"}
    if not set(changes).issubset(allowed):
        raise HTTPException(status_code=400, detail="Invalid fields")
    assignments = ", ".join(f"{column} = :{column}" for column in changes)
    params = {**changes, "id": product_id}
    try:
        db.execute(text(f"UPDATE pharmacy_products SET {assignments} WHERE pharmacy_product_id = :id"), params)
        audit(db, user["user_id"], "UPDATE_PRODUCT", "pharmacy_products", product_id, dict(product), changes)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Barcode already exists in this pharmacy")
    return {"message": "Product updated"}


@app.delete("/api/v1/pharmacy-products/{product_id}")
def deactivate_product(
    product_id: int,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    product = fetch_one(db, "SELECT * FROM pharmacy_products WHERE pharmacy_product_id = :id", {"id": product_id})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    require_pharmacy_member(db, user["user_id"], product["pharmacy_id"])
    db.execute(text("UPDATE pharmacy_products SET is_available = FALSE WHERE pharmacy_product_id = :id"), {"id": product_id})
    audit(db, user["user_id"], "DEACTIVATE_PRODUCT", "pharmacy_products", product_id)
    db.commit()
    return {"message": "Product deactivated; historical orders are preserved"}


@app.post("/api/v1/pharmacy-products/{product_id}/batches", status_code=status.HTTP_201_CREATED)
def add_inventory_batch(
    product_id: int,
    body: BatchCreate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    product = fetch_one(db, "SELECT pharmacy_id FROM pharmacy_products WHERE pharmacy_product_id = :id", {"id": product_id})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    require_pharmacy_member(db, user["user_id"], product["pharmacy_id"])
    try:
        result = db.execute(
            text(
                """
                INSERT INTO inventory_batches
                    (pharmacy_product_id, batch_number, quantity_on_hand, expiration_date, purchase_price)
                VALUES (:pid, :batch_number, :quantity_on_hand, :expiration_date, :purchase_price)
                """
            ),
            {"pid": product_id, **body.model_dump()},
        )
        batch_id = int(result.lastrowid)
        if body.quantity_on_hand > 0:
            db.execute(
                text(
                    """
                    INSERT INTO stock_transactions
                        (batch_id, transaction_type, quantity_change, performed_by, notes)
                    VALUES (:batch_id, 'PURCHASE', :quantity, :user_id, 'New inventory batch')
                    """
                ),
                {"batch_id": batch_id, "quantity": body.quantity_on_hand, "user_id": user["user_id"]},
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Batch number already exists for this product")
    return {"batch_id": batch_id}


@app.patch("/api/v1/inventory-batches/{batch_id}")
def update_inventory_batch(
    batch_id: int,
    body: BatchUpdate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    batch = fetch_one(
        db,
        """
        SELECT ib.*, pp.pharmacy_id
        FROM inventory_batches ib
        JOIN pharmacy_products pp ON pp.pharmacy_product_id = ib.pharmacy_product_id
        WHERE ib.batch_id = :id
        """,
        {"id": batch_id},
    )
    if batch is None:
        raise HTTPException(status_code=404, detail="Inventory batch not found")
    require_pharmacy_member(db, user["user_id"], batch["pharmacy_id"])
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return dict(batch)
    new_quantity = changes.get("quantity_on_hand", batch["quantity_on_hand"])
    if new_quantity < batch["quantity_reserved"]:
        raise HTTPException(status_code=409, detail="Quantity cannot be lower than currently reserved stock")
    assignments = ", ".join(f"{column} = :{column}" for column in changes)
    try:
        db.execute(text(f"UPDATE inventory_batches SET {assignments} WHERE batch_id = :id"), {**changes, "id": batch_id})
        delta = int(new_quantity) - int(batch["quantity_on_hand"])
        if delta:
            db.execute(
                text(
                    """
                    INSERT INTO stock_transactions
                        (batch_id, transaction_type, quantity_change, performed_by, notes)
                    VALUES (:batch_id, 'ADJUSTMENT', :delta, :user_id, 'Manual stock adjustment')
                    """
                ),
                {"batch_id": batch_id, "delta": delta, "user_id": user["user_id"]},
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"message": "Inventory batch updated"}


# -----------------------------------------------------------------------------
# Customer addresses and prescriptions
# -----------------------------------------------------------------------------


@app.get("/api/v1/me/addresses")
def list_addresses(user: dict = Depends(current_user), db: Session = Depends(get_db)):
    rows = fetch_all(
        db,
        "SELECT * FROM customer_addresses WHERE customer_id = :uid ORDER BY is_default DESC, address_id DESC",
        {"uid": user["user_id"]},
    )
    return {"items": as_dicts(rows)}


@app.post("/api/v1/me/addresses", status_code=status.HTTP_201_CREATED)
def create_address(body: AddressCreate, user: dict = Depends(current_user), db: Session = Depends(get_db)):
    try:
        if body.is_default:
            db.execute(text("UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = :uid"), {"uid": user["user_id"]})
        result = db.execute(
            text(
                """
                INSERT INTO customer_addresses
                    (customer_id, recipient_name, recipient_phone, province, district, ward,
                     street_address, latitude, longitude, is_default)
                VALUES (:customer_id, :recipient_name, :recipient_phone, :province, :district, :ward,
                        :street_address, :latitude, :longitude, :is_default)
                """
            ),
            {"customer_id": user["user_id"], **body.model_dump()},
        )
        address_id = int(result.lastrowid)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"address_id": address_id}


@app.post("/api/v1/prescriptions", status_code=status.HTTP_201_CREATED)
def upload_prescription(
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    relative_path, saved_path = save_upload(file, "prescriptions")
    try:
        result = db.execute(
            text("INSERT INTO prescriptions (customer_id, image_path) VALUES (:uid, :path)"),
            {"uid": user["user_id"], "path": relative_path},
        )
        prescription_id = int(result.lastrowid)
        db.commit()
    except Exception:
        db.rollback()
        saved_path.unlink(missing_ok=True)
        raise
    return {"prescription_id": prescription_id, "processing_status": "PENDING", "verification_status": "PENDING"}


@app.get("/api/v1/prescriptions/{prescription_id}")
def get_prescription(
    prescription_id: int,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    prescription = ensure_prescription_access(db, prescription_id, user)
    items = fetch_all(
        db,
        """
        SELECT prescription_item_id, medicine_id, recognized_name, required_quantity,
               dosage_instruction, recognition_confidence
        FROM prescription_items WHERE prescription_id = :pid
        ORDER BY prescription_item_id
        """,
        {"pid": prescription_id},
    )
    result = dict(prescription)
    result.pop("image_path", None)
    result["items"] = as_dicts(items)
    result["image_url"] = f"/api/v1/prescriptions/{prescription_id}/image"
    return result


@app.get("/api/v1/prescriptions/{prescription_id}/image")
def get_prescription_image(
    prescription_id: int,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    prescription = ensure_prescription_access(db, prescription_id, user)
    return file_response(prescription["image_path"])


@app.put("/api/v1/prescriptions/{prescription_id}/items")
def replace_prescription_items(
    prescription_id: int,
    body: PrescriptionItemsReplace,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    prescription = ensure_prescription_access(db, prescription_id, user)
    try:
        db.execute(text("DELETE FROM prescription_items WHERE prescription_id = :pid"), {"pid": prescription_id})
        for item in body.items:
            db.execute(
                text(
                    """
                    INSERT INTO prescription_items
                        (prescription_id, medicine_id, recognized_name, required_quantity,
                         dosage_instruction, recognition_confidence)
                    VALUES (:pid, :medicine_id, :recognized_name, :required_quantity,
                            :dosage_instruction, NULL)
                    """
                ),
                {"pid": prescription_id, **item.model_dump()},
            )
        db.execute(
            text("UPDATE prescriptions SET processing_status = 'COMPLETED' WHERE prescription_id = :pid"),
            {"pid": prescription_id},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="One or more medicine IDs do not exist")
    return {"message": "Prescription items saved", "count": len(body.items)}


@app.get("/api/v1/prescriptions/{prescription_id}/matches")
def match_prescription(
    prescription_id: int,
    latitude: float | None = Query(default=None, ge=-90, le=90, alias="lat"),
    longitude: float | None = Query(default=None, ge=-180, le=180, alias="lng"),
    radius_km: float = Query(default=10, gt=0, le=200),
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    ensure_prescription_access(db, prescription_id, user)
    if release_expired_reservations(db):
        db.commit()
    items = as_dicts(
        fetch_all(
            db,
            """
            SELECT prescription_item_id, medicine_id, recognized_name,
                   COALESCE(required_quantity, 1) AS required_quantity
            FROM prescription_items WHERE prescription_id = :pid
            ORDER BY prescription_item_id
            """,
            {"pid": prescription_id},
        )
    )
    if not items:
        raise HTTPException(status_code=400, detail="Add recognized medicine items before searching pharmacies")

    requirements: dict[int, int] = defaultdict(int)
    unknown_items = []
    for item in items:
        if item["medicine_id"] is None:
            unknown_items.append(item["recognized_name"])
        else:
            requirements[int(item["medicine_id"])] += int(item["required_quantity"])

    products = as_dicts(
        fetch_all(
            db,
            """
            SELECT p.pharmacy_id, p.pharmacy_name, p.district, p.latitude, p.longitude,
                   pp.pharmacy_product_id, pp.medicine_id, pp.local_product_name,
                   pp.selling_price, m.canonical_name, m.strength, m.dosage_form,
                   COALESCE(SUM(CASE WHEN ib.expiration_date >= CURDATE()
                       THEN ib.quantity_on_hand - ib.quantity_reserved ELSE 0 END), 0) AS available_stock
            FROM pharmacies p
            JOIN pharmacy_products pp ON pp.pharmacy_id = p.pharmacy_id AND pp.is_available = TRUE
            JOIN medicines m ON m.medicine_id = pp.medicine_id AND m.is_active = TRUE
            LEFT JOIN inventory_batches ib ON ib.pharmacy_product_id = pp.pharmacy_product_id
            WHERE p.registration_status = 'APPROVED' AND p.is_searchable = TRUE
            GROUP BY p.pharmacy_id, p.pharmacy_name, p.district, p.latitude, p.longitude,
                     pp.pharmacy_product_id, pp.medicine_id, pp.local_product_name,
                     pp.selling_price, m.canonical_name, m.strength, m.dosage_form
            """,
        )
    )

    by_pharmacy: dict[int, dict[str, Any]] = {}
    for product in products:
        pid = int(product["pharmacy_id"])
        pharmacy = by_pharmacy.setdefault(
            pid,
            {
                "pharmacy_id": pid,
                "pharmacy_name": product["pharmacy_name"],
                "district": product["district"],
                "latitude": product["latitude"],
                "longitude": product["longitude"],
                "distance_km": None,
                "products": [],
            },
        )
        pharmacy["products"].append(product)

    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=400, detail="Provide both lat and lng, or neither")

    results = []
    for pharmacy in by_pharmacy.values():
        if latitude is not None and longitude is not None:
            if pharmacy["latitude"] is None or pharmacy["longitude"] is None:
                continue
            lat1, lon1 = math.radians(latitude), math.radians(longitude)
            lat2, lon2 = math.radians(float(pharmacy["latitude"])), math.radians(float(pharmacy["longitude"]))
            delta_lat, delta_lon = lat2 - lat1, lon2 - lon1
            haversine = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
            pharmacy["distance_km"] = 6371.0 * 2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine))
            if pharmacy["distance_km"] > radius_km:
                continue
        matched = []
        missing = list(unknown_items)
        for medicine_id, required_quantity in requirements.items():
            choices = [
                product for product in pharmacy["products"]
                if product["medicine_id"] == medicine_id
                and int(product["available_stock"]) >= required_quantity
            ]
            if choices:
                choices.sort(key=lambda product: Decimal(str(product["selling_price"])))
                matched.append({
                    "medicine_id": medicine_id,
                    "required_quantity": required_quantity,
                    "product": choices[0],
                })
            else:
                missing.append(f"medicine_id:{medicine_id}")
        results.append({
            "pharmacy_id": pharmacy["pharmacy_id"],
            "pharmacy_name": pharmacy["pharmacy_name"],
            "district": pharmacy["district"],
            "latitude": pharmacy["latitude"],
            "longitude": pharmacy["longitude"],
            "distance_km": round(pharmacy["distance_km"], 2) if pharmacy["distance_km"] is not None else None,
            "can_fulfill_all": len(missing) == 0 and len(matched) == len(requirements),
            "matched_items": matched,
            "missing_items": missing,
        })
    results.sort(key=lambda item: (not item["can_fulfill_all"], item["distance_km"] if item["distance_km"] is not None else float("inf"), len(item["missing_items"]), item["pharmacy_name"]))
    return {"prescription_id": prescription_id, "items": results}


# -----------------------------------------------------------------------------
# Orders, payments and delivery tracking
# -----------------------------------------------------------------------------


@app.post("/api/v1/orders", status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderCreate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    if release_expired_reservations(db):
        db.commit()
    if len({item.pharmacy_product_id for item in body.items}) != len(body.items):
        raise HTTPException(status_code=400, detail="Each product may appear only once in an order")

    address = fetch_one(
        db,
        "SELECT * FROM customer_addresses WHERE address_id = :aid AND customer_id = :uid",
        {"aid": body.address_id, "uid": user["user_id"]},
    )
    if address is None:
        raise HTTPException(status_code=404, detail="Delivery address not found")

    prescription_requirements: dict[int, int | None] = {}
    ordered_prescription_quantities: dict[int, int] = defaultdict(int)
    if body.prescription_id is not None:
        prescription = ensure_prescription_access(db, body.prescription_id, user)
        if prescription["verification_status"] == "REJECTED":
            raise HTTPException(status_code=409, detail="This prescription has been rejected")
        prescription_rows = fetch_all(
            db,
            "SELECT medicine_id, required_quantity FROM prescription_items WHERE prescription_id = :pid",
            {"pid": body.prescription_id},
        )
        for prescription_row in prescription_rows:
            if prescription_row["medicine_id"] is not None:
                mid = int(prescription_row["medicine_id"])
                current = prescription_requirements.get(mid)
                qty = prescription_row["required_quantity"]
                if mid not in prescription_requirements:
                    prescription_requirements[mid] = int(qty) if qty is not None else None
                elif current is not None and qty is not None:
                    prescription_requirements[mid] = current + int(qty)
                else:
                    prescription_requirements[mid] = None

    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    try:
        # Validate products and obtain their current prices from the database.
        for requested in body.items:
            product = fetch_one(
                db,
                """
                SELECT pp.pharmacy_product_id, pp.pharmacy_id, pp.medicine_id,
                       pp.local_product_name, pp.selling_price,
                       p.registration_status, p.is_searchable
                FROM pharmacy_products pp
                JOIN pharmacies p ON p.pharmacy_id = pp.pharmacy_id
                WHERE pp.pharmacy_product_id = :product_id
                  AND pp.is_available = TRUE
                FOR UPDATE
                """,
                {"product_id": requested.pharmacy_product_id},
            )
            if product is None or product["registration_status"] != "APPROVED" or not product["is_searchable"]:
                raise HTTPException(status_code=409, detail=f"Product {requested.pharmacy_product_id} is not available")
            if body.prescription_id is not None:
                medicine_id = product["medicine_id"]
                if medicine_id is None or int(medicine_id) not in prescription_requirements:
                    raise HTTPException(status_code=409, detail=f"{product['local_product_name']} is not matched to an item on this prescription")
                medicine_id = int(medicine_id)
                ordered_prescription_quantities[medicine_id] += requested.quantity
                prescribed_quantity = prescription_requirements[medicine_id]
                if prescribed_quantity is not None and ordered_prescription_quantities[medicine_id] > prescribed_quantity:
                    raise HTTPException(status_code=409, detail=f"Order quantity exceeds the prescription quantity for medicine_id {medicine_id}")
            grouped[int(product["pharmacy_id"])].append({
                "product": dict(product),
                "quantity": requested.quantity,
            })

        pharmacy_subtotals: dict[int, Decimal] = {}
        for pharmacy_id, lines in grouped.items():
            pharmacy_subtotals[pharmacy_id] = sum(
                (Decimal(str(line["product"]["selling_price"])) * line["quantity"] for line in lines),
                Decimal("0.00"),
            )
        subtotal = sum(pharmacy_subtotals.values(), Decimal("0.00"))
        order_number = f"SP-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:10].upper()}"

        order_result = db.execute(
            text(
                """
                INSERT INTO customer_orders
                    (order_number, customer_id, prescription_id, address_id,
                     recipient_name, recipient_phone, shipping_province, shipping_district,
                     shipping_ward, shipping_street_address, shipping_latitude, shipping_longitude,
                     subtotal, shipping_fee, discount_amount, order_status)
                VALUES (:order_number, :customer_id, :prescription_id, :address_id,
                        :recipient_name, :recipient_phone, :province, :district,
                        :ward, :street_address, :latitude, :longitude,
                        :subtotal, 0, 0, 'PENDING')
                """
            ),
            {
                "order_number": order_number,
                "customer_id": user["user_id"],
                "prescription_id": body.prescription_id,
                "address_id": body.address_id,
                "recipient_name": address["recipient_name"],
                "recipient_phone": address["recipient_phone"],
                "province": address["province"],
                "district": address["district"],
                "ward": address["ward"],
                "street_address": address["street_address"],
                "latitude": address["latitude"],
                "longitude": address["longitude"],
                "subtotal": subtotal,
            },
        )
        order_id = int(order_result.lastrowid)

        for pharmacy_id, lines in grouped.items():
            pharmacy_order_result = db.execute(
                text(
                    """
                    INSERT INTO pharmacy_orders
                        (order_id, pharmacy_id, subtotal, shipping_fee, discount_amount, order_status)
                    VALUES (:order_id, :pharmacy_id, :subtotal, 0, 0, 'PENDING')
                    """
                ),
                {"order_id": order_id, "pharmacy_id": pharmacy_id, "subtotal": pharmacy_subtotals[pharmacy_id]},
            )
            pharmacy_order_id = int(pharmacy_order_result.lastrowid)

            for line in lines:
                product = line["product"]
                quantity = int(line["quantity"])
                prescription_item_id = None
                if body.prescription_id is not None and product["medicine_id"] is not None:
                    matching_item = fetch_one(
                        db,
                        """
                        SELECT prescription_item_id FROM prescription_items
                        WHERE prescription_id = :pid AND medicine_id = :mid
                        ORDER BY prescription_item_id LIMIT 1
                        """,
                        {"pid": body.prescription_id, "mid": product["medicine_id"]},
                    )
                    if matching_item:
                        prescription_item_id = matching_item["prescription_item_id"]

                item_result = db.execute(
                    text(
                        """
                        INSERT INTO order_items
                            (pharmacy_order_id, pharmacy_id, pharmacy_product_id, prescription_item_id,
                             medicine_name_snapshot, quantity, unit_price)
                        VALUES (:poid, :pharmacy_id, :product_id, :prescription_item_id,
                                :name, :quantity, :unit_price)
                        """
                    ),
                    {
                        "poid": pharmacy_order_id,
                        "pharmacy_id": pharmacy_id,
                        "product_id": product["pharmacy_product_id"],
                        "prescription_item_id": prescription_item_id,
                        "name": product["local_product_name"],
                        "quantity": quantity,
                        "unit_price": product["selling_price"],
                    },
                )
                order_item_id = int(item_result.lastrowid)

                batches = fetch_all(
                    db,
                    """
                    SELECT batch_id, quantity_on_hand, quantity_reserved
                    FROM inventory_batches
                    WHERE pharmacy_product_id = :pid
                      AND expiration_date >= CURDATE()
                      AND quantity_on_hand > quantity_reserved
                    ORDER BY expiration_date ASC, batch_id ASC
                    FOR UPDATE
                    """,
                    {"pid": product["pharmacy_product_id"]},
                )
                remaining = quantity
                for batch in batches:
                    available = int(batch["quantity_on_hand"]) - int(batch["quantity_reserved"])
                    reserve_quantity = min(available, remaining)
                    if reserve_quantity <= 0:
                        continue
                    db.execute(
                        text("UPDATE inventory_batches SET quantity_reserved = quantity_reserved + :qty WHERE batch_id = :bid"),
                        {"qty": reserve_quantity, "bid": batch["batch_id"]},
                    )
                    db.execute(
                        text(
                            """
                            INSERT INTO inventory_reservations
                                (order_item_id, pharmacy_product_id, batch_id, quantity_reserved,
                                 reservation_status, expires_at)
                            VALUES (:item_id, :product_id, :batch_id, :qty, 'ACTIVE', DATE_ADD(NOW(), INTERVAL 30 MINUTE))
                            """
                        ),
                        {
                            "item_id": order_item_id,
                            "product_id": product["pharmacy_product_id"],
                            "batch_id": batch["batch_id"],
                            "qty": reserve_quantity,
                        },
                    )
                    remaining -= reserve_quantity
                    if remaining == 0:
                        break
                if remaining > 0:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Insufficient available stock for {product['local_product_name']}",
                    )

        db.execute(
            text(
                """
                INSERT INTO payments (order_id, payment_method, payment_status, amount)
                VALUES (:order_id, :method, 'PENDING', :amount)
                """
            ),
            {"order_id": order_id, "method": body.payment_method, "amount": subtotal},
        )
        update_order_status_history(
            db, order_id=order_id, old_status=None, new_status="PENDING",
            changed_by=user["user_id"], remarks="Order created",
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Order could not be created; check stock and product data")
    except Exception:
        db.rollback()
        raise

    return {"order_id": order_id, "order_number": order_number, "order_status": "PENDING", "total_amount": str(subtotal)}


@app.get("/api/v1/me/orders")
def my_orders(user: dict = Depends(current_user), db: Session = Depends(get_db)):
    rows = fetch_all(
        db,
        """
        SELECT order_id, order_number, subtotal, shipping_fee, discount_amount,
               total_amount, order_status, created_at
        FROM customer_orders
        WHERE customer_id = :uid
        ORDER BY created_at DESC
        """,
        {"uid": user["user_id"]},
    )
    return {"items": as_dicts(rows)}


@app.get("/api/v1/orders/{order_id}")
def order_detail(order_id: int, user: dict = Depends(current_user), db: Session = Depends(get_db)):
    order = fetch_one(db, "SELECT * FROM customer_orders WHERE order_id = :id", {"id": order_id})
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    is_customer = order["customer_id"] == user["user_id"]
    is_admin = "ADMIN" in user["roles"]
    pharmacy_filter = ""
    params: dict[str, Any] = {"oid": order_id}
    if not is_admin and not is_customer:
        memberships = fetch_all(
            db,
            """
            SELECT pm.pharmacy_id FROM pharmacy_members pm
            JOIN pharmacy_orders po ON po.pharmacy_id = pm.pharmacy_id
            WHERE po.order_id = :oid AND pm.user_id = :uid AND pm.member_status = 'ACTIVE'
            """,
            {"oid": order_id, "uid": user["user_id"]},
        )
        pharmacy_ids = [int(row["pharmacy_id"]) for row in memberships]
        if not pharmacy_ids:
            raise HTTPException(status_code=403, detail="You cannot access this order")
        pharmacy_filter = "AND po.pharmacy_id IN (" + ",".join(str(pid) for pid in pharmacy_ids) + ")"

    pharmacy_orders = as_dicts(
        fetch_all(
            db,
            f"""
            SELECT po.*, p.pharmacy_name
            FROM pharmacy_orders po JOIN pharmacies p ON p.pharmacy_id = po.pharmacy_id
            WHERE po.order_id = :oid {pharmacy_filter}
            ORDER BY po.pharmacy_order_id
            """,
            params,
        )
    )
    for pharmacy_order in pharmacy_orders:
        pharmacy_order["items"] = as_dicts(
            fetch_all(
                db,
                """
                SELECT order_item_id, pharmacy_product_id, medicine_name_snapshot,
                       quantity, unit_price, line_total
                FROM order_items WHERE pharmacy_order_id = :poid
                ORDER BY order_item_id
                """,
                {"poid": pharmacy_order["pharmacy_order_id"]},
            )
        )
        pharmacy_order["shipments"] = as_dicts(
            fetch_all(db, "SELECT * FROM shipments WHERE pharmacy_order_id = :poid", {"poid": pharmacy_order["pharmacy_order_id"]})
        )
    payment = fetch_one(db, "SELECT payment_id, payment_method, payment_status, amount, paid_at FROM payments WHERE order_id = :oid", {"oid": order_id})
    result = dict(order)
    result["pharmacy_orders"] = pharmacy_orders
    result["payment"] = as_dict(payment)
    return result


@app.get("/api/v1/pharmacies/{pharmacy_id}/orders")
def pharmacy_orders(
    pharmacy_id: int,
    order_status: str | None = None,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_pharmacy_member(db, user["user_id"], pharmacy_id)
    params: dict[str, Any] = {"pid": pharmacy_id}
    filter_sql = ""
    if order_status:
        filter_sql = "AND po.order_status = :order_status"
        params["order_status"] = order_status
    rows = fetch_all(
        db,
        f"""
        SELECT po.pharmacy_order_id, po.order_id, po.subtotal, po.shipping_fee,
               po.total_amount, po.order_status, po.created_at,
               co.order_number, co.recipient_name, co.recipient_phone,
               co.shipping_province, co.shipping_district, co.shipping_ward,
               co.shipping_street_address
        FROM pharmacy_orders po
        JOIN customer_orders co ON co.order_id = po.order_id
        WHERE po.pharmacy_id = :pid {filter_sql}
        ORDER BY po.created_at DESC
        """,
        params,
    )
    return {"items": as_dicts(rows)}


@app.patch("/api/v1/pharmacy-orders/{pharmacy_order_id}/status")
def update_pharmacy_order_status(
    pharmacy_order_id: int,
    body: PharmacyOrderStatusUpdate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    if release_expired_reservations(db):
        db.commit()
    po = fetch_one(db, "SELECT * FROM pharmacy_orders WHERE pharmacy_order_id = :id", {"id": pharmacy_order_id})
    if po is None:
        raise HTTPException(status_code=404, detail="Pharmacy order not found")
    require_pharmacy_member(db, user["user_id"], po["pharmacy_id"])
    old_status = po["order_status"]
    new_status = body.order_status
    transitions = {
        "PENDING": {"ACCEPTED", "REJECTED", "CANCELLED"},
        "ACCEPTED": {"PREPARING", "CANCELLED"},
        "PREPARING": {"READY_FOR_PICKUP", "CANCELLED"},
        "READY_FOR_PICKUP": {"SHIPPED", "COMPLETED", "CANCELLED"},
        "SHIPPED": {"COMPLETED", "CANCELLED"},
        "REJECTED": set(), "COMPLETED": set(), "CANCELLED": set(),
    }
    if new_status not in transitions.get(old_status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot change pharmacy order from {old_status} to {new_status}")

    if new_status == "ACCEPTED":
        payment = fetch_one(
            db,
            "SELECT pay.payment_method, pay.payment_status FROM payments pay JOIN customer_orders co ON co.order_id = pay.order_id WHERE co.order_id = :oid",
            {"oid": po["order_id"]},
        )
        if payment and payment["payment_method"] == "BANK_TRANSFER" and payment["payment_status"] != "PAID":
            raise HTTPException(status_code=409, detail="Bank transfer must be verified before the pharmacy accepts this order")

    if new_status not in {"REJECTED", "CANCELLED"}:
        reservation_check = fetch_all(
            db,
            """
            SELECT oi.order_item_id, oi.quantity,
                   COALESCE(SUM(CASE WHEN ir.reservation_status = 'ACTIVE' THEN ir.quantity_reserved ELSE 0 END), 0) AS reserved
            FROM order_items oi
            LEFT JOIN inventory_reservations ir ON ir.order_item_id = oi.order_item_id
            WHERE oi.pharmacy_order_id = :poid
            GROUP BY oi.order_item_id, oi.quantity
            """,
            {"poid": pharmacy_order_id},
        )
        if any(int(row["reserved"]) < int(row["quantity"]) for row in reservation_check):
            raise HTTPException(status_code=409, detail="The stock reservation expired or is incomplete. Cancel this order and ask the customer to order again")

    try:
        db.execute(
            text("UPDATE pharmacy_orders SET order_status = :status WHERE pharmacy_order_id = :id"),
            {"status": new_status, "id": pharmacy_order_id},
        )
        # Once accepted, the 30-minute checkout hold becomes a normal order hold.
        if new_status == "ACCEPTED":
            db.execute(
                text("UPDATE inventory_reservations SET expires_at = NULL WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE pharmacy_order_id = :poid) AND reservation_status = 'ACTIVE'"),
                {"poid": pharmacy_order_id},
            )
        # Rejected/cancelled orders release reserved stock. Completed orders consume it.
        if new_status in {"REJECTED", "CANCELLED"}:
            reservations = fetch_all(
                db,
                "SELECT reservation_id, batch_id, quantity_reserved FROM inventory_reservations WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE pharmacy_order_id = :poid) AND reservation_status = 'ACTIVE' FOR UPDATE",
                {"poid": pharmacy_order_id},
            )
            for reservation in reservations:
                db.execute(
                    text("UPDATE inventory_batches SET quantity_reserved = quantity_reserved - :qty WHERE batch_id = :bid"),
                    {"qty": reservation["quantity_reserved"], "bid": reservation["batch_id"]},
                )
            db.execute(
                text("UPDATE inventory_reservations SET reservation_status = 'RELEASED' WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE pharmacy_order_id = :poid) AND reservation_status = 'ACTIVE'"),
                {"poid": pharmacy_order_id},
            )
        elif new_status == "COMPLETED":
            reservations = fetch_all(
                db,
                "SELECT reservation_id, batch_id, quantity_reserved FROM inventory_reservations WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE pharmacy_order_id = :poid) AND reservation_status = 'ACTIVE' FOR UPDATE",
                {"poid": pharmacy_order_id},
            )
            for reservation in reservations:
                qty = int(reservation["quantity_reserved"])
                db.execute(
                    text("UPDATE inventory_batches SET quantity_on_hand = quantity_on_hand - :qty, quantity_reserved = quantity_reserved - :qty WHERE batch_id = :bid"),
                    {"qty": qty, "bid": reservation["batch_id"]},
                )
                db.execute(
                    text("UPDATE inventory_reservations SET reservation_status = 'CONSUMED' WHERE reservation_id = :rid"),
                    {"rid": reservation["reservation_id"]},
                )
                db.execute(
                    text("INSERT INTO stock_transactions (batch_id, transaction_type, quantity_change, performed_by, notes) VALUES (:bid, 'SALE', :qty, :uid, 'Pharmacy order completed')"),
                    {"bid": reservation["batch_id"], "qty": -qty, "uid": user["user_id"]},
                )
        update_order_status_history(
            db, pharmacy_order_id=pharmacy_order_id, old_status=old_status,
            new_status=new_status, changed_by=user["user_id"], remarks=body.remarks,
        )
        child_states = [row["order_status"] for row in fetch_all(
            db, "SELECT order_status FROM pharmacy_orders WHERE order_id = :oid", {"oid": po["order_id"]}
        )]
        if child_states and all(state == "COMPLETED" for state in child_states):
            overall_status = "COMPLETED"
        elif child_states and all(state in {"CANCELLED", "REJECTED"} for state in child_states):
            overall_status = "CANCELLED"
        elif any(state in {"COMPLETED", "CANCELLED", "REJECTED"} for state in child_states) and len(set(child_states)) > 1:
            overall_status = "PARTIALLY_COMPLETED"
        elif any(state != "PENDING" for state in child_states):
            overall_status = "PROCESSING"
        else:
            overall_status = "PENDING"
        parent = fetch_one(db, "SELECT order_status FROM customer_orders WHERE order_id = :oid", {"oid": po["order_id"]})
        if parent and parent["order_status"] != overall_status:
            db.execute(text("UPDATE customer_orders SET order_status = :status WHERE order_id = :oid"),
                       {"status": overall_status, "oid": po["order_id"]})
            update_order_status_history(
                db, order_id=po["order_id"], old_status=parent["order_status"],
                new_status=overall_status, changed_by=user["user_id"],
                remarks="Updated from pharmacy order status changes",
            )
        audit(db, user["user_id"], "UPDATE_PHARMACY_ORDER", "pharmacy_orders", pharmacy_order_id,
              {"order_status": old_status}, {"order_status": new_status})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"pharmacy_order_id": pharmacy_order_id, "order_status": new_status}


@app.get("/api/v1/pharmacy-orders/{pharmacy_order_id}/prescription-image")
def pharmacy_order_prescription_image(
    pharmacy_order_id: int,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    po = fetch_one(
        db,
        """
        SELECT co.prescription_id, po.pharmacy_id
        FROM pharmacy_orders po
        JOIN customer_orders co ON co.order_id = po.order_id
        WHERE po.pharmacy_order_id = :id
        """,
        {"id": pharmacy_order_id},
    )
    if po is None:
        raise HTTPException(status_code=404, detail="Pharmacy order not found")
    require_pharmacy_member(db, user["user_id"], po["pharmacy_id"])
    if po["prescription_id"] is None:
        raise HTTPException(status_code=404, detail="This order has no prescription")
    prescription = fetch_one(db, "SELECT image_path FROM prescriptions WHERE prescription_id = :id", {"id": po["prescription_id"]})
    if prescription is None:
        raise HTTPException(status_code=404, detail="Prescription image not found")
    return file_response(prescription["image_path"])


@app.post("/api/v1/pharmacy-orders/{pharmacy_order_id}/shipment", status_code=status.HTTP_201_CREATED)
def create_shipment(
    pharmacy_order_id: int,
    body: ShipmentCreate,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    po = fetch_one(db, "SELECT pharmacy_id FROM pharmacy_orders WHERE pharmacy_order_id = :id", {"id": pharmacy_order_id})
    if po is None:
        raise HTTPException(status_code=404, detail="Pharmacy order not found")
    require_pharmacy_member(db, user["user_id"], po["pharmacy_id"])
    try:
        result = db.execute(
            text("INSERT INTO shipments (pharmacy_order_id, courier_name, tracking_number) VALUES (:poid, :courier, :tracking)"),
            {"poid": pharmacy_order_id, "courier": body.courier_name, "tracking": body.tracking_number},
        )
        shipment_id = int(result.lastrowid)
        db.execute(
            text("INSERT INTO shipment_tracking (shipment_id, status, description, event_time) VALUES (:sid, 'ORDER_RECEIVED', 'Shipment registered by pharmacy', NOW())"),
            {"sid": shipment_id},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This courier tracking number is already registered")
    return {"shipment_id": shipment_id}


@app.get("/api/v1/orders/{order_id}/tracking")
def order_tracking(order_id: int, user: dict = Depends(current_user), db: Session = Depends(get_db)):
    order = fetch_one(db, "SELECT customer_id FROM customer_orders WHERE order_id = :id", {"id": order_id})
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if "ADMIN" not in user["roles"] and order["customer_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="You cannot access this order's tracking")
    shipments = as_dicts(
        fetch_all(
            db,
            """
            SELECT s.shipment_id, s.courier_name, s.tracking_number, s.delivery_status,
                   s.shipped_at, s.delivered_at, po.pharmacy_id, p.pharmacy_name
            FROM pharmacy_orders po
            JOIN pharmacies p ON p.pharmacy_id = po.pharmacy_id
            JOIN shipments s ON s.pharmacy_order_id = po.pharmacy_order_id
            WHERE po.order_id = :oid
            ORDER BY s.shipment_id
            """,
            {"oid": order_id},
        )
    )
    for shipment in shipments:
        shipment["events"] = as_dicts(
            fetch_all(
                db,
                "SELECT status, location, description, event_time FROM shipment_tracking WHERE shipment_id = :sid ORDER BY event_time",
                {"sid": shipment["shipment_id"]},
            )
        )
    return {"order_id": order_id, "shipments": shipments}


@app.post("/api/v1/payments/{payment_id}/proof", status_code=status.HTTP_201_CREATED)
def upload_payment_proof(
    payment_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    payment = fetch_one(
        db,
        """
        SELECT pay.payment_id, co.customer_id
        FROM payments pay JOIN customer_orders co ON co.order_id = pay.order_id
        WHERE pay.payment_id = :id
        """,
        {"id": payment_id},
    )
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment["customer_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="You cannot upload proof for this payment")
    relative_path, saved_path = save_upload(file, "payment-proofs")
    try:
        result = db.execute(
            text("INSERT INTO payment_proofs (payment_id, image_path) VALUES (:pid, :path)"),
            {"pid": payment_id, "path": relative_path},
        )
        db.commit()
    except Exception:
        db.rollback()
        saved_path.unlink(missing_ok=True)
        raise
    return {"proof_id": int(result.lastrowid), "verification_status": "PENDING"}


# -----------------------------------------------------------------------------
# Administration
# -----------------------------------------------------------------------------


@app.get("/api/v1/admin/dashboard")
def admin_dashboard(admin: dict = Depends(admin_user), db: Session = Depends(get_db)):
    stats = fetch_one(
        db,
        """
        SELECT
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM pharmacies) AS total_pharmacies,
            (SELECT COUNT(*) FROM pharmacies WHERE registration_status = 'PENDING') AS pending_pharmacies,
            (SELECT COUNT(*) FROM pharmacies WHERE registration_status = 'APPROVED' AND is_searchable = TRUE) AS searchable_pharmacies,
            (SELECT COUNT(*) FROM customer_orders WHERE order_status NOT IN ('COMPLETED', 'CANCELLED')) AS active_orders
        """,
    )
    return dict(stats)


@app.get("/api/v1/admin/users")
def admin_users(
    q: str | None = None,
    account_status: str | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    params: dict[str, Any] = {"limit": limit}
    filters = ["1 = 1"]
    if q:
        filters.append("(username LIKE :q OR full_name LIKE :q OR email LIKE :q OR phone LIKE :q)")
        params["q"] = f"%{q}%"
    if account_status:
        filters.append("account_status = :account_status")
        params["account_status"] = account_status
    rows = fetch_all(
        db,
        f"SELECT user_id, username, email, phone, full_name, account_status, created_at FROM users WHERE {' AND '.join(filters)} ORDER BY created_at DESC LIMIT :limit",
        params,
    )
    return {"items": as_dicts(rows)}


@app.post("/api/v1/admin/users", status_code=status.HTTP_201_CREATED)
def admin_create_user(
    body: AdminUserCreate,
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    try:
        result = db.execute(
            text("INSERT INTO users (username, password_hash, email, phone, full_name) VALUES (:username, :password_hash, :email, :phone, :full_name)"),
            {
                "username": body.username,
                "password_hash": hash_password(body.password),
                "email": body.email,
                "phone": body.phone,
                "full_name": body.full_name,
            },
        )
        user_id = int(result.lastrowid)
        role_id = db.execute(text("SELECT role_id FROM system_roles WHERE role_name = :role"), {"role": body.role_name}).scalar()
        if role_id is None:
            role_id = db.execute(text("INSERT INTO system_roles (role_name, description) VALUES (:role, :description)"), {"role": body.role_name, "description": body.role_name.title()}).lastrowid
        db.execute(text("INSERT INTO user_system_roles (user_id, role_id) VALUES (:uid, :rid)"), {"uid": user_id, "rid": role_id})
        audit(db, admin["user_id"], "CREATE_USER", "users", user_id, new_value={"username": body.username, "role": body.role_name})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists")
    except Exception:
        db.rollback()
        raise
    return {"user_id": user_id, "username": body.username, "role": body.role_name}


@app.patch("/api/v1/admin/users/{user_id}/status")
def admin_update_user_status(
    user_id: int,
    body: UserStatusUpdate,
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    target = fetch_one(db, "SELECT user_id, account_status FROM users WHERE user_id = :id", {"id": user_id})
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == admin["user_id"] and body.account_status != "ACTIVE":
        raise HTTPException(status_code=400, detail="You cannot disable your own administrator account")
    db.execute(text("UPDATE users SET account_status = :status WHERE user_id = :id"), {"status": body.account_status, "id": user_id})
    audit(db, admin["user_id"], "UPDATE_USER_STATUS", "users", user_id,
          {"account_status": target["account_status"]}, {"account_status": body.account_status})
    db.commit()
    return {"user_id": user_id, "account_status": body.account_status}


@app.get("/api/v1/admin/pharmacies")
def admin_pharmacies(
    q: str | None = None,
    registration_status: str | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    params: dict[str, Any] = {"limit": limit}
    filters = ["1 = 1"]
    if q:
        filters.append("(pharmacy_name LIKE :q OR license_number LIKE :q OR street_address LIKE :q)")
        params["q"] = f"%{q}%"
    if registration_status:
        filters.append("registration_status = :registration_status")
        params["registration_status"] = registration_status
    rows = fetch_all(
        db,
        f"SELECT * FROM pharmacies WHERE {' AND '.join(filters)} ORDER BY created_at DESC LIMIT :limit",
        params,
    )
    return {"items": as_dicts(rows)}


@app.get("/api/v1/admin/pharmacies/{pharmacy_id}/verifications")
def admin_pharmacy_verifications(
    pharmacy_id: int,
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    pharmacy = fetch_one(db, "SELECT pharmacy_id FROM pharmacies WHERE pharmacy_id = :id", {"id": pharmacy_id})
    if pharmacy is None:
        raise HTTPException(status_code=404, detail="Pharmacy not found")
    rows = fetch_all(
        db,
        """
        SELECT verification_id, document_type, decision, remarks, submitted_at, reviewed_at
        FROM pharmacy_verifications
        WHERE pharmacy_id = :pid
        ORDER BY submitted_at DESC
        """,
        {"pid": pharmacy_id},
    )
    return {"items": as_dicts(rows)}


@app.patch("/api/v1/admin/pharmacies/{pharmacy_id}/review")
def admin_review_pharmacy(
    pharmacy_id: int,
    body: PharmacyReview,
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    pharmacy = fetch_one(db, "SELECT * FROM pharmacies WHERE pharmacy_id = :id", {"id": pharmacy_id})
    if pharmacy is None:
        raise HTTPException(status_code=404, detail="Pharmacy not found")
    searchable = bool(body.is_searchable and body.decision == "APPROVED")
    try:
        db.execute(
            text("UPDATE pharmacies SET registration_status = :decision, is_searchable = :searchable WHERE pharmacy_id = :id"),
            {"decision": body.decision, "searchable": searchable, "id": pharmacy_id},
        )
        db.execute(
            text(
                """
                UPDATE pharmacy_verifications
                SET admin_id = :admin_id, decision = :decision, remarks = :remarks, reviewed_at = NOW()
                WHERE pharmacy_id = :pid AND decision = 'PENDING'
                """
            ),
            {"admin_id": admin["user_id"], "decision": "APPROVED" if body.decision == "APPROVED" else "REJECTED", "remarks": body.remarks, "pid": pharmacy_id},
        )
        audit(db, admin["user_id"], "REVIEW_PHARMACY", "pharmacies", pharmacy_id,
              {"registration_status": pharmacy["registration_status"], "is_searchable": pharmacy["is_searchable"]},
              {"registration_status": body.decision, "is_searchable": searchable})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"pharmacy_id": pharmacy_id, "registration_status": body.decision, "is_searchable": searchable}


@app.get("/api/v1/admin/pharmacy-suggestions")
def admin_pharmacy_suggestions(
    review_status: str | None = "PENDING",
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    if review_status:
        rows = fetch_all(db, "SELECT * FROM pharmacy_suggestions WHERE review_status = :status ORDER BY submitted_at DESC", {"status": review_status})
    else:
        rows = fetch_all(db, "SELECT * FROM pharmacy_suggestions ORDER BY submitted_at DESC")
    return {"items": as_dicts(rows)}


@app.patch("/api/v1/admin/pharmacy-suggestions/{suggestion_id}")
def review_pharmacy_suggestion(
    suggestion_id: int,
    body: SuggestionReview,
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    suggestion = fetch_one(db, "SELECT * FROM pharmacy_suggestions WHERE suggestion_id = :id", {"id": suggestion_id})
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    db.execute(
        text("UPDATE pharmacy_suggestions SET review_status = :status, reviewed_by = :uid, reviewed_at = NOW(), review_remarks = :remarks WHERE suggestion_id = :id"),
        {"status": body.review_status, "uid": admin["user_id"], "remarks": body.remarks, "id": suggestion_id},
    )
    audit(db, admin["user_id"], "REVIEW_PHARMACY_SUGGESTION", "pharmacy_suggestions", suggestion_id,
          {"review_status": suggestion["review_status"]}, {"review_status": body.review_status})
    db.commit()
    return {"suggestion_id": suggestion_id, "review_status": body.review_status}


@app.get("/api/v1/admin/audit-logs")
def admin_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    rows = fetch_all(
        db,
        """
        SELECT al.audit_id, al.user_id, u.username, al.action, al.entity_type,
               al.entity_id, al.old_value, al.new_value, al.ip_address, al.created_at
        FROM audit_logs al LEFT JOIN users u ON u.user_id = al.user_id
        ORDER BY al.created_at DESC LIMIT :limit
        """,
        {"limit": limit},
    )
    return {"items": as_dicts(rows)}


@app.patch("/api/v1/admin/payment-proofs/{proof_id}/review")
def admin_review_payment_proof(
    proof_id: int,
    body: PaymentReview,
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    proof = fetch_one(db, "SELECT * FROM payment_proofs WHERE proof_id = :id", {"id": proof_id})
    if proof is None:
        raise HTTPException(status_code=404, detail="Payment proof not found")
    try:
        db.execute(
            text("UPDATE payment_proofs SET verification_status = :status, verified_by = :uid, verification_notes = :notes, verified_at = NOW() WHERE proof_id = :id"),
            {"status": body.verification_status, "uid": admin["user_id"], "notes": body.verification_notes, "id": proof_id},
        )
        payment_status = "PAID" if body.verification_status == "VERIFIED" else "FAILED"
        db.execute(
            text("UPDATE payments SET payment_status = :status, paid_at = CASE WHEN :status = 'PAID' THEN NOW() ELSE NULL END WHERE payment_id = :pid"),
            {"status": payment_status, "pid": proof["payment_id"]},
        )
        audit(db, admin["user_id"], "REVIEW_PAYMENT_PROOF", "payment_proofs", proof_id,
              {"verification_status": proof["verification_status"]}, {"verification_status": body.verification_status})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"proof_id": proof_id, "verification_status": body.verification_status, "payment_status": payment_status}


@app.get("/api/v1/admin/pharmacy-verifications/{verification_id}/document")
def admin_view_pharmacy_document(
    verification_id: int,
    admin: dict = Depends(admin_user),
    db: Session = Depends(get_db),
):
    verification = fetch_one(db, "SELECT document_path FROM pharmacy_verifications WHERE verification_id = :id", {"id": verification_id})
    if verification is None:
        raise HTTPException(status_code=404, detail="Verification document not found")
    return file_response(verification["document_path"])
