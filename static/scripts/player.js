(function () {
    const SILHOUETTE = 'https://cdn.sofifa.net/player_0.svg';

    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function ordinal(n) {
        if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
        const last = n % 10;
        return n + (last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th');
    }

    function sparkline(history) {
        // history: array of [ts, elo]. Renders a simple SVG line.
        if (!history || history.length < 2) {
            return '<svg class="wc-spark" viewBox="0 0 100 30"></svg>';
        }
        const elos = history.map(h => h[1]);
        const minE = Math.min(...elos), maxE = Math.max(...elos);
        const range = Math.max(maxE - minE, 1);
        const w = 100, h = 30;
        const pts = history.map((p, i) => {
            const x = (i / (history.length - 1)) * w;
            const y = h - ((p[1] - minE) / range) * (h - 4) - 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return `
            <svg class="wc-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
                <polyline points="${pts}" fill="none" stroke="#C9A227" stroke-width="0.8"
                          stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
    }

    function render(data) {
        const p = data.player;
        const trend = data.trend_1h || 0;
        const trendClass = trend > 0 ? 'up' : trend < 0 ? 'down' : '';
        const trendSign = trend > 0 ? '+' : '';
        const winRate = (data.wins + data.losses) > 0
            ? Math.round(100 * data.wins / (data.wins + data.losses))
            : '—';

        return `
            <div class="wc-profile-grid">
                <div class="wc-profile-card">
                    <div class="wc-profile-img">
                        <img src="${esc(p.image_url || SILHOUETTE)}" onerror="this.src='${SILHOUETTE}'" alt="">
                    </div>
                    <h1 class="wc-profile-name">${esc(p.player_name)}</h1>
                    <p class="wc-profile-sub">${esc(p.club || 'N/A')} · ${esc(p.country || '')}</p>
                    <span class="wc-profile-pos">${esc(p.position || '')}</span>
                </div>
                <div>
                    <div class="wc-profile-stats">
                        <div class="wc-stat-block">
                            <div class="label">Current ELO</div>
                            <div class="value">${Math.round(p.ELO)}</div>
                            <div class="sub"><span class="trend ${trendClass}">${trendSign}${trend}</span> in last hour</div>
                        </div>
                        <div class="wc-stat-block">
                            <div class="label">Global Rank</div>
                            <div class="value">${ordinal(data.rank)}</div>
                            <div class="sub">of ${data.total} players</div>
                        </div>
                        <div class="wc-stat-block">
                            <div class="label">Position Rank</div>
                            <div class="value">${ordinal(data.position_rank)}</div>
                            <div class="sub">of ${data.position_total} ${esc(p.position)}s</div>
                        </div>
                        <div class="wc-stat-block">
                            <div class="label">Win Rate</div>
                            <div class="value">${winRate}${winRate === '—' ? '' : '%'}</div>
                            <div class="sub">${data.wins} W · ${data.losses} L</div>
                        </div>
                    </div>
                    <div class="wc-history-card">
                        <h3>ELO history</h3>
                        ${sparkline(data.history)}
                    </div>
                    <div class="wc-share-row">
                        <a class="wc-btn wc-btn-ghost" href="/compare?a=${esc(data.id)}">Compare →</a>
                    </div>
                </div>
            </div>`;
    }

    async function load() {
        const root = document.getElementById('wc_profile_root');
        const pid = document.querySelector('[data-player-id]')?.dataset?.playerId;
        if (!pid) { root.innerHTML = '<div class="wc-loading">Missing player id</div>'; return; }
        try {
            const data = await fetch(`/api/player/${encodeURIComponent(pid)}`).then(r => r.json());
            if (data.error) {
                root.innerHTML = `<div class="wc-loading">Player not found.</div>`;
                return;
            }
            root.innerHTML = render(data);
            document.title = `${data.player.player_name} — wc26arena`;
        } catch (e) {
            root.innerHTML = `<div class="wc-loading">Failed to load profile.</div>`;
        }
    }

    load();
})();
