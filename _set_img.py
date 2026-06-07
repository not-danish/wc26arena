import os, sys
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app
load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})
pid, url = sys.argv[1], sys.argv[2]
db.reference(f"data/players/{pid}/image_url").set(url)
print("ok ->", db.reference(f"data/players/{pid}").get())
