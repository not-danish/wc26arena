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

function showGrid() {
    const grid = document.getElementById('player_grid');
    const loading = document.getElementById('loading_message');
    const skip = document.getElementById('wc_skip_row');
    if (grid) grid.classList.remove('hidden');
    if (loading) loading.classList.add('hidden');
    if (skip) skip.classList.remove('hidden');
}

function showLoading(message) {
    const grid = document.getElementById('player_grid');
    const loading = document.getElementById('loading_message');
    const skip = document.getElementById('wc_skip_row');
    if (grid) grid.classList.add('hidden');
    if (skip) skip.classList.add('hidden');
    if (loading) { loading.classList.remove('hidden'); loading.textContent = message; }
}

let transitioning = false;

// Fade out both cards and load the next pair. Used by both the click-to-vote
// flow and the skip button, so the visual transition stays consistent.
function transitionToNextPair() {
    if (transitioning) return;
    transitioning = true;
    for (const slot of [1, 2]) {
        const el = document.getElementById(`player_${slot}_card`);
        if (!el) continue;
        el.classList.replace('animate__slower', 'animate__fast');
        el.classList.add('animate__fadeOut');
    }
    setTimeout(renderPair, 600);
}

function resetCard(slot) {
    const old = document.getElementById(`player_${slot}_card`);
    const fresh = old.cloneNode(true);
    fresh.classList.remove('animate__fadeOut', 'animate__fast');
    fresh.classList.add('animate__fadeIn', 'animate__slower');
    old.parentNode.replaceChild(fresh, old);
    return fresh;
}

async function getNextPair() {
    // Server-side smart matchmaker: weighted toward similar-ELO opponents
    // and under-voted players. Falls back to a wait+retry if the cache is
    // still being primed on cold start.
    const matchId = currentMatchId();
    const url = matchId
        ? `/api/next_pair?match=${encodeURIComponent(matchId)}`
        : '/api/next_pair';

    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            const resp = await fetch(url);
            if (resp.ok) {
                const data = await resp.json();
                if (data.fixture) showFilterBanner(data.fixture);
                if (data.a && data.b) return [data.a, data.b];
            }
        } catch (e) { /* fall through to retry */ }
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
    return null;
}

async function getPairSummary(ids) {
    try {
        const resp = await fetch(`/api/player_summary?ids=${encodeURIComponent(ids.join(','))}`);
        return await resp.json();
    } catch { return {}; }
}

function trendClass(delta) {
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'flat';
}

async function renderPair() {
    showLoading('Loading matchup…');
    const pair = await getNextPair();
    if (!pair) {
        showLoading('No players available. Refresh in a moment.');
        return;
    }
    showGrid();
    transitioning = false;

    const cards = [resetCard(1), resetCard(2)];

    const summary = await getPairSummary([pair[0][0], pair[1][0]]);

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

        // "Why this one?" hover tooltip: show ELO + 1h trend + W/L so the
        // user knows what's at stake before clicking.
        const s = summary[pid] || {};
        const trend = s.trend_1h || 0;
        const trendStr = trend > 0 ? `▲ +${trend}` : trend < 0 ? `▼ ${trend}` : '— flat';
        const tip = document.createElement('div');
        tip.className = 'wc-compare-tooltip';
        tip.innerHTML = `
            ELO ${Math.round(s.ELO ?? prec.ELO)}
            · W ${s.wins ?? 0}/L ${s.losses ?? 0}
            · <span class="trend ${trendClass(trend)}">${trendStr} 1h</span>
        `;
        cardEl.appendChild(tip);

        cardEl.addEventListener('click', () => {
            if (transitioning) return;
            const winner = pair[i];
            const loser = pair[i === 0 ? 1 : 0];
            sendVote({
                winning_id: winner[0],
                winning_elo: winner[1].ELO,
                losing_id: loser[0],
                losing_elo: loser[1].ELO,
            });
            transitionToNextPair();
        });
    }
}

async function sendVote(payload) {
    try {
        const resp = await fetch('/api/update_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (resp.ok && window.WCStreak) window.WCStreak.record();
    } catch (error) {
        console.error('Error sending vote:', error);
    }
}

document.getElementById('wc_skip_btn')?.addEventListener('click', () => {
    transitionToNextPair();
});

renderPair();
