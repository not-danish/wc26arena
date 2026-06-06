"""
Normalize player positions in Firebase to a clean four-bucket taxonomy:
GK / DEF / MID / FWD.

Source of truth: Wikipedia's GK/DF/MF/FW codes captured in resolved.json
during the original seed. Where Wikipedia is missing or unclear, falls
back to keyword-matching TheSportsDB's strPosition string.

Run once after a seed:

    python normalize_positions.py        # dry run, prints what would change
    python normalize_positions.py --apply # actually patches Firebase
"""

import os
import re
import sys
import json
import argparse
from collections import Counter

from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

RESOLVED_FILE = "resolved.json"

WIKI_BUCKET = {"GK": "GK", "DF": "DEF", "MF": "MID", "FW": "FWD"}

SDB_KEYWORDS = [
    ("keeper",   "GK"),
    ("goal",     "GK"),
    ("back",     "DEF"),   # centre-back, right-back, left-back
    ("defend",   "DEF"),
    ("midfield", "MID"),
    ("midfielder","MID"),
    ("winger",   "FWD"),
    ("wing",     "FWD"),   # left wing / right wing
    ("forward",  "FWD"),
    ("striker",  "FWD"),
    ("attacker", "FWD"),
]


def bucket_from_wiki(position_short):
    if not position_short:
        return None
    # Strings look like "1GK" / "2DF" / "3MF" / "4FW". Strip leading digits.
    m = re.search(r"([A-Z]{2})$", position_short)
    if not m:
        return None
    return WIKI_BUCKET.get(m.group(1))


def bucket_from_sdb(position_full):
    if not position_full:
        return None
    s = position_full.lower()
    for kw, bucket in SDB_KEYWORDS:
        if kw in s:
            return bucket
    return None


def canonical(player):
    return bucket_from_wiki(player.get("position_short")) \
        or bucket_from_sdb(player.get("position_full")) \
        or "MID"  # safe default when both signals fail


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="actually write to Firebase (otherwise dry-run)")
    args = parser.parse_args()

    if not os.path.exists(RESOLVED_FILE):
        sys.exit(f"{RESOLVED_FILE} not found. Run the seed first.")

    with open(RESOLVED_FILE) as f:
        resolved = json.load(f)

    # Build the canonical position per player id.
    new_positions = {}
    counts = Counter()
    source_counts = Counter()
    for info in resolved.values():
        for p in info["players"]:
            pid = p.get("sportsdb_id")
            if not pid:
                # Slug-keyed unresolved players use the same scheme as the seeder.
                slug = re.sub(r"[^a-z0-9]+", "_", p["player_name"].lower()).strip("_")
                pid = f"wc_{slug}"
            bucket = canonical(p)
            new_positions[pid] = bucket
            counts[bucket] += 1
            source_counts["wiki" if bucket_from_wiki(p.get("position_short")) else
                          "sdb" if bucket_from_sdb(p.get("position_full")) else "default"] += 1

    print(f"Computed positions for {len(new_positions)} players.")
    print(f"  Bucket totals: {dict(counts)}")
    print(f"  Source:        {dict(source_counts)}")

    load_dotenv()
    cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
    initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

    players_ref = db.reference("data/players")
    print("Reading current data/players for diff...")
    current = players_ref.get() or {}
    if isinstance(current, list):
        current = {str(i): v for i, v in enumerate(current) if v}

    changes = {}
    samples = []
    for pid, new_pos in new_positions.items():
        rec = current.get(pid)
        if rec is None:
            continue
        if rec.get("position") != new_pos:
            changes[f"{pid}/position"] = new_pos
            if len(samples) < 12:
                samples.append((rec.get("player_name", "?"), rec.get("position", "?"), new_pos))

    print(f"\n{len(changes)} player(s) will be updated.")
    print("Sample changes:")
    for name, before, after in samples:
        print(f"  {name:30s}  {before!r}  ->  {after}")

    if not changes:
        print("Nothing to do.")
        return

    if not args.apply:
        print("\nDry run. Re-run with --apply to write to Firebase.")
        return

    # Firebase multi-path update keys are relative to the ref.
    players_ref.update(changes)
    print(f"Updated {len(changes)} position(s) in Firebase.")


if __name__ == "__main__":
    main()
