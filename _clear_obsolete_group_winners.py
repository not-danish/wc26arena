"""R32 fixtures now contain real teams (no more "1A"/"2B" placeholders),
so the data/group_winners node is obsolete. Wipe it."""
import os
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

db.reference("data/group_winners").delete()
print("Cleared data/group_winners")
