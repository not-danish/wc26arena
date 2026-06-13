from flask import Flask, render_template, jsonify, request
from firebase_admin import credentials, db, initialize_app
from dotenv import load_dotenv
import os
import json
import random
import elo
import time
import threading
import re
from datetime import datetime, timezone, timedelta

load_dotenv()  # Load environment variables from .env file (no-op in production)

app = Flask(__name__)


'''
-------------------------------------
# Firebase Magic
-------------------------------------
'''

# Two ways to provide the service account credentials:
#   1. FIREBASE_SERVICE_ACCOUNT_KEY = path to a JSON file (local dev,
#      Render secret files)
#   2. FIREBASE_SERVICE_ACCOUNT_JSON = the entire JSON blob as a string
#      (handy when the host only exposes env vars, not file mounts)
def _build_firebase_credentials():
    key_path = os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY')
    if key_path and os.path.isfile(key_path):
        return credentials.Certificate(key_path)
    blob = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')
    if blob:
        return credentials.Certificate(json.loads(blob))
    raise RuntimeError(
        "No Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT_KEY (path) "
        "or FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON)."
    )

initialize_app(_build_firebase_credentials(), {'databaseURL': os.getenv('DATABASE_URL')})

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

# Server-side read cache. Holds every player joined with their vote-count
# stats so the matchmaker can pick informative pairs without re-querying.
# Votes still go straight to Firebase via transactions, so we don't need
# to write back at the end of the cache cycle.
player_cache = {
    'data': [],          # list of (pid, record_with_vote_count) sorted by ELO
    'pool_total': 0,     # cached size, for sanity-checking
    'total_votes': 0,    # sum of wins+losses at last refresh
    'time': None,
}
# Incremented on every vote so the public counter feels live between cache
# refreshes. Reset to 0 at each refresh because the cache reads the fresh
# total straight from Firebase.
votes_since_refresh = 0
cache_expiry_time = 300
import math  # noqa: E402  (kept here next to where it's used)


def _refresh_player_cache():
    """Pull every player + their win/loss counts in one pass."""
    raw = db.reference('data/players').get() or {}
    if isinstance(raw, list):
        raw = {str(i): v for i, v in enumerate(raw) if v}
    stats = db.reference('data/stats').get() or {}
    if isinstance(stats, list):
        stats = {str(i): v for i, v in enumerate(stats) if v}

    global votes_since_refresh
    enriched = []
    total_votes = 0
    for pid, p in raw.items():
        s = stats.get(pid) or {}
        votes = (s.get('wins') or 0) + (s.get('losses') or 0)
        total_votes += votes
        enriched.append((pid, {**p, '_votes': votes}))
    enriched.sort(key=lambda kv: kv[1].get('ELO', 0), reverse=True)

    player_cache['data'] = enriched
    player_cache['pool_total'] = len(enriched)
    # Each vote is two stat increments (winner.wins + loser.losses) but counts
    # as a single user action, so divide by 2 for the public-facing tally.
    player_cache['total_votes'] = total_votes // 2
    player_cache['time'] = time.time()
    votes_since_refresh = 0


def update_cache():
    while True:
        if player_cache['time'] is None or time.time() - player_cache['time'] > cache_expiry_time:
            try:
                _refresh_player_cache()
                print(f"Cache refreshed: {player_cache['pool_total']} players")
            except Exception as e:
                print(f"Cache refresh failed: {e}")
        time.sleep(60)


# Spawn the cache thread lazily on the first request each worker handles.
# Starting it at import time doesn't work under gunicorn: the thread either
# runs in the master process (which never serves traffic) or doesn't survive
# the fork into worker processes. A per-worker lazy start guarantees every
# process that serves requests also has a cache thread.
_cache_thread_lock = threading.Lock()
_cache_thread_started = False

def _ensure_cache_thread():
    global _cache_thread_started
    if _cache_thread_started:
        return
    with _cache_thread_lock:
        if _cache_thread_started:
            return
        # Prime the cache synchronously on the first call so the very first
        # /api/next_pair has data immediately, rather than racing the thread.
        try:
            _refresh_player_cache()
            print(f"Cache primed: {player_cache['pool_total']} players")
        except Exception as e:
            print(f"Initial cache prime failed: {e}")
        threading.Thread(target=update_cache, daemon=True,
                         name="cache-refresh").start()
        # Live-score poller: prime once synchronously, then loop in background.
        try:
            _fetch_live_scores()
        except Exception as e:
            print(f"Initial live score prime failed: {e}")
        threading.Thread(target=_live_scores_loop, daemon=True,
                         name="live-scores").start()
        _cache_thread_started = True


@app.before_request
def _boot_cache_thread():
    _ensure_cache_thread()


# ---- Matchmaker -------------------------------------------------------------
# Decay constant controls how strongly we prefer similar-ELO opponents.
# At |delta|=150 the weight is 1/e (~37%), at 300 it's ~14%, at 600 it's ~2%.
# That means most matchups land within +/- 200 ELO with occasional wider pairs.
MATCH_ELO_DECAY = 150.0


def _freshness(votes):
    """Players with few prior votes get bigger weights."""
    return 1.0 / math.sqrt(1 + (votes or 0))


def _weighted_choice(pool, weights, rng=random):
    """Plain weighted-random pick with a single uniform draw."""
    total = sum(weights)
    if total <= 0:
        return rng.choice(pool)
    r = rng.random() * total
    cum = 0.0
    for item, w in zip(pool, weights):
        cum += w
        if r <= cum:
            return item
    return pool[-1]


def pick_matchup(pool):
    """Return (player_a, player_b) using freshness + similar-ELO scoring.

    `pool` is a list of (pid, record) tuples. Each record must carry an
    `_votes` field (cached vote count) and `ELO`. Pool size of ~50+ keeps
    the random walks interesting; tiny pools still work, they just produce
    repetitive pairs.
    """
    if len(pool) < 2:
        return None, None
    freshness = [_freshness(r.get('_votes', 0)) for _, r in pool]
    a_idx_item = _weighted_choice(list(enumerate(pool)), freshness)
    a_idx = a_idx_item[0]
    a_pid, a_rec = pool[a_idx]
    a_elo = a_rec.get('ELO', 1400)

    # Score every other player by exp(-|dElo|/decay) * freshness.
    others = []
    weights = []
    for i, (pid, rec) in enumerate(pool):
        if i == a_idx:
            continue
        delta = abs(rec.get('ELO', 1400) - a_elo)
        w = math.exp(-delta / MATCH_ELO_DECAY) * _freshness(rec.get('_votes', 0))
        others.append((pid, rec))
        weights.append(w)
    b_pid, b_rec = _weighted_choice(others, weights)
    return (a_pid, a_rec), (b_pid, b_rec)


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


# ---------- Live scores (TheSportsDB + manual Firebase fallback) ----------
# Two-source design because TheSportsDB has incomplete WC26 coverage:
#   - LIVE_SCORES_AUTO: best-effort fetch from TheSportsDB (60s cycle).
#   - data/scores/{match_id} in Firebase: manually entered, always wins
#     over auto values when present (admin uses Firebase console or the
#     /api/admin/score endpoint to update).
# Merged at request time so the frontend just gets one combined dict.
LIVE_SCORES_AUTO = {}
LIVE_SCORES_LAST_FETCH = 0
TSDB_WC_LEAGUE = os.getenv('TSDB_WC_LEAGUE_ID', '4429')  # TheSportsDB "FIFA World Cup"
ADMIN_SECRET = os.getenv('ADMIN_SECRET', '')  # blank = endpoint disabled


def _normalize_team_name(name):
    """Collapse Wikipedia / TheSportsDB / common variants to a single key.

    Strips non-alphanumerics (so 'Bosnia-Herzegovina' == 'Bosnia and Herzegovina'
    after alias resolution) and applies a curated alias map for nations whose
    English names differ between data sources.
    """
    if not name:
        return ''
    name = name.lower().strip()
    # Replace separators and punctuation with single spaces so naming variants
    # converge before we look up aliases.
    name = re.sub(r"[-&/.,'’]", ' ', name)
    name = re.sub(r'\s+', ' ', name).strip()

    aliases = {
        'south korea':             'korea',
        'korea republic':          'korea',
        'korea':                   'korea',
        'united states':           'usa',
        'usa':                     'usa',
        'iran':                    'iran',
        'ir iran':                 'iran',
        'czech republic':          'czechia',
        'czechia':                 'czechia',
        'bosnia herzegovina':      'bosnia',
        'bosnia and herzegovina':  'bosnia',
        'ivory coast':             'ivory coast',
        'cote d ivoire':           'ivory coast',
        'cote divoire':            'ivory coast',
        'dr congo':                'dr congo',
        'congo dr':                'dr congo',
        'congo democratic republic': 'dr congo',
        'cape verde':              'cape verde',
        'cape verde islands':      'cape verde',
    }
    return aliases.get(name, name)


def _fetch_events_for_day(day_str):
    """Fetch TheSportsDB events for a single UTC day. Returns a list."""
    import urllib.request, urllib.parse
    url = (f"https://www.thesportsdb.com/api/v1/json/3/eventsday.php"
           f"?d={day_str}&l={urllib.parse.quote(TSDB_WC_LEAGUE)}")
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"Live score fetch failed for {day_str}: {e}")
        return []
    return (data or {}).get('events') or []


def _fetch_live_scores():
    """Poll TheSportsDB for WC events over the last few days + the next two,
    so recently-finished, currently-live, and just-upcoming matches all
    populate LIVE_SCORES_AUTO. Run once per minute by the background thread.
    """
    global LIVE_SCORES_LAST_FETCH
    now = datetime.now(timezone.utc)
    # Window: 3 days back through 2 days forward.
    days = [(now + timedelta(days=offset)).strftime('%Y-%m-%d')
            for offset in range(-3, 3)]

    # Build fixture lookup by normalized (home, away).
    fx_by_pair = {}
    for fx in ALL_FIXTURES:
        key = (_normalize_team_name(fx.get('home')), _normalize_team_name(fx.get('away')))
        fx_by_pair[key] = fx['id']

    updated = 0
    for day_str in days:
        for ev in _fetch_events_for_day(day_str):
            home_raw = ev.get('strHomeTeam') or ''
            away_raw = ev.get('strAwayTeam') or ''
            key = (_normalize_team_name(home_raw), _normalize_team_name(away_raw))
            fid = fx_by_pair.get(key)
            if not fid:
                # Loose substring match as fallback.
                for (h, a), candidate in fx_by_pair.items():
                    if (key[0] in h or h in key[0]) and (key[1] in a or a in key[1]):
                        fid = candidate
                        break
            if not fid:
                continue
            try:
                home_score = int(ev.get('intHomeScore')) if ev.get('intHomeScore') is not None else None
                away_score = int(ev.get('intAwayScore')) if ev.get('intAwayScore') is not None else None
            except (TypeError, ValueError):
                home_score = away_score = None
            LIVE_SCORES_AUTO[fid] = {
                'home_score': home_score,
                'away_score': away_score,
                'status': (ev.get('strStatus') or '').strip(),
                'minute': (ev.get('strProgress') or '').strip(),
            }
            updated += 1

    LIVE_SCORES_LAST_FETCH = time.time()
    if updated:
        print(f"Live scores updated: {updated} fixture(s)")


def _live_scores_loop():
    while True:
        try:
            _fetch_live_scores()
        except Exception as e:
            print(f"Live score loop error: {e}")
        time.sleep(60)


def _merged_scores():
    """Merge TheSportsDB auto-pulled scores with Firebase-stored manual ones.
    Manual entries always win because they're explicitly authored by us."""
    try:
        manual = db.reference('data/scores').get() or {}
        if isinstance(manual, list):
            manual = {str(i): v for i, v in enumerate(manual) if v}
    except Exception:
        manual = {}
    out = dict(LIVE_SCORES_AUTO)
    for fid, val in (manual or {}).items():
        if isinstance(val, dict):
            out[fid] = val
    return out


# ---------- Fixtures with status + scores ----------
# A match is "live" from kickoff until 130 minutes after (90 + halftime +
# stoppage + buffer). After that, today's matches stay visible as 'ft' for
# the rest of the calendar day so people can still vote during post-match.
LIVE_WINDOW_MINUTES = 130


def _enrich_fixture(fx, now, scores=None):
    """Attach status ('upcoming'|'live'|'ft'|'past') and any cached score."""
    fx = dict(fx)  # copy so we don't mutate the source
    kickoff = None
    raw = fx.get('kickoff_utc')
    if raw:
        try:
            kickoff = datetime.strptime(raw, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        except ValueError:
            kickoff = None
    if kickoff is None:
        # date-only fallback: treat as midnight UTC for ordering
        try:
            kickoff = datetime.strptime(fx.get('date', ''), '%Y-%m-%d').replace(tzinfo=timezone.utc)
        except ValueError:
            return None, None

    delta_min = (now - kickoff).total_seconds() / 60.0
    if delta_min < 0:
        fx['status'] = 'upcoming'
    elif delta_min < LIVE_WINDOW_MINUTES:
        fx['status'] = 'live'
    elif delta_min < 60 * 24 * 5:    # finished within the last 5 days
        fx['status'] = 'ft'
    else:
        fx['status'] = 'past'    # older than 5 days, hide

    score = scores.get(fx['id']) if scores else None
    if score:
        fx['score'] = score
        # If the score record marks the match as finished, trust it over the
        # time-based heuristic (e.g. penalties can run long).
        status_str = (score.get('status') or '').lower()
        if 'finished' in status_str or 'ft' in status_str or status_str == 'match finished':
            fx['status'] = 'ft'
    return kickoff, fx


def _upcoming_fixtures(limit=10, order='ticker'):
    """Returns fixtures that are LIVE, UPCOMING, or finished-today.

    `order` controls sort:
      - 'ticker' (default): live first, then recent FT, then today's upcoming,
        then older FT, then future. Optimised for the limited marquee space.
      - 'chrono': pure chronological by kickoff. Best for the fixtures page,
        which reads top-to-bottom as a tournament schedule.
    """
    now = datetime.now(timezone.utc)
    scores = _merged_scores()
    rows = []
    for fx in ALL_FIXTURES:
        kickoff, enriched = _enrich_fixture(fx, now, scores)
        if not enriched:
            continue
        if enriched['status'] == 'past':
            continue
        rows.append((kickoff, enriched))

    if order == 'chrono':
        # Schedule view: oldest finished match at the top, future at the bottom.
        rows.sort(key=lambda item: item[0])
    else:
        today_str = now.strftime('%Y-%m-%d')
        def ticker_key(item):
            kickoff, fx = item
            status = fx['status']
            is_today = fx.get('date') == today_str
            delta_min = (now - kickoff).total_seconds() / 60.0
            if status == 'live':
                return (0, kickoff)
            if status == 'ft' and delta_min < 60 * 48:
                return (1, -kickoff.timestamp())
            if status == 'upcoming' and is_today:
                return (2, kickoff)
            if status == 'ft':
                return (3, -kickoff.timestamp())
            return (4, kickoff)
        rows.sort(key=ticker_key)
    return [fx for _, fx in rows[:limit]]


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
    """Backwards-compatible: returns the full pool. Frontend should prefer
    /api/next_pair for the smart matchmaker."""
    return jsonify(player_cache['data'])


@app.route('/api/total_votes')
def total_votes_api():
    """Public vote counter for the nav bubble.

    Sum of the last cache snapshot's Firebase total plus any votes counted
    by this process since that refresh. Approximate across multiple workers
    (each has its own delta), but always converges to the truth after the
    next cache refresh.
    """
    base = player_cache.get('total_votes') or 0
    return jsonify({"total": base + votes_since_refresh})


# -------------------- Higher-or-lower streaks --------------------

def _today_key():
    """YYYY-MM-DD in UTC, for daily-leaderboard partitioning."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


@app.route('/api/streaks', methods=['POST'])
def submit_streak():
    """Record a higher-or-lower streak for today's leaderboard.

    Body: {"name": "Danish", "streak": 12}. Trivial validation only — this is
    a vanity leaderboard, not a high-stakes contest.
    """
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()[:24]
    try:
        streak = int(data.get('streak') or 0)
    except (TypeError, ValueError):
        streak = 0
    if not name or streak <= 0:
        return jsonify({"error": "name and streak required"}), 400
    entry = {"name": name, "streak": streak, "ts": int(time.time())}
    db.reference(f'data/streaks/{_today_key()}').push(entry)
    return jsonify({"ok": True})


def _flatten_streaks(bucket_dict):
    """Flatten a dict of {date: {push_id: entry}} into a list of entries."""
    rows = []
    for v in (bucket_dict or {}).values():
        if isinstance(v, dict):
            rows.extend(x for x in v.values() if isinstance(x, dict))
        elif isinstance(v, list):
            rows.extend(x for x in v if isinstance(x, dict))
    return rows


@app.route('/api/streaks/today')
def streaks_today():
    """Top N streaks for today (UTC), descending."""
    limit = max(1, min(50, int(request.args.get('limit', 10))))
    raw = db.reference(f'data/streaks/{_today_key()}').get() or {}
    if isinstance(raw, list):
        raw = {str(i): v for i, v in enumerate(raw) if v}
    rows = list(raw.values()) if isinstance(raw, dict) else []
    rows.sort(key=lambda r: (-(r.get('streak') or 0), r.get('ts') or 0))
    return jsonify(rows[:limit])


@app.route('/api/streaks/week')
def streaks_week():
    """Top N streaks from the last 7 calendar days (UTC), rolling."""
    limit = max(1, min(50, int(request.args.get('limit', 10))))
    now = datetime.now(timezone.utc)
    bucket = {}
    for i in range(7):
        date_key = (now - timedelta(days=i)).strftime('%Y-%m-%d')
        day = db.reference(f'data/streaks/{date_key}').get() or {}
        if isinstance(day, list):
            day = {str(i): v for i, v in enumerate(day) if v}
        bucket[date_key] = day
    rows = _flatten_streaks(bucket)
    rows.sort(key=lambda r: (-(r.get('streak') or 0), r.get('ts') or 0))
    return jsonify(rows[:limit])


@app.route('/api/streaks/all_time')
def streaks_all_time():
    """Top N streaks across the entire history."""
    limit = max(1, min(50, int(request.args.get('limit', 10))))
    raw = db.reference('data/streaks').get() or {}
    if isinstance(raw, list):
        raw = {str(i): v for i, v in enumerate(raw) if v}
    rows = _flatten_streaks(raw)
    rows.sort(key=lambda r: (-(r.get('streak') or 0), r.get('ts') or 0))
    return jsonify(rows[:limit])


@app.route('/api/_diag')
def diag_api():
    """Production-debug endpoint. Reports cache status + tries a one-shot
    Firebase read so we can see WHY the cache isn't populating. Safe to leave
    in: it only exposes cache size and error text, no player data."""
    info = {
        "cache_size": len(player_cache.get('data') or []),
        "cache_age_seconds": (time.time() - player_cache['time']) if player_cache.get('time') else None,
        "database_url_set": bool(os.getenv('DATABASE_URL')),
        "fb_key_path_set": bool(os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY')),
        "fb_json_set": bool(os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')),
    }
    # 1) Try to read a single player record using a valid query.
    try:
        sample = db.reference('data/players').order_by_key().limit_to_first(1).get()
        info["live_read_ok"] = True
        info["live_read_returned"] = (
            list(sample.keys()) if isinstance(sample, dict)
            else (f"list-of-{len(sample)}" if isinstance(sample, list) else type(sample).__name__)
        )
    except Exception as e:
        info["live_read_ok"] = False
        info["live_read_error"] = f"{type(e).__name__}: {e}"

    # 2) Force a cache refresh inline and report the result.
    try:
        _refresh_player_cache()
        info["forced_refresh_ok"] = True
        info["forced_refresh_size"] = player_cache.get('pool_total', 0)
    except Exception as e:
        info["forced_refresh_ok"] = False
        info["forced_refresh_error"] = f"{type(e).__name__}: {e}"

    # 3) Confirm whether the background cache thread is actually alive.
    import threading as _t
    info["thread_names"] = [t.name for t in _t.enumerate() if t.daemon]
    return jsonify(info)


@app.route('/api/next_pair')
def next_pair_api():
    """Smart-matched pair of players for the rank page.

    Optional ?match=<fixture_id> restricts the pool to the two countries in
    that fixture. Without it, the pool is all 1,243 players. The matchmaker
    biases toward (a) under-voted players and (b) similar-ELO opponents.
    """
    pool = list(player_cache.get('data') or [])
    match_id = request.args.get('match')
    fixture = None
    if match_id:
        fixture = next((f for f in ALL_FIXTURES if f['id'] == match_id), None)
        if not fixture:
            return jsonify({"error": "fixture not found"}), 404
        countries = {fixture['home'], fixture['away']}
        pool = [(pid, rec) for pid, rec in pool if rec.get('country') in countries]

    a, b = pick_matchup(pool)
    if not a or not b:
        return jsonify({"error": "pool too small"}), 503
    return jsonify({"a": a, "b": b, "fixture": fixture})


@app.route('/api/fixtures')
def fixtures_api():
    """Live + today's + upcoming fixtures with status and scores attached.

    Query params:
        limit: integer or 'all'
        order: 'ticker' (default) for live/recent-first, 'chrono' for pure
               chronological by kickoff (used by the /fixtures page)
    """
    raw = request.args.get('limit', '30')
    if raw == 'all':
        limit = len(ALL_FIXTURES) or 200
    else:
        try:
            limit = int(raw)
        except ValueError:
            limit = 30
    order = request.args.get('order', 'ticker')
    if order not in ('ticker', 'chrono'):
        order = 'ticker'
    return jsonify(_upcoming_fixtures(limit=limit, order=order))


@app.route('/api/scores')
def scores_api():
    """Light-weight live scores snapshot for clients that want to poll just
    the scores without re-fetching the entire fixture list. Returns the
    merged TheSportsDB auto + Firebase manual map."""
    return jsonify({
        'scores': _merged_scores(),
        'fetched_at': LIVE_SCORES_LAST_FETCH,
    })


@app.route('/api/admin/score', methods=['POST'])
def admin_set_score():
    """Manually set a match score. Required when TheSportsDB doesn't have
    coverage. Auth: shared-secret env var ADMIN_SECRET, passed as
    X-Admin-Secret header. Leave the env var blank to disable the endpoint
    in production.

    Body: {match_id, home_score, away_score, status?, minute?}
        status: 'live' | 'ft' | 'upcoming' (defaults: kept from existing)
        minute: any free-text label like "67'" or "HT" (optional)

    Send {match_id, clear: true} to delete a score entry.
    """
    if not ADMIN_SECRET:
        return jsonify({"error": "admin endpoint disabled"}), 403
    if request.headers.get('X-Admin-Secret') != ADMIN_SECRET:
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    fid = data.get('match_id')
    if not fid:
        return jsonify({"error": "match_id required"}), 400
    ref = db.reference(f'data/scores/{fid}')
    if data.get('clear'):
        ref.delete()
        return jsonify({"ok": True, "cleared": fid})
    try:
        entry = {
            'home_score': int(data.get('home_score') or 0),
            'away_score': int(data.get('away_score') or 0),
            'status':     (data.get('status') or '').strip(),
            'minute':     (data.get('minute') or '').strip(),
        }
    except (TypeError, ValueError):
        return jsonify({"error": "scores must be integers"}), 400
    ref.set(entry)
    return jsonify({"ok": True, "set": fid, "value": entry})


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


# Country -> group letter for the 2026 World Cup. Static because squads
# are fixed for the tournament. (Previously read from resolved.json, but
# that file is a one-off seed artefact and isn't deployed to production.)
COUNTRY_GROUP = {
    'Algeria': 'J', 'Argentina': 'J', 'Australia': 'D', 'Austria': 'J',
    'Belgium': 'G', 'Bosnia and Herzegovina': 'B', 'Brazil': 'C',
    'Canada': 'B', 'Cape Verde': 'H', 'Colombia': 'K', 'Croatia': 'L',
    'Curaçao': 'E', 'Czech Republic': 'A', 'DR Congo': 'K', 'Ecuador': 'E',
    'Egypt': 'G', 'England': 'L', 'France': 'I', 'Germany': 'E',
    'Ghana': 'L', 'Haiti': 'C', 'Iran': 'G', 'Iraq': 'I', 'Ivory Coast': 'E',
    'Japan': 'F', 'Jordan': 'J', 'Mexico': 'A', 'Morocco': 'C',
    'Netherlands': 'F', 'New Zealand': 'G', 'Norway': 'I', 'Panama': 'L',
    'Paraguay': 'D', 'Portugal': 'K', 'Qatar': 'B', 'Saudi Arabia': 'H',
    'Scotland': 'C', 'Senegal': 'I', 'South Africa': 'A', 'South Korea': 'A',
    'Spain': 'H', 'Sweden': 'F', 'Switzerland': 'B', 'Tunisia': 'F',
    'Turkey': 'D', 'United States': 'D', 'Uruguay': 'H', 'Uzbekistan': 'K',
}


@app.route('/api/leaderboard')
def leaderboard_api():
    """Top players by ELO with optional filters: group, country, position."""
    limit = int(request.args.get('limit', 100))
    group = request.args.get('group')
    country = request.args.get('country')
    position = request.args.get('position')

    raw = db.reference('data/players').get() or {}
    if isinstance(raw, list):
        raw = {str(i): v for i, v in enumerate(raw) if v}

    def keep(p):
        if country and p.get('country') != country:
            return False
        if position and p.get('position') != position:
            return False
        if group and COUNTRY_GROUP.get(p.get('country')) != group:
            return False
        return True

    filtered = [(pid, p) for pid, p in raw.items() if keep(p)]
    filtered.sort(key=lambda kv: kv[1].get('ELO', 0), reverse=True)
    return jsonify(filtered[:limit])


@app.route('/api/filters')
def filters_api():
    """Return the filter option lists the leaderboard UI needs."""
    countries = sorted(COUNTRY_GROUP.keys())
    groups = sorted({g for g in COUNTRY_GROUP.values() if g})
    positions = ['GK', 'DEF', 'MID', 'FWD']
    return jsonify({"countries": countries, "groups": groups, "positions": positions})


@app.route('/api/player/<player_id>')
def player_api(player_id):
    """Full profile data for a single player: record, history, rank, W/L."""
    rec = db.reference(f'data/players/{player_id}').get()
    if not rec:
        return jsonify({"error": "not found"}), 404

    history_raw = db.reference(f'data/elo_history/{player_id}').get() or {}
    if isinstance(history_raw, list):
        history_raw = {str(i): v for i, v in enumerate(history_raw) if v is not None}
    history = sorted(((int(ts), elo_val) for ts, elo_val in history_raw.items()), key=lambda x: x[0])

    stats = db.reference(f'data/stats/{player_id}').get() or {}

    # Global rank: how many players have a strictly higher ELO?
    all_players = db.reference('data/players').get() or {}
    if isinstance(all_players, list):
        all_players = {str(i): v for i, v in enumerate(all_players) if v}
    my_elo = rec.get('ELO', 0)
    higher = sum(1 for p in all_players.values() if p.get('ELO', 0) > my_elo)
    rank = higher + 1
    total = len(all_players)

    # Position rank within the same bucket.
    pos = rec.get('position')
    bucket_higher = sum(1 for p in all_players.values()
                       if p.get('position') == pos and p.get('ELO', 0) > my_elo)
    bucket_total = sum(1 for p in all_players.values() if p.get('position') == pos)

    # Trend = change over the last ~hour (or earliest sample).
    trend_window = 60 * 60
    now_ts = int(time.time())
    cutoff = now_ts - trend_window
    earlier = next((elo_val for ts, elo_val in history if ts >= cutoff), None)
    if earlier is None and history:
        earlier = history[0][1]
    trend = (my_elo - earlier) if earlier is not None else 0

    return jsonify({
        "id": player_id,
        "player": rec,
        "rank": rank,
        "total": total,
        "position_rank": bucket_higher + 1,
        "position_total": bucket_total,
        "wins": stats.get('wins', 0),
        "losses": stats.get('losses', 0),
        "history": history,        # list of [ts, elo]
        "trend_1h": trend,
    })


@app.route('/api/player_summary')
def player_summary_api():
    """Lightweight pair-of-players info for the "Why this one?" tooltip."""
    ids = request.args.get('ids', '').split(',')
    ids = [i for i in ids if i]
    if not ids:
        return jsonify({})
    out = {}
    for pid in ids[:2]:
        history_raw = db.reference(f'data/elo_history/{pid}').get() or {}
        if isinstance(history_raw, list):
            history_raw = {str(i): v for i, v in enumerate(history_raw) if v is not None}
        rec = db.reference(f'data/players/{pid}').get() or {}
        stats = db.reference(f'data/stats/{pid}').get() or {}
        cutoff = int(time.time()) - 3600
        history = sorted(((int(ts), v) for ts, v in history_raw.items()), key=lambda x: x[0])
        earlier = next((v for ts, v in history if ts >= cutoff), None)
        if earlier is None and history:
            earlier = history[0][1]
        trend = (rec.get('ELO', 0) - earlier) if earlier is not None else 0
        out[pid] = {
            "ELO": rec.get('ELO'),
            "wins": stats.get('wins', 0),
            "losses": stats.get('losses', 0),
            "trend_1h": trend,
        }
    return jsonify(out)


@app.route('/api/search_players')
def search_players_api():
    """Substring search across player names. Used by the compare page."""
    q = (request.args.get('q') or '').strip().lower()
    if not q or len(q) < 2:
        return jsonify([])
    raw = db.reference('data/players').get() or {}
    if isinstance(raw, list):
        raw = {str(i): v for i, v in enumerate(raw) if v}
    matches = []
    for pid, p in raw.items():
        if q in (p.get('player_name') or '').lower():
            matches.append({
                "id": pid,
                "player_name": p.get('player_name'),
                "country": p.get('country'),
                "club": p.get('club'),
                "position": p.get('position'),
                "image_url": p.get('image_url'),
                "ELO": p.get('ELO'),
            })
    matches.sort(key=lambda x: -(x['ELO'] or 0))
    return jsonify(matches[:15])


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

    win_ref = db.reference(f'data/players/{winning_id}/ELO')
    loss_ref = db.reference(f'data/players/{losing_id}/ELO')

    # Idempotent ELO updates: each transaction reads BOTH the player's current
    # ELO and the opponent's current ELO, recomputes the math from scratch,
    # and writes the result. If the same request runs twice (Render free-tier
    # proxy retries, client retries, etc.) the second run sees post-first-run
    # state and produces a near-zero delta instead of compounding.
    def winner_txn(current_win):
        cw = current_win if isinstance(current_win, (int, float)) else 1400
        opp = loss_ref.get()
        cl = opp if isinstance(opp, (int, float)) else 1400
        new_w, _ = elo.calculate_elo(cw, cl)
        return new_w

    def loser_txn(current_loss):
        cl = current_loss if isinstance(current_loss, (int, float)) else 1400
        # Use the just-updated winner ELO. The winner already wrote above, so
        # this read returns the post-write value, giving symmetric math.
        opp = win_ref.get()
        cw = opp if isinstance(opp, (int, float)) else 1400
        _, new_l = elo.calculate_elo(cw, cl)
        return new_l

    try:
        final_win = win_ref.transaction(winner_txn)
        final_loss = loss_ref.transaction(loser_txn)
    except Exception as e:
        print(f"Vote transaction failed: {e}")
        return jsonify({"error": "Vote failed"}), 500

    # Record win/loss + final ELO so player profile pages can show history,
    # trends, and W/L records. Stats live alongside per-player stat counters
    # so reads stay cheap (no aggregation needed at query time).
    ts = int(time.time())
    history_updates = {
        f'data/elo_history/{winning_id}/{ts}': final_win,
        f'data/elo_history/{losing_id}/{ts}': final_loss,
    }
    try:
        firebase_db.update(history_updates)
        # Bump W/L counters via transactions so concurrent votes don't lose increments.
        db.reference(f'data/stats/{winning_id}/wins').transaction(lambda v: (v or 0) + 1)
        db.reference(f'data/stats/{losing_id}/losses').transaction(lambda v: (v or 0) + 1)
    except Exception as e:
        # History/stats are best-effort; don't fail the vote if they error.
        print(f"History write failed (non-fatal): {e}")

    # Bump the public-facing live counter. This is per-process state, so
    # gunicorn workers each track their own delta; the next cache refresh
    # reconciles to the true Firebase total either way.
    global votes_since_refresh
    votes_since_refresh += 1

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

@app.route('/player/<player_id>')
def player_page(player_id):
    return render_template("player.html", player_id=player_id)

@app.route('/compare')
def compare_page():
    return render_template("compare.html")

@app.route('/fixtures')
def fixtures_page():
    return render_template("fixtures.html")

@app.route('/play')
def play_page():
    return render_template("play.html")



# When invoked directly (e.g. `python app.py` for local development) we use
# Flask's dev server with debug reload. In production Render runs gunicorn
# against this module and imports `app` without executing this block.
if __name__ == "__main__":
    app.run(debug=True, port=3000)