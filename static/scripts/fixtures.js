(function () {
    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Reuse the small country-code maps from ticker.js if available, fall back
    // to inline copies otherwise so this page works in isolation.
    const FIFA = (window.WC_FIFA_CODES) || {};
    function shortCountry(c) {
        return FIFA[c] || (c || '').slice(0, 3).toUpperCase();
    }

    function dateLabel(dateIso) {
        if (!dateIso) return '';
        const d = new Date(dateIso + 'T12:00:00Z');
        return d.toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric'
        });
    }

    // Kickoff time rendered in the viewer's browser timezone. Falls back to
    // the stadium-local fx.time string if kickoff_utc is missing.
    function localTime(fx) {
        if (!fx.kickoff_utc) return fx.time || '';
        try {
            return new Date(fx.kickoff_utc).toLocaleTimeString(undefined, {
                hour: 'numeric', minute: '2-digit',
            });
        } catch { return fx.time || ''; }
    }

    // Returns the calendar date (YYYY-MM-DD) of kickoff in viewer's local TZ.
    // Without this, a 11pm-PT match would still be grouped under the UTC
    // date which is the next day for a US viewer.
    function localDateKey(fx) {
        if (!fx.kickoff_utc) return fx.date || '';
        try {
            const d = new Date(fx.kickoff_utc);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        } catch { return fx.date || ''; }
    }

    let allFixtures = [];
    let stageFilter = 'all';

    const STAGE_LABELS = {
        group: 'Group Stage', r32: 'Round of 32', r16: 'Round of 16',
        qf: 'Quarterfinals', sf: 'Semifinals', '3p': 'Third-Place Playoff', final: 'FINAL',
    };
    const KNOCKOUT_STAGES = new Set(['r32', 'r16', 'qf', 'sf', '3p', 'final']);

    function stageMatches(fx) {
        if (stageFilter === 'all') return true;
        if (stageFilter === 'ko') return KNOCKOUT_STAGES.has(fx.stage);
        return fx.stage === stageFilter;
    }

    function render(filter) {
        const container = document.getElementById('wc_fixtures_list');
        const q = (filter || '').trim().toLowerCase();

        let matches = allFixtures.filter(stageMatches);
        if (q) {
            matches = matches.filter(fx =>
                fx.home.toLowerCase().includes(q) || fx.away.toLowerCase().includes(q));
        }

        if (matches.length === 0) {
            container.innerHTML = `<div class="wc-loading">No fixtures match "${esc(q)}".</div>`;
            return;
        }

        // Group fixtures by local calendar date so the page reads as a
        // schedule in the viewer's timezone (a 10pm-PT match isn't grouped
        // under tomorrow's UTC date for a West-coast viewer).
        const byDate = new Map();
        for (const fx of matches) {
            const key = localDateKey(fx);
            if (!byDate.has(key)) byDate.set(key, []);
            byDate.get(key).push(fx);
        }

        const html = [];
        for (const [date, group] of byDate) {
            html.push(`<h3 class="wc-fixtures-date">${esc(dateLabel(date))}</h3>`);
            for (const fx of group) {
                const status = fx.status || 'upcoming';
                const sc = fx.score;
                let timeCell = `<span class="wc-fixture-time">${esc(localTime(fx))}</span>`;
                let centerCell = `<span class="vs">vs</span>`;
                let cta = `Rank these squads →`;

                if (status === 'live') {
                    const minute = (sc && sc.minute) ? esc(sc.minute) : 'LIVE';
                    timeCell = `<span class="wc-fixture-status live"><span class="dot"></span>${minute}</span>`;
                    if (sc && sc.home_score !== null && sc.home_score !== undefined) {
                        centerCell = `<span class="wc-fixture-score">${sc.home_score} <span class="dash">-</span> ${sc.away_score}</span>`;
                    }
                    cta = `Vote on players →`;
                } else if (status === 'ft') {
                    timeCell = `<span class="wc-fixture-status ft">FT</span>`;
                    if (sc && sc.home_score !== null && sc.home_score !== undefined) {
                        centerCell = `<span class="wc-fixture-score">${sc.home_score} <span class="dash">-</span> ${sc.away_score}</span>`;
                    }
                    cta = `Rate this match →`;
                }

                const isKo = KNOCKOUT_STAGES.has(fx.stage);
                const stageBadge = isKo
                    ? `<span class="wc-fixture-stage stage-${esc(fx.stage)}">${esc(STAGE_LABELS[fx.stage] || fx.stage)}</span>`
                    : '';
                const koClass = isKo ? 'wc-fixture-knockout' : '';

                html.push(`
                    <a class="wc-fixture-card wc-fixture-${status} ${koClass}" href="/rank?match=${encodeURIComponent(fx.id)}">
                        ${stageBadge}
                        ${timeCell}
                        <span class="wc-fixture-teams">
                            <span class="team">${esc(fx.home)}</span>
                            ${centerCell}
                            <span class="team">${esc(fx.away)}</span>
                        </span>
                        <span class="wc-fixture-venue">${esc(fx.venue || '')}</span>
                        <span class="wc-fixture-cta">${cta}</span>
                    </a>`);
            }
        }
        container.innerHTML = html.join('');
    }

    async function load() {
        try {
            allFixtures = await fetch('/api/fixtures?limit=all&order=chrono').then(r => r.json());
        } catch (e) {
            document.getElementById('wc_fixtures_list').innerHTML =
                '<div class="wc-loading">Failed to load fixtures.</div>';
            return;
        }
        if (!allFixtures.length) {
            document.getElementById('wc_fixtures_list').innerHTML =
                '<div class="wc-loading">No upcoming fixtures.</div>';
            return;
        }
        render(currentSearch());
    }

    function currentSearch() {
        return document.getElementById('wc_fx_search')?.value || '';
    }

    document.getElementById('wc_fx_search')?.addEventListener('input', (e) => {
        render(e.target.value);
    });

    document.querySelectorAll('#wc_fx_stage_filter .wc-stage-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#wc_fx_stage_filter .wc-stage-pill')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            stageFilter = btn.dataset.stage || 'all';
            render(currentSearch());
        });
    });

    load();
    // Refresh every 60s so LIVE scores update in place without a page reload.
    setInterval(load, 60_000);
})();
