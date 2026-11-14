"""Set a real password for a seeded demo user.

Run inside the API container, for example:
  python -m app.set_password site_admin 'Use-A-Long-Local-Password'
"""
import argparse

from sqlalchemy import text

from .database import SessionLocal
from .security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="Set a password for an existing pharmacy user")
    parser.add_argument("username")
    parser.add_argument("password")
    args = parser.parse_args()

    if len(args.password) < 10:
        parser.error("Password must be at least 10 characters")

    db = SessionLocal()
    try:
        result = db.execute(
            text("UPDATE users SET password_hash = :password_hash WHERE username = :username"),
            {"password_hash": hash_password(args.password), "username": args.username},
        )
        if result.rowcount == 0:
            db.rollback()
            raise SystemExit(f"User not found: {args.username}")
        db.commit()
        print(f"Password updated for {args.username}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
