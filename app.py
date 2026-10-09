"""Smart Pharmacy System - Main Flask Application"""
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from pathlib import Path
import sqlite3
import os

app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "database" / "pharmacy.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Import blueprints (sẽ tạo sau)
# from api import drugs, pharmacy, routes


def get_db_connection():
    """Tạo kết nối đến database"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Khởi tạo database"""
    if DB_PATH.exists():
        return
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Tạo bảng drugs (thuốc)
    cursor.execute("""
        CREATE TABLE drugs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            usage TEXT,
            side_effects TEXT,
            contraindication TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Tạo bảng pharmacies (hiệu thuốc)
    cursor.execute("""
        CREATE TABLE pharmacies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            phone TEXT,
            opening_hours TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Tạo bảng inventory (kho hàng - thuốc tại hiệu thuốc)
    cursor.execute("""
        CREATE TABLE inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pharmacy_id INTEGER NOT NULL,
            drug_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 0,
            price REAL NOT NULL,
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
            FOREIGN KEY (drug_id) REFERENCES drugs(id),
            UNIQUE(pharmacy_id, drug_id)
        )
    """)
    
    # Tạo bảng graph_edges (để tính đường đi)
    cursor.execute("""
        CREATE TABLE graph_edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_lat REAL NOT NULL,
            from_lng REAL NOT NULL,
            to_lat REAL NOT NULL,
            to_lng REAL NOT NULL,
            distance REAL NOT NULL
        )
    """)
    
    # Thêm dữ liệu mẫu
    # Thêm thuốc
    drugs_data = [
        ("Aspirin", "Giảm đau, hạ sốt", "1-2 viên mỗi 4-6 giờ", "Chóng mặt, buồn nôn", "Dị ứng với Aspirin"),
        ("Paracetamol", "Giảm đau, hạ sốt", "500mg-1000mg mỗi 4-6 giờ", "Tổn thương gan", "Suy gan"),
        ("Ibuprofen", "Giảm đau, chống viêm", "200-400mg mỗi 4-6 giờ", "Rối loạn tiêu hóa", "Loét dạ dày"),
        ("Amoxicillin", "Kháng sinh", "500mg x 3 lần/ngày", "Dị ứng", "Dị ứng penicillin"),
        ("Vitamin C", "Tăng miễn dịch", "1-2 viên/ngày", "Rất ít", "Không"),
    ]
    
    cursor.executemany(
        "INSERT INTO drugs (name, description, usage, side_effects, contraindication) VALUES (?, ?, ?, ?, ?)",
        drugs_data
    )
    
    # Thêm hiệu thuốc
    pharmacies_data = [
        ("Nhà Thuốc Trung Ương", "123 Đường Tây Sơn, Hà Nội", 21.0085, 105.8248, "02438335566", "7:00-22:00"),
        ("Nhà Thuốc An Thịnh", "456 Đường Láng, Hà Nội", 21.0173, 105.8144, "02435568888", "7:00-23:00"),
        ("Nhà Thuốc Thanh Bình", "789 Đường Yên Phô, Hà Nội", 21.0285, 105.8542, "02437688999", "8:00-21:00"),
        ("Nhà Thuốc Phương Nam", "321 Đường Hàng Bạc, Hà Nội", 21.0295, 105.8540, "02437777888", "7:30-22:30"),
    ]
    
    cursor.executemany(
        "INSERT INTO pharmacies (name, address, latitude, longitude, phone, opening_hours) VALUES (?, ?, ?, ?, ?, ?)",
        pharmacies_data
    )
    
    # Thêm kho hàng mẫu
    inventory_data = [
        (1, 1, 50, 25000),   # Nhà Thuốc Trung Ương - Aspirin
        (1, 2, 100, 15000),  # Nhà Thuốc Trung Ương - Paracetamol
        (1, 3, 30, 50000),   # Nhà Thuốc Trung Ương - Ibuprofen
        (2, 1, 20, 26000),   # Nhà Thuốc An Thịnh - Aspirin
        (2, 4, 40, 120000),  # Nhà Thuốc An Thịnh - Amoxicillin
        (3, 2, 80, 16000),   # Nhà Thuốc Thanh Bình - Paracetamol
        (3, 5, 200, 80000),  # Nhà Thuốc Thanh Bình - Vitamin C
        (4, 1, 35, 25500),   # Nhà Thuốc Phương Nam - Aspirin
        (4, 3, 25, 52000),   # Nhà Thuốc Phương Nam - Ibuprofen
    ]
    
    cursor.executemany(
        "INSERT INTO inventory (pharmacy_id, drug_id, quantity, price) VALUES (?, ?, ?, ?)",
        inventory_data
    )
    
    conn.commit()
    conn.close()


@app.route("/")
def index():
    """Trang chính"""
    return render_template("index.html")


@app.route("/search")
def search():
    """Trang tìm kiếm thuốc"""
    return render_template("search.html")


@app.route("/map")
def map_view():
    """Trang bản đồ & chỉ đường"""
    return render_template("map.html")


@app.route("/api/health")
def health():
    """Health check endpoint"""
    return jsonify({"status": "ok", "app": "Smart Pharmacy System"})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, host="0.0.0.0", port=5000)
