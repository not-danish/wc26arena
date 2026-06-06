"""
One-shot tool to reseed the Firebase player DB with 2026 FIFA World Cup squads.

Run in three steps so the destructive Firebase write is gated behind manual review:

    python seed_world_cup.py scrape
        -> writes squads.json from Wikipedia (no Firebase, no external APIs)

    python seed_world_cup.py resolve [--group A]
        -> resolves TheSportsDB id + thumbnail per player, one group at a time
           writes/updates resolved.json. Re-run for each group A..L.
           Without --group, processes any country not yet resolved.

    python seed_world_cup.py backup-and-write
        -> backs up current data/players to firebase_backup_<ts>.json,
           then wipes data/players and writes the new squad. Asks y/N first.
"""

import sys
import os
import re
import json
import time
import argparse
import urllib.parse
from datetime import datetime

import requests
from bs4 import BeautifulSoup

WIKI_URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads"
WIKI_FIXTURES_URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup"
SQUADS_FILE = "squads.json"
RESOLVED_FILE = "resolved.json"
FIXTURES_FILE = "fixtures.json"
SPORTSDB_KEY = "3"  # public test key
SPORTSDB_DELAY_SEC = 2.0  # be polite to the free tier
STARTING_ELO = 1400


# ---------- fixtures: scrape ----------

def scrape_fixtures():
    """Pull all 104 group-stage + knockout fixtures from Wikipedia.

    Wikipedia's ``footballbox`` div is well-structured: one div per match
    with date/time/home/away/venue children. We extract them in document
    order, which conveniently matches chronological order.
    """
    print(f"Fetching {WIKI_FIXTURES_URL}")
    html = requests.get(WIKI_FIXTURES_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text
    soup = BeautifulSoup(html, "html.parser")

    fixtures = []
    for idx, box in enumerate(soup.select(".footballbox")):
        date_el = box.select_one(".bday.dtstart") or box.select_one(".fdate")
        time_el = box.select_one(".ftime")
        home_el = box.select_one(".fhome a")
        away_el = box.select_one(".faway a")
        venue_el = box.select_one('[itemprop="location"] [itemprop~="name"]') or box.select_one(".fvenue")

        date_iso = (date_el.get_text(strip=True) if date_el else "")
        # Strip the (2026-06-11) wrapper if we only got the visible date.
        if date_iso and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_iso):
            m = re.search(r"\d{4}-\d{2}-\d{2}", str(box))
            date_iso = m.group(0) if m else date_iso

        time_txt_raw = (time_el.get_text(" ", strip=True) if time_el else "").replace("\xa0", " ")
        # Split "1:00 p.m. UTC−6" -> local "1:00 p.m." + offset "UTC−6"
        m = re.match(r"(.+?)\s+(UTC[+−-]\d+)", time_txt_raw)
        time_local = m.group(1).strip() if m else time_txt_raw
        utc_offset = m.group(2).replace("−", "-") if m else ""

        # Compute an ISO UTC kickoff so the frontend can sort and filter
        # "upcoming" cleanly. Best-effort: skip if parsing fails.
        kickoff_utc = ""
        try:
            offset_hours = int(re.search(r"-?\d+", utc_offset).group(0)) if utc_offset else 0
            # Local time -> 24h
            tm = re.match(r"(\d{1,2}):(\d{2})\s*([ap])\.?m\.?", time_local, re.I)
            if tm and date_iso:
                hh = int(tm.group(1)) % 12 + (12 if tm.group(3).lower() == "p" else 0)
                mm = int(tm.group(2))
                local_dt = datetime.strptime(date_iso, "%Y-%m-%d").replace(hour=hh, minute=mm)
                # offset_hours is e.g. -6 for UTC-6, so subtract to get UTC
                from datetime import timedelta
                utc_dt = local_dt - timedelta(hours=offset_hours)
                kickoff_utc = utc_dt.strftime("%Y-%m-%dT%H:%M:00Z")
        except Exception:
            pass

        home = home_el.get_text(strip=True) if home_el else ""
        away = away_el.get_text(strip=True) if away_el else ""
        venue = venue_el.get_text(" ", strip=True) if venue_el else ""
        # Wikipedia includes the city after a comma, which clutters the ticker.
        venue = venue.split(",")[0].strip()

        if not home or not away:
            continue
        fixtures.append({
            "id": f"m{idx + 1:03d}",
            "date": date_iso,
            "time": time_local,
            "utc_offset": utc_offset,
            "kickoff_utc": kickoff_utc,
            "home": home,
            "away": away,
            "venue": venue,
        })

    with open(FIXTURES_FILE, "w") as f:
        json.dump(fixtures, f, indent=2, ensure_ascii=False)
    print(f"Scraped {len(fixtures)} fixtures -> {FIXTURES_FILE}")
    for fx in fixtures[:8]:
        print(f"  {fx['id']} {fx['date']} {fx['time']:>15s} | {fx['home']} vs {fx['away']} @ {fx['venue']}")


# ---------- step 1: scrape ----------

def scrape_wikipedia():
    print(f"Fetching {WIKI_URL}")
    html = requests.get(WIKI_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text
    soup = BeautifulSoup(html, "html.parser")

    squads = {}  # country -> list of {name, position, club}
    current_group = None
    current_country = None

    for el in soup.find_all(["h2", "h3", "table"]):
        if el.name == "h2":
            headline = el.get("id") or el.get_text(strip=True)
            m = re.match(r"Group[_ ]([A-L])", headline)
            current_group = m.group(1) if m else None
        elif el.name == "h3" and current_group:
            current_country = el.get_text(strip=True).replace("[edit]", "")
        elif el.name == "table" and current_country and "wikitable" in (el.get("class") or []):
            rows = el.select("tr.nat-fs-player")
            if not rows:
                continue
            players = []
            for row in rows:
                cells = row.find_all(["td", "th"])
                if len(cells) < 7:
                    continue
                pos_cell = cells[1].get_text(strip=True)
                name_link = cells[2].find("a")
                name = (name_link.get_text(strip=True) if name_link
                        else cells[2].get_text(strip=True))
                # Club cell has a flag image + link; take the last <a> which is the club.
                club_links = cells[6].find_all("a")
                club = club_links[-1].get_text(strip=True) if club_links else cells[6].get_text(strip=True)
                if name:
                    players.append({"name": name, "position": pos_cell, "club": club})
            if players:
                squads.setdefault(current_country, {"group": current_group, "players": players})
                current_country = None  # one table per country

    with open(SQUADS_FILE, "w") as f:
        json.dump(squads, f, indent=2, ensure_ascii=False)
    total = sum(len(c["players"]) for c in squads.values())
    print(f"Scraped {len(squads)} countries, {total} players -> {SQUADS_FILE}")
    for country, info in squads.items():
        print(f"  Group {info['group']}: {country} ({len(info['players'])})")


# ---------- step 2: resolve ----------

def _sportsdb_lookup(name):
    """Return (sportsdb_id, image_url, team, position) or (None, None, None, None)."""
    url = (f"https://www.thesportsdb.com/api/v1/json/{SPORTSDB_KEY}"
           f"/searchplayers.php?p={urllib.parse.quote(name)}")
    try:
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            return (None, None, None, None)
        data = r.json() or {}
    except Exception as e:
        print(f"    ! lookup error for {name}: {e}")
        return (None, None, None, None)

    players = data.get("player") or []
    soccer = [p for p in players if p.get("strSport") == "Soccer"]
    pick = soccer[0] if soccer else (players[0] if players else None)
    if not pick:
        return (None, None, None, None)
    return (
        pick.get("idPlayer"),
        pick.get("strCutout") or pick.get("strThumb"),
        pick.get("strTeam"),
        pick.get("strPosition"),
    )


def resolve(group_filter=None):
    if not os.path.exists(SQUADS_FILE):
        sys.exit(f"Run `scrape` first; {SQUADS_FILE} not found.")
    with open(SQUADS_FILE) as f:
        squads = json.load(f)

    if os.path.exists(RESOLVED_FILE):
        with open(RESOLVED_FILE) as f:
            resolved = json.load(f)
    else:
        resolved = {}

    targets = [(c, info) for c, info in squads.items()
               if (group_filter is None or info["group"] == group_filter)
               and c not in resolved]
    if not targets:
        print(f"Nothing to resolve (group_filter={group_filter}).")
        return

    print(f"Resolving {len(targets)} countries...")
    for country, info in targets:
        print(f"\n[{info['group']}] {country} ({len(info['players'])} players)")
        out = []
        unresolved = 0
        for p in info["players"]:
            sid, img, team, pos = _sportsdb_lookup(p["name"])
            if not sid:
                unresolved += 1
                print(f"    ? unresolved: {p['name']}")
            out.append({
                "player_name": p["name"],
                "country": country,
                "club": p["club"],
                "position_short": p["position"],
                "position_full": pos,
                "sportsdb_id": sid,
                "image_url": img,
            })
            time.sleep(SPORTSDB_DELAY_SEC)
        resolved[country] = {"group": info["group"], "players": out}
        # Save after each country so a crash doesn't lose work.
        with open(RESOLVED_FILE, "w") as f:
            json.dump(resolved, f, indent=2, ensure_ascii=False)
        print(f"  done: {len(out) - unresolved}/{len(out)} resolved")

    total_players = sum(len(c["players"]) for c in resolved.values())
    total_unresolved = sum(1 for c in resolved.values() for p in c["players"] if not p["sportsdb_id"])
    print(f"\nResolved file now covers {len(resolved)} countries, "
          f"{total_players} players ({total_unresolved} unresolved).")


# ---------- step 2b: retry unresolved ----------

def retry_unresolved():
    """Re-lookup any player in resolved.json that previously failed.

    TheSportsDB's free key throttles silently (returns empty results) when
    you push it too hard. Run this after a `resolve` pass to mop up the
    transient failures. Safe to run repeatedly.
    """
    if not os.path.exists(RESOLVED_FILE):
        sys.exit(f"Run `resolve` first; {RESOLVED_FILE} not found.")
    with open(RESOLVED_FILE) as f:
        resolved = json.load(f)

    targets = [(c, p) for c, info in resolved.items()
               for p in info["players"] if not p["sportsdb_id"]]
    if not targets:
        print("No unresolved players. Nothing to do.")
        return

    print(f"Retrying {len(targets)} unresolved players...")
    fixed = 0
    for country, p in targets:
        sid, img, _team, pos = _sportsdb_lookup(p["player_name"])
        if sid:
            fixed += 1
            p["sportsdb_id"] = sid
            p["image_url"] = img
            p["position_full"] = pos or p.get("position_full")
            print(f"  + {p['player_name']:30s} ({country})")
        time.sleep(SPORTSDB_DELAY_SEC)
        # Periodic save in case of crash.
        if (fixed and fixed % 25 == 0):
            with open(RESOLVED_FILE, "w") as f:
                json.dump(resolved, f, indent=2, ensure_ascii=False)

    with open(RESOLVED_FILE, "w") as f:
        json.dump(resolved, f, indent=2, ensure_ascii=False)
    still_unresolved = sum(1 for c in resolved.values() for p in c["players"] if not p["sportsdb_id"])
    print(f"\nRetried {len(targets)}, recovered {fixed}. {still_unresolved} still unresolved.")


# ---------- step 3: backup + write ----------

def backup_and_write():
    if not os.path.exists(RESOLVED_FILE):
        sys.exit(f"Run `resolve` first; {RESOLVED_FILE} not found.")
    with open(RESOLVED_FILE) as f:
        resolved = json.load(f)

    # Only import firebase here so steps 1-2 don't need credentials loaded.
    from firebase_admin import credentials, db, initialize_app
    from dotenv import load_dotenv
    load_dotenv()
    cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
    initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

    players_ref = db.reference("data/players")
    print("Reading current data/players for backup...")
    current = players_ref.get() or {}
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"firebase_backup_{ts}.json"
    with open(backup_path, "w") as f:
        json.dump(current, f, indent=2, ensure_ascii=False)
    print(f"Backed up {len(current)} existing players -> {backup_path}")

    # Build new payload. Key by sportsdb_id when present, else a slug of name.
    new_payload = {}
    skipped = 0
    for country_info in resolved.values():
        for p in country_info["players"]:
            key = p["sportsdb_id"]
            if not key:
                # Slug fallback so unresolved players still get an entry.
                slug = re.sub(r"[^a-z0-9]+", "_", p["player_name"].lower()).strip("_")
                key = f"wc_{slug}"
            if key in new_payload:
                skipped += 1
                continue
            new_payload[key] = {
                "player_name": p["player_name"],
                "country": p["country"],
                "club": p["club"],
                "position": p["position_full"] or p["position_short"],
                "image_url": p["image_url"],
                "ELO": STARTING_ELO,
            }

    print(f"\nAbout to:")
    print(f"  - DELETE all {len(current)} existing players at data/players")
    print(f"  - WRITE {len(new_payload)} new World Cup players (all ELO={STARTING_ELO})")
    print(f"  - Skipped {skipped} duplicates")
    confirm = input("\nType 'yes' to proceed: ").strip()
    if confirm != "yes":
        print("Aborted. No changes made.")
        return

    players_ref.set(new_payload)
    print(f"Wrote {len(new_payload)} players. Backup is at {backup_path}.")


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scrape")
    sub.add_parser("scrape-fixtures")
    rp = sub.add_parser("resolve")
    rp.add_argument("--group", default=None, help="Single group letter A..L")
    sub.add_parser("retry-unresolved")
    sub.add_parser("backup-and-write")
    args = parser.parse_args()

    if args.cmd == "scrape":
        scrape_wikipedia()
    elif args.cmd == "scrape-fixtures":
        scrape_fixtures()
    elif args.cmd == "resolve":
        resolve(args.group)
    elif args.cmd == "retry-unresolved":
        retry_unresolved()
    elif args.cmd == "backup-and-write":
        backup_and_write()


if __name__ == "__main__":
    main()
