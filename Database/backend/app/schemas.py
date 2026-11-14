from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=10, max_length=128)
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=30)


class LoginRequest(BaseModel):
    username: str
    password: str


class PharmacyCreate(BaseModel):
    pharmacy_name: str = Field(min_length=2, max_length=255)
    license_number: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    province: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    ward: str | None = Field(default=None, max_length=100)
    street_address: str = Field(min_length=3, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class PharmacyUpdate(BaseModel):
    pharmacy_name: str | None = Field(default=None, min_length=2, max_length=255)
    phone: str | None = Field(default=None, min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    province: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    ward: str | None = Field(default=None, max_length=100)
    street_address: str | None = Field(default=None, min_length=3, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=10, max_length=128)
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    role_name: Literal["CUSTOMER"] = "CUSTOMER"


class PharmacySuggestionCreate(BaseModel):
    pharmacy_name: str = Field(min_length=2, max_length=255)
    address: str = Field(min_length=3, max_length=1000)
    phone: str | None = Field(default=None, max_length=30)
    opening_hours: str | None = None
    website: str | None = Field(default=None, max_length=500)
    additional_info: str | None = None


class PharmacyReview(BaseModel):
    decision: Literal["APPROVED", "REJECTED", "SUSPENDED"]
    is_searchable: bool = False
    remarks: str | None = None


class SuggestionReview(BaseModel):
    review_status: Literal["ACCEPTED", "REJECTED"]
    remarks: str | None = None


class UserStatusUpdate(BaseModel):
    account_status: Literal["ACTIVE", "SUSPENDED", "DISABLED"]


class BatchInput(BaseModel):
    batch_number: str = Field(min_length=1, max_length=100)
    quantity_on_hand: int = Field(ge=0)
    expiration_date: date
    purchase_price: Decimal = Field(default=Decimal("0"), ge=0)


class ProductCreate(BaseModel):
    medicine_id: int | None = None
    local_product_name: str = Field(min_length=1, max_length=255)
    package_description: str | None = Field(default=None, max_length=100)
    barcode: str | None = Field(default=None, max_length=100)
    selling_price: Decimal = Field(ge=0)
    is_available: bool = True
    initial_batch: BatchInput | None = None


class ProductUpdate(BaseModel):
    local_product_name: str | None = Field(default=None, min_length=1, max_length=255)
    package_description: str | None = Field(default=None, max_length=100)
    barcode: str | None = Field(default=None, max_length=100)
    selling_price: Decimal | None = Field(default=None, ge=0)
    is_available: bool | None = None


class BatchCreate(BatchInput):
    pass


class BatchUpdate(BaseModel):
    quantity_on_hand: int | None = Field(default=None, ge=0)
    expiration_date: date | None = None
    purchase_price: Decimal | None = Field(default=None, ge=0)


class PrescriptionItemInput(BaseModel):
    medicine_id: int | None = None
    recognized_name: str = Field(min_length=1, max_length=255)
    required_quantity: int | None = Field(default=None, gt=0)
    dosage_instruction: str | None = None


class PrescriptionItemsReplace(BaseModel):
    items: list[PrescriptionItemInput]


class AddressCreate(BaseModel):
    recipient_name: str = Field(min_length=1, max_length=255)
    recipient_phone: str = Field(min_length=5, max_length=30)
    province: str = Field(min_length=1, max_length=100)
    district: str = Field(min_length=1, max_length=100)
    ward: str | None = Field(default=None, max_length=100)
    street_address: str = Field(min_length=1, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_default: bool = False


class OrderItemInput(BaseModel):
    pharmacy_product_id: int = Field(gt=0)
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    address_id: int
    prescription_id: int | None = None
    payment_method: Literal["BANK_TRANSFER", "CASH_ON_DELIVERY"]
    items: list[OrderItemInput] = Field(min_length=1)


class PharmacyOrderStatusUpdate(BaseModel):
    order_status: Literal[
        "ACCEPTED", "REJECTED", "PREPARING", "READY_FOR_PICKUP",
        "SHIPPED", "COMPLETED", "CANCELLED"
    ]
    remarks: str | None = None


class ShipmentCreate(BaseModel):
    courier_name: str = Field(min_length=1, max_length=100)
    tracking_number: str | None = Field(default=None, max_length=255)


class PaymentReview(BaseModel):
    verification_status: Literal["VERIFIED", "REJECTED"]
    verification_notes: str | None = None
