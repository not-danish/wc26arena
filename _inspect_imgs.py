"""Inspect the image_url field on a handful of player records."""
import os
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

raw = db.reference("data/players").get() or {}
if isinstance(raw, list):
    raw = {str(i): v for i, v in enumerate(raw) if v}

print("Sample of 8 player records (raw keys):\n")
shown = 0
for pid, p in raw.items():
    print(f"--- {pid} ---")
    for k, v in p.items():
        if isinstance(v, str) and len(v) > 90:
            v = v[:90] + "..."
        print(f"  {k!r:<20} {v!r}")
    shown += 1
    if shown >= 8:
        break

# Field-name frequency across the whole DB
from collections import Counter
keys = Counter()
img_field_samples = {}
for p in raw.values():
    keys.update(p.keys())
    for k, v in p.items():
        if 'img' in k.lower() or 'image' in k.lower() or 'photo' in k.lower() or 'pic' in k.lower():
            img_field_samples.setdefault(k, str(v)[:80])

print("\nField name frequency across all", len(raw), "players:")
for k, n in keys.most_common():
    print(f"  {k:<20} {n}")

print("\nImage-ish field samples:")
for k, v in img_field_samples.items():
    print(f"  {k}: {v}")
