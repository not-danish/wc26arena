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

    let allFixtures = [];

    function render(filter) {
        const container = document.getElementById('wc_fixtures_list');
        const q = (filter || '').trim().toLowerCase();

        const matches = q
            ? allFixtures.filter(fx =>
                fx.home.toLowerCase().includes(q) || fx.away.toLowerCase().includes(q))
            : allFixtures;

        if (matches.length === 0) {
            container.innerHTML = `<div class="wc-loading">No fixtures match "${esc(q)}".</div>`;
            return;
        }

        // Group fixtures by calendar date so the page reads as a schedule
        // rather than an undifferentiated list.
        const byDate = new Map();
        for (const fx of matches) {
            if (!byDate.has(fx.date)) byDate.set(fx.date, []);
            byDate.get(fx.date).push(fx);
        }

        const html = [];
        for (const [date, group] of byDate) {
            html.push(`<h3 class="wc-fixtures-date">${esc(dateLabel(date))}</h3>`);
            for (const fx of group) {
                const status = fx.status || 'upcoming';
                const sc = fx.score;
                let timeCell = `<span class="wc-fixture-time">${esc(fx.time || '')}</span>`;
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

                html.push(`
                    <a class="wc-fixture-card wc-fixture-${status}" href="/rank?match=${encodeURIComponent(fx.id)}">
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

    load();
    // Refresh every 60s so LIVE scores update in place without a page reload.
    setInterval(load, 60_000);
})();
