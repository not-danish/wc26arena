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

    // History is passed in JS memory rather than serialized into a data
    // attribute; the latter is fragile and was the source of an earlier bug
    // where all points appeared at the same timestamp.
    let chartHistory = [];

    function chartShell() {
        return `
            <div class="wc-chart-wrap">
                <svg class="wc-chart" viewBox="0 0 600 180" preserveAspectRatio="none">
                    <g class="grid"></g>
                    <path class="line"  fill="none" stroke="#C9A227" stroke-width="1.4"
                          stroke-linecap="round" stroke-linejoin="round"/>
                    <path class="area"  fill="rgba(201,162,39,0.10)" stroke="none"/>
                    <line class="tracker" stroke="rgba(201,162,39,0.45)" stroke-width="1"
                          y1="0" y2="180" style="display:none"/>
                    <circle class="dot" r="4" fill="#E8C547" stroke="#0A0A0A" stroke-width="1.5"
                            style="display:none"/>
                </svg>
                <div class="wc-chart-tip" style="display:none"></div>
                <div class="wc-chart-empty" style="display:none">Vote for this player to start building their ELO history.</div>
            </div>`;
    }

    function formatTs(ts) {
        const d = new Date(ts * 1000);
        return d.toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
        });
    }

    function initChart(wrap) {
        const history = chartHistory;
        const svg = wrap.querySelector('svg');
        const linePath = svg.querySelector('.line');
        const areaPath = svg.querySelector('.area');
        const tracker = svg.querySelector('.tracker');
        const dot = svg.querySelector('.dot');
        const tip = wrap.querySelector('.wc-chart-tip');
        const empty = wrap.querySelector('.wc-chart-empty');

        if (history.length < 2) {
            empty.style.display = 'flex';
            return;
        }

        const W = 600, H = 180, PAD_X = 20, PAD_Y = 16;
        const elos = history.map(p => p[1]);
        const ts = history.map(p => p[0]);
        const minE = Math.min(...elos), maxE = Math.max(...elos);
        const range = Math.max(maxE - minE, 1);
        const minT = ts[0], maxT = ts[ts.length - 1];
        const spanT = Math.max(maxT - minT, 1);

        // Convert each [ts, elo] point to chart coordinates.
        const pts = history.map(([t, e]) => {
            const x = PAD_X + ((t - minT) / spanT) * (W - 2 * PAD_X);
            const y = H - PAD_Y - ((e - minE) / range) * (H - 2 * PAD_Y);
            return { x, y, t, e };
        });

        linePath.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + p.x + ',' + p.y).join(' '));
        areaPath.setAttribute('d',
            'M' + pts[0].x + ',' + (H - PAD_Y) + ' '
            + pts.map(p => 'L' + p.x + ',' + p.y).join(' ')
            + ' L' + pts[pts.length - 1].x + ',' + (H - PAD_Y) + ' Z'
        );

        // Light horizontal grid + min/max labels.
        const grid = svg.querySelector('.grid');
        grid.innerHTML = '';
        for (const [label, val] of [['max', maxE], ['min', minE]]) {
            const y = H - PAD_Y - ((val - minE) / range) * (H - 2 * PAD_Y);
            grid.insertAdjacentHTML('beforeend',
                `<line x1="${PAD_X}" x2="${W - PAD_X}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"
                       stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`
                + `<text x="${W - PAD_X + 2}" y="${(y + 4).toFixed(1)}"
                       fill="rgba(255,255,255,0.35)" font-size="10"
                       font-family="Noto Sans, sans-serif">${val}</text>`);
        }

        // Map a clientX position onto the nearest data point.
        function nearestPoint(clientX) {
            const rect = svg.getBoundingClientRect();
            // The SVG uses viewBox 0..W but is rendered at any width: convert px -> viewBox coords.
            const vbX = ((clientX - rect.left) / rect.width) * W;
            // Binary-ish search: pts are sorted by x.
            let lo = 0, hi = pts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (pts[mid].x < vbX) lo = mid + 1;
                else hi = mid;
            }
            // Compare lo vs lo-1 to pick the truly nearest.
            if (lo > 0 && Math.abs(pts[lo - 1].x - vbX) < Math.abs(pts[lo].x - vbX)) lo--;
            return { idx: lo, point: pts[lo] };
        }

        function showAt(clientX) {
            const { idx, point } = nearestPoint(clientX);
            tracker.setAttribute('x1', point.x);
            tracker.setAttribute('x2', point.x);
            tracker.style.display = '';
            dot.setAttribute('cx', point.x);
            dot.setAttribute('cy', point.y);
            dot.style.display = '';

            const prev = idx > 0 ? pts[idx - 1].e : null;
            const delta = prev !== null ? point.e - prev : 0;
            const deltaTxt = delta === 0 ? '' :
                ` <span class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</span>`;
            tip.innerHTML = `<span class="elo">ELO ${point.e}</span>${deltaTxt}<span class="ts">${formatTs(point.t)}</span>`;
            tip.style.display = 'block';

            // Position the tooltip in DOM (px) coordinates.
            const rect = svg.getBoundingClientRect();
            const tipX = (point.x / W) * rect.width;
            tip.style.left = tipX + 'px';
        }

        function hide() {
            tracker.style.display = 'none';
            dot.style.display = 'none';
            tip.style.display = 'none';
        }

        wrap.addEventListener('mousemove', e => showAt(e.clientX));
        wrap.addEventListener('mouseleave', hide);
        wrap.addEventListener('touchstart',  e => showAt(e.touches[0].clientX), { passive: true });
        wrap.addEventListener('touchmove',   e => showAt(e.touches[0].clientX), { passive: true });
        wrap.addEventListener('touchend',    hide);
    }

    function render(data) {
        const p = data.player;
        const trend = data.trend_1h || 0;
        const trendClass = trend > 0 ? 'up' : trend < 0 ? 'down' : '';
        const trendSign = trend > 0 ? '+' : '';
        const totalVotes = (data.wins || 0) + (data.losses || 0);
        const winRate = totalVotes > 0
            ? Math.round(100 * data.wins / totalVotes) + '%'
            : '—';
        const wlSub = totalVotes > 0
            ? `${data.wins} W · ${data.losses} L (${winRate} win)`
            : 'No votes yet';

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
                            <div class="label">Total Votes</div>
                            <div class="value">${totalVotes}</div>
                            <div class="sub">${wlSub}</div>
                        </div>
                    </div>
                    <div class="wc-history-card">
                        <h3>ELO history</h3>
                        ${chartShell()}
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
            chartHistory = data.history || [];
            root.innerHTML = render(data);
            document.title = `${data.player.player_name} · wc26arena`;
            const wrap = root.querySelector('.wc-chart-wrap');
            if (wrap) initChart(wrap);
        } catch (e) {
            root.innerHTML = `<div class="wc-loading">Failed to load profile.</div>`;
        }
    }

    load();
})();
