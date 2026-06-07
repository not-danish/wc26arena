"""Clear image_url for a single player by id. Repeat as needed."""
import os
import sys
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

if len(sys.argv) < 2:
    sys.exit("Usage: _fix_one.py <player_id> [club_override]")
pid = sys.argv[1]
club = sys.argv[2] if len(sys.argv) > 2 else None

ref = db.reference(f"data/players/{pid}")
before = ref.get()
if not before:
    sys.exit(f"No player at id {pid}")
print(f"Before: name={before.get('player_name')} club={before.get('club')!r} image={before.get('image_url')}")

patch = {"image_url": None}
if club:
    patch["club"] = club
ref.update(patch)
after = ref.get()
print(f"After:  name={after.get('player_name')} club={after.get('club')!r} image={after.get('image_url')}")
