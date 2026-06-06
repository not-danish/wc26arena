from flask import Flask, render_template, jsonify, request
from firebase_admin import credentials, db, initialize_app
from dotenv import load_dotenv
import os
import json
import random
import elo
import time
import threading
from datetime import datetime, timezone

load_dotenv()  # Load environment variables from .env file

firebase_key_path = os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY')

app = Flask(__name__)


'''
-------------------------------------
# Firebase Magic
-------------------------------------
'''

# Initialize Firebase Admin SDK
cred = credentials.Certificate(firebase_key_path)
initialize_app(cred, {'databaseURL': os.getenv('DATABASE_URL')})

# Get a reference to the Firebase Realtime Database
firebase_db = db.reference()


def _query_range(min_elo, max_elo, limit=None):
    """Fetch players in [min_elo, max_elo]. Returns a dict {id: record}."""
    q = db.reference('data/players').order_by_child('ELO').start_at(min_elo).end_at(max_elo)
    if limit:
        q = q.limit_to_last(limit)
    res = q.get()
    if not res:
        return {}
    # firebase-admin sometimes returns a list when keys look numeric/sequential.
    if isinstance(res, list):
        return {str(i): v for i, v in enumerate(res) if v}
    return res


def fetch_players_by_elo(min_elo, max_elo, **kwargs):
    """Fetch up to `limit` players around [min_elo, max_elo].

    If the initial band is sparse, the range expands outward in fixed steps
    until either the limit is hit or the search hits a hard outer bound.
    Skipping empty intermediate bands is important: with everyone seeded at
    ELO 1400, most starting windows return zero and we still need to recover.
    """
    limit = kwargs.get('limit')
    seen = _query_range(min_elo, max_elo, limit=limit)

    if limit:
        step = 100
        # Hard outer bound so a misconfigured call can't loop forever.
        outer_low, outer_high = 0, 5000
        while len(seen) < limit and (min_elo > outer_low or max_elo < outer_high):
            min_elo = max(outer_low, min_elo - step)
            max_elo = min(outer_high, max_elo + step)
            expanded = _query_range(min_elo, max_elo)
            seen.update(expanded)
            if min_elo == outer_low and max_elo == outer_high:
                break

    sorted_players = sorted(seen.items(), key=lambda kv: kv[1].get('ELO', 0), reverse=True)
    return sorted_players[:limit] if limit else sorted_players



'''
-------------------------------------
# Cache
------------------------------------
'''

# Server-side read cache. Votes go straight to Firebase via transactions,
# so this is purely a read accelerator for the rank page rotation.
player_cache = {'data': {}, 'time': None}
cache_expiry_time = 300


def update_cache():
    while True:
        current_time = time.time()

        if player_cache['time'] is None or current_time - player_cache['time'] > cache_expiry_time:
            random_elo = random.randint(1300, 1700)
            try:
                player_cache['data'] = fetch_players_by_elo(random_elo - 50, random_elo + 50, limit=100)
                player_cache['time'] = current_time
            except Exception as e:
                print(f"Cache refresh failed: {e}")

        time.sleep(60)


threading.Thread(target=update_cache, daemon=True).start()


'''
-------------------------------------
# Fixtures
-------------------------------------
'''

FIXTURES_PATH = os.path.join(os.path.dirname(__file__), 'fixtures.json')

def _load_fixtures():
    try:
        with open(FIXTURES_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

# Loaded once at startup. fixtures.json ships with the repo and is updated
# by `python seed_world_cup.py scrape-fixtures` when the schedule changes.
ALL_FIXTURES = _load_fixtures()


def _upcoming_fixtures(limit=10):
    """Fixtures whose kickoff is in the future, sorted by kickoff time.

    Falls back to upcoming-by-date if the precise UTC kickoff couldn't be
    computed at scrape time (some Wikipedia rows omit the offset).
    """
    now = datetime.now(timezone.utc)
    upcoming = []
    for fx in ALL_FIXTURES:
        kickoff = fx.get('kickoff_utc')
        if kickoff:
            try:
                dt = datetime.strptime(kickoff, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
                if dt < now:
                    continue
                upcoming.append((dt, fx))
                continue
            except ValueError:
                pass
        # Date-only fallback.
        date = fx.get('date', '')
        try:
            d = datetime.strptime(date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
            if d >= now.replace(hour=0, minute=0, second=0, microsecond=0):
                upcoming.append((d, fx))
        except ValueError:
            continue
    upcoming.sort(key=lambda x: x[0])
    return [fx for _, fx in upcoming[:limit]]


def _players_for_countries(countries):
    """Return all players from any of the named countries, sorted by name."""
    target = set(countries)
    res = db.reference('data/players').get() or {}
    if isinstance(res, list):
        res = {str(i): v for i, v in enumerate(res) if v}
    out = [(pid, p) for pid, p in res.items() if p.get('country') in target]
    out.sort(key=lambda kv: kv[1].get('player_name', ''))
    return out




'''
-------------------------------------
# API Routes for the webpage
-------------------------------------
'''

@app.route('/api/cached_players')
def cached_players():
    return jsonify(player_cache['data'])


@app.route('/api/fixtures')
def fixtures_api():
    """Upcoming fixtures for the ticker."""
    return jsonify(_upcoming_fixtures(limit=int(request.args.get('limit', 10))))


@app.route('/api/fixture_players')
def fixture_players_api():
    """All players from both squads of a single fixture, for filtered ranking."""
    match_id = request.args.get('id')
    if not match_id:
        return jsonify({"error": "id is required"}), 400
    fx = next((f for f in ALL_FIXTURES if f['id'] == match_id), None)
    if not fx:
        return jsonify({"error": "fixture not found"}), 404
    players = _players_for_countries([fx['home'], fx['away']])
    return jsonify({"fixture": fx, "players": players})


@app.route('/api/best_xi')
def best_xi_api():
    """Return the highest-ELO XI in a 3-4-3 + 7 subs configuration.

    Players are bucketed by position (GK / DEF / MID / FWD). Starters are
    the top N from each bucket; subs are the next batch. Designed so the
    page can reload and watch the lineup churn as ELOs shift from voting.
    """
    raw = db.reference('data/players').get() or {}
    if isinstance(raw, list):
        raw = {str(i): v for i, v in enumerate(raw) if v}

    buckets = {"GK": [], "DEF": [], "MID": [], "FWD": []}
    for pid, p in raw.items():
        pos = p.get('position')
        if pos in buckets:
            buckets[pos].append((pid, p))
    for k in buckets:
        buckets[k].sort(key=lambda kv: kv[1].get('ELO', 0), reverse=True)

    def take(bucket, n, start=0):
        return [
            {**p, "id": pid}
            for pid, p in buckets[bucket][start:start + n]
        ]

    starters = {
        "GK":  take("GK",  1),
        "DEF": take("DEF", 3),
        "MID": take("MID", 4),
        "FWD": take("FWD", 3),
    }
    subs = {
        "GK":  take("GK",  1, start=1),
        "DEF": take("DEF", 2, start=3),
        "MID": take("MID", 2, start=4),
        "FWD": take("FWD", 2, start=3),
    }
    return jsonify({"starters": starters, "subs": subs})


@app.route('/api/leaderboard')
def leaderboard_api():
    """Return the top-N players by ELO. Firebase is always current because
    every vote is committed via a transaction in /api/update_data."""
    limit = int(request.args.get('limit', 100))
    players_ref = db.reference('data/players')
    raw = players_ref.order_by_child('ELO').start_at(0).end_at(5000).get() or {}
    if isinstance(raw, list):
        raw = {str(i): v for i, v in enumerate(raw) if v}
    sorted_players = sorted(raw.items(), key=lambda kv: kv[1].get('ELO', 0), reverse=True)
    return jsonify(sorted_players[:limit])


@app.route('/api/update_data', methods=["POST"])
def update_data():
    """Apply a vote atomically.

    Each player's ELO is updated via a Firebase transaction, which retries
    server-side on contention. The new ELO is computed as ``old + delta``,
    where ``delta`` is derived once from the snapshot ELOs the client sent.
    This keeps the math right under concurrent voting: if two votes for the
    same player race, both still apply their full deltas, just sequenced.
    """
    data = request.get_json() or {}
    winning_id = data.get('winning_id')
    losing_id = data.get('losing_id')
    winning_elo = data.get('winning_elo')
    losing_elo = data.get('losing_elo')

    if not winning_id or not losing_id or winning_elo is None or losing_elo is None:
        return jsonify({"error": "Invalid data"}), 400

    new_win_snapshot, new_loss_snapshot = elo.calculate_elo(winning_elo, losing_elo)
    win_delta = new_win_snapshot - winning_elo
    loss_delta = new_loss_snapshot - losing_elo

    def apply_delta(delta):
        def _txn(current):
            # First-write case: record may exist without an ELO field.
            base = current if isinstance(current, (int, float)) else 1400
            return int(round(base + delta))
        return _txn

    try:
        win_ref = db.reference(f'data/players/{winning_id}/ELO')
        loss_ref = db.reference(f'data/players/{losing_id}/ELO')
        final_win = win_ref.transaction(apply_delta(win_delta))
        final_loss = loss_ref.transaction(apply_delta(loss_delta))
    except Exception as e:
        print(f"Vote transaction failed: {e}")
        return jsonify({"error": "Vote failed"}), 500

    return jsonify({
        "message": "Player data updated successfully",
        "winning_id": winning_id, "winning_elo": final_win,
        "losing_id": losing_id, "losing_elo": final_loss,
    }), 200


# Fallback team colour palette. TheSportsDB does not expose kit colours,
# so we map well-known clubs by name; everything else gets a neutral default.
TEAM_COLOURS = {
    'Manchester United': ('#DA291C', '#000000'),
    'Manchester City':   ('#6CABDD', '#1C2C5B'),
    'Liverpool':         ('#C8102E', '#00B2A9'),
    'Arsenal':           ('#EF0107', '#023474'),
    'Chelsea':           ('#034694', '#DBA111'),
    'Tottenham Hotspur': ('#132257', '#FFFFFF'),
    'Real Madrid':       ('#FEBE10', '#00529F'),
    'Barcelona':         ('#A50044', '#004D98'),
    'Atletico Madrid':   ('#CB3524', '#272E61'),
    'Bayern Munich':     ('#DC052D', '#0066B2'),
    'Borussia Dortmund': ('#FDE100', '#000000'),
    'Paris Saint-Germain': ('#004170', '#DA291C'),
    'Juventus':          ('#000000', '#FFFFFF'),
    'AC Milan':          ('#FB090B', '#000000'),
    'Inter Milan':       ('#0068A8', '#000000'),
    'Napoli':            ('#12A0D7', '#FFFFFF'),
    'Portugal':          ('#006600', '#FF0000'),
}
DEFAULT_TEAM_COLOURS = ('#4A5568', '#1A202C')

def _colours_for_club(club_name):
    return TEAM_COLOURS.get(club_name or '', DEFAULT_TEAM_COLOURS)


@app.route('/api/detailed_data')
def detailed_data():
    """Return display detail (club, country, position, colours) for a player.

    With the World Cup seed, every field except colours is already in the
    Firebase record, so this resolves locally from player_cache and avoids
    the external API roundtrip the rank page used to make per-card.
    """
    player_id = request.args.get('player_id')
    if not player_id:
        return jsonify({"error": "player_id is required"}), 400

    record = None
    # player_cache['data'] is a list of (id, record) tuples.
    for pid, prec in player_cache.get('data') or []:
        if pid == player_id:
            record = prec
            break
    if record is None:
        # Fall back to a direct Firebase read for ids outside the rotating cache.
        record = db.reference(f'data/players/{player_id}').get() or {}

    home, away = _colours_for_club(record.get('club'))
    return jsonify({
        'club': record.get('club') or 'N/A',
        'country': record.get('country') or 'N/A',
        'position': record.get('position') or 'N/A',
        'teamColors': {'color': home, 'colorAway': away},
    })



'''
--------------------------------------
 Main routes for the webpage
-------------------------------------- 
'''

@app.route('/')
def index():    
    return render_template("index.html")

@app.route('/rank')
def rank():
    return render_template("rank.html")

@app.route('/leaderboard')
def leaderboard():
    return render_template("leaderboard.html")

@app.route('/best-xi')
def best_xi():
    return render_template("best_xi.html")



app.run(
    #host="0.0.0.0", port=5000
    debug = True, port = 3000
        )