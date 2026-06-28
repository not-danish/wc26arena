"""Apply images for Frans Putros, Cyle Larin, Jacob Shaffelburg."""
import os
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

raw = db.reference("data/players").get() or {}
if isinstance(raw, list):
    raw = {str(i): v for i, v in enumerate(raw) if v}

# Find pids by name search since we're not sure of IDs for Larin/Shaffelburg
name_to_pid = {}
for pid, p in raw.items():
    name = (p.get("player_name") or "").lower()
    name_to_pid[name] = pid

UPDATES = [
    ("Frans Putros",     "34199262",
     "https://r2.thesportsdb.com/images/media/player/cutout/rsb4v11654788134.png"),
    ("Cyle Larin",       name_to_pid.get("cyle larin"),
     "https://r2.thesportsdb.com/images/media/player/cutout/bgse2n1777485421.png"),
    ("Jacob Shaffelburg", name_to_pid.get("jacob shaffelburg"),
     "https://r2.thesportsdb.com/images/media/player/cutout/rj1wn11778158071.png"),
]

for name, pid, url in UPDATES:
    if not pid:
        print(f"  SKIP  {name} — pid not found in DB")
        continue
    rec = db.reference(f"data/players/{pid}").get()
    if not rec:
        print(f"  SKIP  {pid} {name} — no record")
        continue
    db.reference(f"data/players/{pid}/image_url").set(url)
    print(f"  OK    {pid:<22} {name}")

print("\nDone.")
