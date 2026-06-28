"""Seed group winners + best-3rd team into Firebase so the bracket page
renders real team names instead of "1A" / "Best 3rd" placeholders.

Run once after group stage. Admin can overwrite via /api/admin/bracket later.
"""
import os
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

group_winners = {
    "1A": "Mexico",        "2A": "South Korea",
    "1B": "Switzerland",   "2B": "Canada",
    "1C": "Brazil",        "2C": "Morocco",
    "1D": "United States", "2D": "Australia",
    "1E": "Germany",       "2E": "Curaçao",
    "1F": "Japan",         "2F": "Netherlands",
    "1G": "Belgium",       "2G": "Egypt",
    "1H": "Spain",         "2H": "Uruguay",
    "1I": "France",        "2I": "Norway",
    "1J": "Argentina",     "2J": "Algeria",
    "1K": "Portugal",      "2K": "Colombia",
    "1L": "England",       "2L": "Croatia",
}
db.reference("data/group_winners").set(group_winners)
print(f"Set {len(group_winners)} group winner slots")
