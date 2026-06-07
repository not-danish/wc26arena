const SILHOUETTE = 'https://cdn.sofifa.net/player_0.svg';

function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function rankClass(rank) {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return '';
}

function currentFilters() {
    return {
        group:    document.getElementById('filter_group')?.value || '',
        country:  document.getElementById('filter_country')?.value || '',
        position: document.getElementById('filter_position')?.value || '',
    };
}

function buildQuery(extra = {}) {
    const f = { ...currentFilters(), ...extra };
    const qs = new URLSearchParams();
    qs.set('limit', '100');
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
    return qs.toString();
}

async function loadLeaderboard() {
    const body = document.getElementById('leaderboard_body');
    body.innerHTML = `<tr><td colspan="6" style="padding:3rem;text-align:center;">Loading…</td></tr>`;
    let players;
    try {
        const response = await fetch('/api/leaderboard?' + buildQuery());
        players = await response.json();
    } catch (e) {
        body.innerHTML = `<tr><td colspan="6" style="padding:3rem;text-align:center;color:#E31B23;">Failed to load leaderboard.</td></tr>`;
        return;
    }

    if (!players || players.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="padding:3rem;text-align:center;">No players ranked yet.</td></tr>`;
        return;
    }

    body.innerHTML = players.map(([id, p], idx) => {
        const rank = idx + 1;
        const img = p.image_url || SILHOUETTE;
        const href = `/player/${encodeURIComponent(id)}`;
        return `
            <tr onclick="window.location='${href}'" style="cursor:pointer">
                <td><span class="wc-rank ${rankClass(rank)}">${rank}</span></td>
                <td>
                    <div class="wc-player-cell">
                        <img src="${escapeHtml(img)}" onerror="this.src='${SILHOUETTE}'" alt="">
                        <span class="wc-player-name">${escapeHtml(p.player_name)}</span>
                    </div>
                </td>
                <td><span class="wc-chip">${escapeHtml(p.country)}</span></td>
                <td>${escapeHtml(p.club)}</td>
                <td>${escapeHtml(p.position)}</td>
                <td><span class="wc-elo">${Math.round(p.ELO)}</span></td>
            </tr>`;
    }).join('');
}

async function initFilters() {
    let opts;
    try { opts = await fetch('/api/filters').then(r => r.json()); }
    catch { return; }
    const grp = document.getElementById('filter_group');
    const ctry = document.getElementById('filter_country');
    const pos = document.getElementById('filter_position');
    opts.groups.forEach(g  => grp.insertAdjacentHTML('beforeend', `<option value="${g}">Group ${g}</option>`));
    opts.countries.forEach(c => ctry.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`));
    opts.positions.forEach(p => pos.insertAdjacentHTML('beforeend', `<option value="${p}">${p}</option>`));

    for (const id of ['filter_group','filter_country','filter_position']) {
        document.getElementById(id).addEventListener('change', loadLeaderboard);
    }
    document.getElementById('filter_reset').addEventListener('click', () => {
        grp.value = ''; ctry.value = ''; pos.value = '';
        loadLeaderboard();
    });
}

initFilters();
loadLeaderboard();
