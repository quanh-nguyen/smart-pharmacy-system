import os

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "pharmacy_marketplace_demo")
DB_USER = os.getenv("DB_USER", "pharmacy_api")
DB_PASSWORD = os.getenv("DB_PASSWORD", "change-me-api-db-password")

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-before-use")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "720"))

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "https://sn-hwang.github.io,http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000",
    ).split(",")
    if origin.strip()
]
