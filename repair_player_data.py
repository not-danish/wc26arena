"""
Audit + repair player records whose seed picked the wrong SportsDB person.

For each player in resolved.json, re-fetch SportsDB's lookupplayer to see if
the resolved record's club aligns with the Wikipedia squad's club. When the
two disagree (Reece James seed -> Rotherham, Wikipedia squad -> Chelsea),
the SportsDB record is the wrong person; we:

    - NULL out image_url in Firebase  (so the silhouette renders)
    - overwrite club with the Wikipedia value (it's authoritative)

Players whose SportsDB record agrees with Wikipedia are left untouched.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
from collections import Counter

import requests
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

RESOLVED_FILE = "resolved.json"
SPORTSDB_KEY = "3"
SPORTSDB_DELAY_SEC = 1.6
NON_FOOTBALL = re.compile(r"\b(catcher|pitcher|driver|tennis|fighter|diver|quarterback|wrestler|boxer)\b", re.I)

# Aggressive club normalizer designed to collapse cosmetic differences
# so we only flag genuinely different clubs.
NOISE_TOKENS = {
    "fc", "cf", "afc", "sc", "fk", "ac", "sv", "vfb", "vfl",
    "club", "the", "and", "de", "del", "do", "da", "of",
    "ii", "b", "u21", "u23",
    # Common transliteration/article noise.
    "al", "el", "as", "ss",
}
# Expansions: things that should normalize to the same canonical form.
CLUB_ALIASES = {
    "psg": "paris saint germain",
    "paris sg": "paris saint germain",
    "saint germain": "paris saint germain",
    "man city": "manchester city",
    "man utd": "manchester united",
    "man united": "manchester united",
    "spurs": "tottenham hotspur",
    "wolves": "wolverhampton wanderers",
    "brighton hove albion": "brighton albion",
    "brighton and hove albion": "brighton albion",
    "leicester": "leicester city",
    "newcastle": "newcastle united",
    "west ham": "west ham united",
    "leeds": "leeds united",
}
def club_signature(s):
    if not s:
        return ""
    s = s.lower()
    # Replace & with " and " before anything else.
    s = s.replace("&", " and ")
    s = re.sub(r"[\.\-_/']", " ", s)
    s = re.sub(r"[^a-z0-9 áéíóúñüçãõ]", " ", s)
    # Strip diacritics with a small ad-hoc map (enough for the names we hit).
    s = (s.replace("á","a").replace("é","e").replace("í","i").replace("ó","o")
           .replace("ú","u").replace("ñ","n").replace("ü","u").replace("ç","c")
           .replace("ã","a").replace("õ","o"))
    s = re.sub(r"\s+", " ", s).strip()
    if s in CLUB_ALIASES:
        s = CLUB_ALIASES[s]
    toks = [t for t in s.split() if t and t not in NOISE_TOKENS]
    return " ".join(sorted(toks))


def clubs_disagree(a, b):
    """True when the two clubs are unambiguously different.

    Uses sorted-token equality first, then substring containment (catches
    'Real Madrid' vs 'Real Madrid CF' even after token dedup).
    """
    sa, sb = club_signature(a), club_signature(b)
    if not sa or not sb:
        return False
    if sa == sb:
        return False
    if sa in sb or sb in sa:
        return False
    return True


def lookup_sportsdb(sid):
    url = f"https://www.thesportsdb.com/api/v1/json/{SPORTSDB_KEY}/lookupplayer.php?id={urllib.parse.quote(str(sid))}"
    try:
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            return None
        data = r.json() or {}
    except Exception as e:
        print(f"    ! lookup error {sid}: {e}")
        return None
    players = data.get("players") or []
    return players[0] if players else None


def search_sportsdb(name):
    """Fallback path: name search returns a list, pick the first soccer hit."""
    url = (f"https://www.thesportsdb.com/api/v1/json/{SPORTSDB_KEY}"
           f"/searchplayers.php?p={urllib.parse.quote(name)}")
    try:
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            return None
        data = r.json() or {}
    except Exception as e:
        print(f"    ! search error for {name}: {e}")
        return None
    players = data.get("player") or []
    soccer = [p for p in players if p.get("strSport") == "Soccer"]
    return (soccer[0] if soccer else (players[0] if players else None))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="actually patch Firebase (otherwise dry-run)")
    ap.add_argument("--limit", type=int, default=0,
                    help="only audit N players (for testing)")
    ap.add_argument("--include-missing", action="store_true",
                    help="also clear records where SportsDB returns 404 "
                         "(otherwise treated as 'unknown', not 'wrong')")
    args = ap.parse_args()

    if not os.path.exists(RESOLVED_FILE):
        sys.exit(f"{RESOLVED_FILE} not found.")
    with open(RESOLVED_FILE) as f:
        resolved = json.load(f)

    load_dotenv()
    cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
    initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

    players_ref = db.reference("data/players")
    current = players_ref.get() or {}
    if isinstance(current, list):
        current = {str(i): v for i, v in enumerate(current) if v}

    all_players = []
    for info in resolved.values():
        for p in info["players"]:
            if p.get("sportsdb_id"):
                all_players.append(p)
    if args.limit:
        all_players = all_players[:args.limit]
    print(f"Auditing {len(all_players)} players (sleep {SPORTSDB_DELAY_SEC}s between calls)...\n")

    mismatches = []
    reasons = Counter()
    seen_sids = {}

    for i, p in enumerate(all_players, 1):
        sid = p["sportsdb_id"]
        wiki_club = p.get("club") or ""
        rec = lookup_sportsdb(sid)
        time.sleep(SPORTSDB_DELAY_SEC)

        # lookupplayer is flaky on the free key; fall back to name search so we
        # don't lose Reece James / Rodri etc to a 404 we know is transient.
        if not rec:
            rec = search_sportsdb(p["player_name"])
            time.sleep(SPORTSDB_DELAY_SEC)
            if not rec:
                mismatches.append((p, "no_sdb_record"))
                reasons["no_sdb_record"] += 1
                continue

        sdb_position = rec.get("strPosition") or ""
        sdb_team = rec.get("strTeam") or ""

        flags = []
        if NON_FOOTBALL.search(sdb_position):
            flags.append(f"non-football: {sdb_position!r}")
        if clubs_disagree(wiki_club, sdb_team):
            flags.append(f"club mismatch: wiki={wiki_club!r} sdb={sdb_team!r}")
        if sid in seen_sids and seen_sids[sid] != p["player_name"]:
            flags.append(f"id collision with {seen_sids[sid]}")
        seen_sids[sid] = p["player_name"]

        if flags:
            mismatches.append((p, "; ".join(flags)))
            for f in flags:
                reasons[f.split(":")[0]] += 1

        if i % 50 == 0:
            print(f"  audited {i}/{len(all_players)}, {len(mismatches)} mismatches so far")

    # Split: wrong-player evidence vs SportsDB simply not returning a record.
    # The latter is "unknown" rather than "wrong" — those IDs were resolvable
    # at seed time, so the player likely exists; lookupplayer is just being
    # rate-limited or has a missing index. Don't punish them by clearing data.
    confirmed_wrong = [(p, w) for p, w in mismatches if w != "no_sdb_record"]
    missing_only    = [(p, w) for p, w in mismatches if w == "no_sdb_record"]

    print(f"\nAudit complete.")
    print(f"  Total audited:        {len(all_players)}")
    print(f"  Confirmed wrong:      {len(confirmed_wrong)}")
    print(f"  SportsDB had no record: {len(missing_only)} (left untouched unless --include-missing)")
    print(f"  By reason:            {dict(reasons)}")
    print()
    print("Confirmed wrong-player records (will be patched):")
    for p, why in confirmed_wrong:
        print(f"  {p['player_name']:30s} ({p['country']:18s}) wiki_club={p.get('club')!r} -- {why}")

    targets = confirmed_wrong + (missing_only if args.include_missing else [])
    if not targets:
        return

    # Build the Firebase patch.
    patch = {}
    for p, _ in targets:
        pid = p["sportsdb_id"]
        if pid not in current:
            continue
        patch[f"{pid}/image_url"] = None
        # Overwrite club only when Wikipedia has a value.
        wclub = (p.get("club") or "").strip()
        if wclub:
            patch[f"{pid}/club"] = wclub

    print(f"\n{len(patch)} field(s) will be cleared/overwritten in Firebase.")
    if not args.apply:
        print("Dry run. Re-run with --apply to write to Firebase.")
        return

    players_ref.update(patch)
    print(f"Patched {len(mismatches)} player record(s).")


if __name__ == "__main__":
    main()
