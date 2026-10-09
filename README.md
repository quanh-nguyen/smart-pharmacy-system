# Hệ Thống Nhà Thuốc Thông Minh

Ứng dụng giúp người dùng tìm kiếm thuốc và xác định đường đi ngắn nhất đến hiệu thuốc gần nhất có sẵn thuốc cần tìm.

## Tính Năng
- 🔍 **Tìm kiếm thuốc**: Tìm kiếm thuốc theo tên, công dụng, thành phần
- 📍 **Định vị vị trí**: Xác định hiệu thuốc gần nhất có thuốc
- 🗺️ **Tính toán đường đi**: Tìm đường đi ngắn nhất (Dijkstra algorithm)
- 📊 **Thông tin chi tiết**: Giá cả, liều dùng, chỉ định, contraindication
- 💾 **Lưu yêu thích**: Lưu các thuốc hay sử dụng

## Công Nghệ
- **Backend**: Python 3.9+ (Flask)
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Database**: SQLite
- **Maps**: OpenStreetMap (Leaflet.js) hoặc Google Maps API
- **Algorithm**: Dijkstra's shortest path

## Cài Đặt

```bash
# Clone repo
git clone https://github.com/quanh-nguyen/he-thong-nha-thuoc.git
cd he-thong-nha-thuoc

# Tạo virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Cài đặt dependencies
pip install -r requirements.txt

# Chạy ứng dụng
python app.py
```

Mở trình duyệt: `http://localhost:5000`

## Cấu Trúc Dự Án

```
├── app.py                    # Flask app chính
├── models.py                 # Models (Drug, Pharmacy, User, etc)
├── database/
│   └── schema.sql            # SQL schema
│   └── seed_data.sql         # Dữ liệu mẫu
├── services/
│   ├── drug_service.py       # Tìm kiếm & lọc thuốc
│   ├── pharmacy_service.py   # Quản lý hiệu thuốc
│   └── routing_service.py    # Tính toán đường đi (Dijkstra)
├── api/
│   ├── drugs.py              # API endpoint cho thuốc
│   ├── pharmacy.py           # API endpoint cho hiệu thuốc
│   └── routes.py             # API endpoint cho đường đi
├── templates/
│   ├── index.html            # Trang chính
│   ├── search.html           # Trang tìm kiếm
│   └── map.html              # Trang bản đồ
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── search.js
│       └── map.js
└── requirements.txt
```

## API Endpoints

### Tìm Kiếm Thuốc
```
GET /api/drugs/search?q=aspirin
GET /api/drugs/<id>
```

### Hiệu Thuốc
```
GET /api/pharmacy/list
GET /api/pharmacy/<id>
POST /api/pharmacy/nearest?lat=21.0285&lng=105.8542&drug_id=1
```

### Tính Toán Đường Đi
```
POST /api/route/shortest
{
  "start_lat": 21.0285,
  "start_lng": 105.8542,
  "end_pharmacy_id": 1
}
```

## Phát Triển

Tuỳ chỉnh trong `config.py`:
- `DATABASE_URL`: Đường dẫn database
- `MAPS_API_KEY`: API key cho Google Maps (tuỳ chọn)
- `MAX_DISTANCE`: Bán kính tìm kiếm hiệu thuốc (km)

## Giấy Phép

MIT License
