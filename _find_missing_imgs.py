"""List players with a missing or obviously-bad image_url."""
import os
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

raw = db.reference("data/players").get() or {}
if isinstance(raw, list):
    raw = {str(i): v for i, v in enumerate(raw) if v}

BAD_SUBSTRINGS = ("player_0.svg",)

missing = []
for pid, p in raw.items():
    url = (p.get("image_url") or "").strip()
    if not url:
        reason = "(no image_url field)"
    elif any(s in url for s in BAD_SUBSTRINGS):
        reason = "(silhouette placeholder)"
    else:
        continue
    missing.append((pid, p.get("player_name"), p.get("country"), p.get("position"), p.get("ELO", 0), reason))

missing.sort(key=lambda r: -r[4])
print(f"{len(missing)} players missing images:\n")
for pid, name, country, pos, elo, reason in missing:
    print(f"  {pid:<10} {name:<32} {country:<25} {pos:<4} ELO {elo:<5} {reason}")
