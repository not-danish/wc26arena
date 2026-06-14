(function () {
    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Reuse the FIFA code map ticker.js exposes if it's loaded. Falls back to
    // first-three-letters so this script works in isolation.
    const FIFA = (window.WC_FIFA_CODES) || {};
    function shortCountry(c) {
        return FIFA[c] || (c || '').slice(0, 3).toUpperCase();
    }

    function rowHtml(m, kind) {
        const sign = m.delta > 0 ? '+' : '';
        const cls = m.delta > 0 ? 'up' : 'down';
        const img = m.img
            ? `<img class="wc-mover-img" src="${esc(m.img)}" alt="" loading="lazy">`
            : `<div class="wc-mover-img wc-mover-img-blank"></div>`;
        return `
            <a class="wc-mover-row" href="/player/${encodeURIComponent(m.id)}">
                ${img}
                <span class="wc-mover-name">
                    <span class="wc-mover-pname">${esc(m.name || '')}</span>
                    <span class="wc-mover-meta">${esc(shortCountry(m.country))} · ${esc(m.position || '')}</span>
                </span>
                <span class="wc-mover-delta ${cls}">${sign}${m.delta}</span>
                <span class="wc-mover-elo">${Math.round(m.ELO || 0)}</span>
            </a>`;
    }

    function renderInto(el, list, kind, emptyMsg) {
        if (!el) return;
        if (!list.length) {
            el.innerHTML = `<div class="wc-movers-empty">${emptyMsg}</div>`;
            return;
        }
        el.innerHTML = list.map(m => rowHtml(m, kind)).join('');
    }

    async function load() {
        // Two variants may be on the page simultaneously (rail + full). The
        // rail wants 3 each; the full version wants up to 10.
        const variants = Array.from(document.querySelectorAll('.wc-movers'));
        if (!variants.length) return;

        let data;
        try {
            data = await fetch('/api/movers?limit=10').then(r => r.json());
        } catch {
            variants.forEach(v => {
                v.querySelectorAll('.wc-movers-list').forEach(el => {
                    el.innerHTML = '<div class="wc-movers-empty">Unavailable.</div>';
                });
            });
            return;
        }

        const gainers = data.gainers || [];
        const losers = data.losers || [];

        variants.forEach(v => {
            const variant = v.dataset.variant || 'full';
            const cap = variant === 'rail' ? 3 : (variant === 'side' ? 5 : 10);
            renderInto(
                document.getElementById(`wc_movers_gainers_${variant}`),
                gainers.slice(0, cap), 'gainers',
                'No movement yet.'
            );
            renderInto(
                document.getElementById(`wc_movers_losers_${variant}`),
                losers.slice(0, cap), 'losers',
                'No movement yet.'
            );
        });
    }

    load();
    setInterval(load, 90_000);
})();
