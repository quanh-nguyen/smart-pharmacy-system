"""Data models for Smart Pharmacy System"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class Drug:
    """Mô hình dữ liệu cho thuốc"""
    id: int
    name: str
    description: str
    usage: str  # Cách dùng
    side_effects: str  # Tác dụng phụ
    contraindication: str  # Chống chỉ định
    created_at: Optional[datetime] = None


@dataclass
class Pharmacy:
    """Mô hình dữ liệu cho hiệu thuốc"""
    id: int
    name: str
    address: str
    latitude: float
    longitude: float
    phone: Optional[str] = None
    opening_hours: Optional[str] = None
    created_at: Optional[datetime] = None


@dataclass
class Inventory:
    """Mô hình dữ liệu cho kho hàng"""
    id: int
    pharmacy_id: int
    drug_id: int
    quantity: int
    price: float


@dataclass
class Location:
    """Mô hình dữ liệu cho vị trí"""
    latitude: float
    longitude: float
    name: Optional[str] = None


@dataclass
class Route:
    """Mô hình dữ liệu cho đường đi"""
    pharmacy_id: int
    pharmacy_name: str
    distance: float  # km
    duration: Optional[float] = None  # phút
    waypoints: Optional[list] = None  # danh sách điểm dừng
