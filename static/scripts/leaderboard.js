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

async function loadLeaderboard() {
    const body = document.getElementById('leaderboard_body');
    let players;
    try {
        const response = await fetch('/api/leaderboard?limit=100');
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
        return `
            <tr>
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

loadLeaderboard();
