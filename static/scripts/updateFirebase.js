async function getCachedPlayers() {
    try {
        const response = await fetch('/api/cached_players');
        return await response.json();
    } catch (error) {
        console.error('Error fetching cache: ', error);
        return [];
    }
}

async function getFixturePlayers(matchId) {
    try {
        const response = await fetch(`/api/fixture_players?id=${encodeURIComponent(matchId)}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Error fetching fixture players: ', error);
        return null;
    }
}

function currentMatchId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('match');
}

function showFilterBanner(fixture) {
    const banner = document.getElementById('wc_filter_banner');
    const matchup = document.getElementById('wc_filter_matchup');
    if (!banner || !matchup) return;
    matchup.textContent = `${fixture.home} vs ${fixture.away}`;
    banner.classList.remove('hidden');
}

async function getDetailedPlayer(playerId) {
    try {
        const response = await fetch(`/api/detailed_data?player_id=${encodeURIComponent(playerId)}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching detailed data: ', error);
        return {};
    }
}

function pickTwoDistinct(arr) {
    const first = Math.floor(Math.random() * arr.length);
    let second;
    do { second = Math.floor(Math.random() * arr.length); } while (second === first);
    return [arr[first], arr[second]];
}

const SILHOUETTE = 'https://cdn.sofifa.net/player_0.svg';

// Host-nation accents from the official FIFA 26 brand: Canada red, Mexico
// green, USA blue. Players from elsewhere get the gold default.
const HOST_ACCENTS = {
    'Canada':        '#E31B23',
    'Mexico':        '#006847',
    'United States': '#002868',
};
const DEFAULT_ACCENT = '#C9A227';

function accentForCountry(country) {
    return HOST_ACCENTS[country] || DEFAULT_ACCENT;
}

async function waitForCache(maxAttempts = 6) {
    for (let i = 0; i < maxAttempts; i++) {
        const cached = await getCachedPlayers();
        if (cached && cached.length >= 2) return cached;
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
    return null;
}

function showGrid() {
    const grid = document.getElementById('player_grid');
    const loading = document.getElementById('loading_message');
    if (grid) grid.classList.remove('hidden');
    if (loading) loading.classList.add('hidden');
}

function showLoading(message) {
    const grid = document.getElementById('player_grid');
    const loading = document.getElementById('loading_message');
    if (grid) grid.classList.add('hidden');
    if (loading) { loading.classList.remove('hidden'); loading.textContent = message; }
}

let transitioning = false;

function resetCard(slot) {
    const old = document.getElementById(`player_${slot}_card`);
    const fresh = old.cloneNode(true);
    fresh.classList.remove('animate__fadeOut', 'animate__fast');
    fresh.classList.add('animate__fadeIn', 'animate__slower');
    old.parentNode.replaceChild(fresh, old);
    return fresh;
}

// When a match filter is active we cache the roster for the page lifetime
// so we're not refetching ~52 players on every vote.
let fixtureRoster = null;
let fixtureFetched = false;

async function getRoster() {
    const matchId = currentMatchId();
    if (matchId) {
        if (!fixtureFetched) {
            fixtureFetched = true;
            const data = await getFixturePlayers(matchId);
            if (data && data.players && data.players.length >= 2) {
                fixtureRoster = data.players;
                showFilterBanner(data.fixture);
            }
        }
        if (fixtureRoster) return fixtureRoster;
    }
    return await waitForCache();
}

async function renderPair() {
    showLoading('Loading matchup…');
    const roster = await getRoster();
    if (!roster || roster.length < 2) {
        showLoading('No players available. Refresh in a moment.');
        return;
    }
    showGrid();
    transitioning = false;

    const pair = pickTwoDistinct(roster);
    const cards = [resetCard(1), resetCard(2)];

    for (let i = 0; i < 2; i++) {
        const [pid, prec] = pair[i];
        const slot = i + 1;
        const cardEl = cards[i];
        const imgEl = cardEl.querySelector(`#player_${slot}_image`);
        const nameEl = cardEl.querySelector(`#player_${slot}_name`);
        const positionEl = cardEl.querySelector(`#player_${slot}_position`);
        const clubEl = cardEl.querySelector(`#player_${slot}_club`);

        imgEl.onerror = function () { this.src = SILHOUETTE; };
        imgEl.src = prec.image_url || SILHOUETTE;

        nameEl.textContent = prec.player_name || 'Player';

        const accent = accentForCountry(prec.country);
        cardEl.style.setProperty('--wc-card-accent', accent);

        const detail = await getDetailedPlayer(pid);
        const club = detail.club || prec.club || 'N/A';
        const country = detail.country || prec.country || '';
        clubEl.textContent = country ? `${club} · ${country}` : club;
        positionEl.textContent = detail.position || prec.position || 'N/A';

        cardEl.addEventListener('click', () => {
            if (transitioning) return;
            transitioning = true;

            const winner = pair[i];
            const loser = pair[i === 0 ? 1 : 0];
            sendVote({
                winning_id: winner[0],
                winning_elo: winner[1].ELO,
                losing_id: loser[0],
                losing_elo: loser[1].ELO,
            });

            for (const el of cards) {
                el.classList.replace('animate__slower', 'animate__fast');
                el.classList.add('animate__fadeOut');
            }
            setTimeout(renderPair, 600);
        });
    }
}

async function sendVote(payload) {
    try {
        await fetch('/api/update_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        console.error('Error sending vote:', error);
    }
}

renderPair();
