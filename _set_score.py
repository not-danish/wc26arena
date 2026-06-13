"""Quickly set a manual score for a match. Useful while TheSportsDB has no
WC26 coverage. Edit the values and run.

Usage:
    .venv/bin/python _set_score.py
"""
import os
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

# ---- edit these ----
MATCH_ID = "m001"   # Mexico vs South Africa, opening match
HOME_SCORE = 2
AWAY_SCORE = 1
STATUS = "ft"       # "live" | "ft" | "" (clear)
MINUTE = "FT"       # any label; for live use e.g. "67'"
# ---- /edit ----

if not STATUS:
    db.reference(f"data/scores/{MATCH_ID}").delete()
    print(f"Cleared score for {MATCH_ID}.")
else:
    entry = {
        "home_score": HOME_SCORE,
        "away_score": AWAY_SCORE,
        "status": STATUS,
        "minute": MINUTE,
    }
    db.reference(f"data/scores/{MATCH_ID}").set(entry)
    print(f"Set {MATCH_ID}: {entry}")
