(function () {
    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function flag(country) {
        const fn = window.WC_FLAG_EMOJI;
        return (fn && fn(country)) || '🏳️';
    }

    const STAGE_LABELS = {
        group: 'Group stage',
        r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF',
        '3p': '3rd-place', final: 'Final',
    };
    const STAGE_DEEP = {
        group: 'Group stage', r32: 'Round of 32', r16: 'Round of 16',
        qf: 'Quarterfinalist', sf: 'Semifinalist', '3p': 'Third-place finisher',
        final: 'Finalist',
    };

    let allTeams = [];
    let currentFilter = 'all';

    function teamCard(t) {
        const aliveCls = t.alive ? 'alive' : 'eliminated';
        const status = t.alive
            ? `<span class="wc-survivor-status alive">ALIVE</span>`
            : `<span class="wc-survivor-status eliminated">OUT · ${esc(STAGE_LABELS[t.eliminated_at] || 'Group')}</span>`;
        const reached = t.reached ? STAGE_DEEP[t.reached] : 'Group stage';
        const groupBadge = t.group ? `Group ${esc(t.group)} · ` : '';
        return `
            <a class="wc-survivor-card ${aliveCls}" href="/leaderboard?country=${encodeURIComponent(t.country)}">
                <span class="wc-survivor-flag">${flag(t.country)}</span>
                <div class="wc-survivor-body">
                    <span class="wc-survivor-name">${esc(t.country)}</span>
                    <span class="wc-survivor-meta">${groupBadge}${esc(reached)}</span>
                </div>
                ${status}
            </a>`;
    }

    function renderFlat(teams) {
        const grid = document.getElementById('wc_survivors_grid');
        if (!teams.length) {
            grid.innerHTML = '<div class="wc-loading">No teams match this filter.</div>';
            return;
        }
        grid.className = 'wc-survivors-grid';
        grid.innerHTML = teams.map(teamCard).join('');
    }

    function renderGrouped(teams) {
        // Bucket every team by its group letter. Teams without a group
        // (shouldn't happen for real WC entrants) fall into "?".
        const buckets = new Map();
        for (const t of teams) {
            const key = t.group || '?';
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(t);
        }
        // Within each group, alive teams come first, then sort by name so
        // the layout is deterministic.
        for (const arr of buckets.values()) {
            arr.sort((a, b) =>
                (a.alive === b.alive ? 0 : a.alive ? -1 : 1) ||
                a.country.localeCompare(b.country));
        }
        const keys = [...buckets.keys()].sort();
        const grid = document.getElementById('wc_survivors_grid');
        grid.className = 'wc-survivors-groups';
        grid.innerHTML = keys.map(k => {
            const teams = buckets.get(k);
            const alive = teams.filter(t => t.alive).length;
            const total = teams.length;
            const aliveAll = alive === total;
            const aliveNone = alive === 0;
            const badgeCls = aliveAll ? 'all-alive' : aliveNone ? 'all-out' : 'partial';
            return `
                <section class="wc-survivors-group">
                    <header class="wc-survivors-group-head">
                        <h3>Group ${esc(k)}</h3>
                        <span class="wc-survivors-group-count ${badgeCls}">${alive}/${total} alive</span>
                    </header>
                    <div class="wc-survivors-group-grid">
                        ${teams.map(teamCard).join('')}
                    </div>
                </section>`;
        }).join('');
    }

    function applyFilter() {
        if (currentFilter === 'all') {
            renderGrouped(allTeams);
            return;
        }
        const filtered = currentFilter === 'alive'
            ? allTeams.filter(t => t.alive)
            : allTeams.filter(t => !t.alive);
        renderFlat(filtered);
    }

    async function load() {
        let data;
        try {
            data = await fetch('/api/survivors').then(r => r.json());
        } catch (e) {
            document.getElementById('wc_survivors_grid').innerHTML =
                '<div class="wc-loading">Failed to load survivors.</div>';
            return;
        }
        allTeams = data.teams || [];
        const aliveCount = allTeams.filter(t => t.alive).length;
        const elimCount = allTeams.length - aliveCount;
        document.getElementById('wc_sv_alive').textContent = aliveCount;
        document.getElementById('wc_sv_elim').textContent = elimCount;
        document.getElementById('wc_sv_total').textContent = allTeams.length;
        applyFilter();
    }

    document.querySelectorAll('.wc-survivors-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.wc-survivors-tab')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter || 'all';
            applyFilter();
        });
    });

    load();
    setInterval(load, 90 * 1000);
})();
