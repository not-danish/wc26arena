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
                html.push(`
                    <a class="wc-fixture-card" href="/rank?match=${encodeURIComponent(fx.id)}">
                        <span class="wc-fixture-time">${esc(fx.time || '')}</span>
                        <span class="wc-fixture-teams">
                            <span class="team">${esc(fx.home)}</span>
                            <span class="vs">vs</span>
                            <span class="team">${esc(fx.away)}</span>
                        </span>
                        <span class="wc-fixture-venue">${esc(fx.venue || '')}</span>
                        <span class="wc-fixture-cta">Rank these squads →</span>
                    </a>`);
            }
        }
        container.innerHTML = html.join('');
    }

    async function load() {
        try {
            allFixtures = await fetch('/api/fixtures?limit=all').then(r => r.json());
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
        render('');
    }

    document.getElementById('wc_fx_search')?.addEventListener('input', (e) => {
        render(e.target.value);
    });

    load();
})();
