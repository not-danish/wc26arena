(function () {
    const SILHOUETTE = 'https://cdn.sofifa.net/player_0.svg';

    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    const state = { a: null, b: null };  // each holds the /api/player payload

    function emptySlot(which) {
        return `
            <div class="empty">
                <input class="wc-compare-search" type="text" data-slot="${which}"
                       placeholder="Search players…">
                <div class="wc-compare-results hidden" data-results-for="${which}"></div>
                <p style="color:var(--wc-text-muted); margin-top:1rem; font-size:0.85rem; letter-spacing:0.1em; text-transform:uppercase;">
                    Type at least 2 letters
                </p>
            </div>`;
    }

    function bar(label, a, b, fmt = v => v) {
        const aWins = (a ?? -Infinity) > (b ?? -Infinity);
        const bWins = (b ?? -Infinity) > (a ?? -Infinity);
        const max = Math.max(Math.abs(a || 0), Math.abs(b || 0), 1);
        const pctA = Math.min(100, Math.abs((a || 0) / max) * 100);
        const pctB = Math.min(100, Math.abs((b || 0) / max) * 100);
        return {
            html: `
                <div class="wc-compare-bar">
                    <div class="row"><span>${esc(label)}</span><span class="v">${fmt(a)} <span style="opacity:0.4">|</span> ${fmt(b)}</span></div>
                    <div class="track">
                        <div class="fill ${aWins ? 'winner' : bWins ? 'loser' : ''}" style="width:${pctA}%"></div>
                    </div>
                    <div class="track">
                        <div class="fill ${bWins ? 'winner' : aWins ? 'loser' : ''}" style="width:${pctB}%"></div>
                    </div>
                </div>`,
        };
    }

    function playerSlot(which, data) {
        const p = data.player;
        return `
            <div class="wc-compare-player">
                <div class="wc-pitch-photo">
                    <img src="${esc(p.image_url || SILHOUETTE)}" onerror="this.src='${SILHOUETTE}'" alt="">
                </div>
                <h2 class="name"><a href="/player/${esc(data.id)}" style="color:inherit; text-decoration:none">${esc(p.player_name)}</a></h2>
                <p class="meta">${esc(p.club || 'N/A')} · ${esc(p.country || '')} · ${esc(p.position || '')}</p>
                <div class="wc-compare-bars" data-bars="${which}"></div>
                <div style="margin-top:1rem; text-align:center">
                    <button class="reset" data-clear="${which}" style="background:transparent; border:1px solid var(--wc-border); color:var(--wc-text-muted); padding:0.4rem 0.85rem; font-family:var(--font-display); letter-spacing:0.12em; font-size:0.75rem; text-transform:uppercase; cursor:pointer">
                        Change
                    </button>
                </div>
            </div>`;
    }

    function renderSlot(which) {
        const el = document.querySelector(`.wc-compare-slot[data-slot="${which}"]`);
        const data = state[which];
        el.innerHTML = data ? playerSlot(which, data) : emptySlot(which);
        if (data) updateBars();
    }

    function updateBars() {
        const a = state.a, b = state.b;
        for (const which of ['a', 'b']) {
            const container = document.querySelector(`[data-bars="${which}"]`);
            if (!container) continue;
            if (!a || !b) {
                container.innerHTML = `<p style="color:var(--wc-text-muted); font-size:0.85rem; text-align:center; letter-spacing:0.1em; text-transform:uppercase;">Pick the other player to compare</p>`;
                continue;
            }
            const me = which === 'a' ? a : b;
            const them = which === 'a' ? b : a;
            const myWinRate = (me.wins + me.losses) ? Math.round(100 * me.wins / (me.wins + me.losses)) : 0;
            const theirWinRate = (them.wins + them.losses) ? Math.round(100 * them.wins / (them.wins + them.losses)) : 0;
            container.innerHTML = [
                bar('ELO', Math.round(me.player.ELO), Math.round(them.player.ELO)).html,
                bar('Global Rank', them.rank, me.rank, v => '#' + v).html,
                bar('Position Rank', them.position_rank, me.position_rank, v => '#' + v).html,
                bar('Wins', me.wins, them.wins).html,
                bar('Win Rate %', myWinRate, theirWinRate, v => v + '%').html,
            ].join('');
        }
    }

    async function pickPlayer(which, id) {
        try {
            const data = await fetch(`/api/player/${encodeURIComponent(id)}`).then(r => r.json());
            if (data.error) return;
            state[which] = data;
            // Update the URL so the result is shareable.
            const url = new URL(window.location.href);
            url.searchParams.set(which, id);
            window.history.replaceState({}, '', url);
            renderSlot(which);
            // Other slot might need bar refresh if it was already populated.
            if (state[which === 'a' ? 'b' : 'a']) renderSlot(which === 'a' ? 'b' : 'a');
        } catch (e) { console.error(e); }
    }

    async function search(which, q, resultsEl) {
        if (q.length < 2) { resultsEl.classList.add('hidden'); return; }
        try {
            const list = await fetch(`/api/search_players?q=${encodeURIComponent(q)}`).then(r => r.json());
            if (!list.length) { resultsEl.innerHTML = '<div style="padding:0.6rem; color:var(--wc-text-muted)">No matches</div>'; resultsEl.classList.remove('hidden'); return; }
            resultsEl.innerHTML = list.map(p => `
                <div class="wc-compare-result" data-pick="${esc(p.id)}">
                    <img src="${esc(p.image_url || SILHOUETTE)}" onerror="this.src='${SILHOUETTE}'" alt="">
                    <div>
                        <div class="name">${esc(p.player_name)}</div>
                        <div class="meta">${esc(p.country)} · ${esc(p.position)} · ${Math.round(p.ELO)}</div>
                    </div>
                </div>`).join('');
            resultsEl.classList.remove('hidden');
            resultsEl.querySelectorAll('[data-pick]').forEach(row => {
                row.addEventListener('click', () => {
                    pickPlayer(which, row.dataset.pick);
                });
            });
        } catch (e) { console.error(e); }
    }

    // Delegated listeners on the page root so we can re-render slots freely.
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (t?.classList?.contains('wc-compare-search')) {
            const which = t.dataset.slot;
            const results = document.querySelector(`[data-results-for="${which}"]`);
            search(which, t.value.trim(), results);
        }
    });
    document.addEventListener('click', (e) => {
        const clear = e.target.closest?.('[data-clear]');
        if (clear) {
            state[clear.dataset.clear] = null;
            const url = new URL(window.location.href);
            url.searchParams.delete(clear.dataset.clear);
            window.history.replaceState({}, '', url);
            renderSlot(clear.dataset.clear);
            renderSlot(clear.dataset.clear === 'a' ? 'b' : 'a');
        }
    });

    // Initial render: empty slots, optionally pre-populated from ?a=&b=
    renderSlot('a');
    renderSlot('b');
    const params = new URLSearchParams(window.location.search);
    if (params.get('a')) pickPlayer('a', params.get('a'));
    if (params.get('b')) pickPlayer('b', params.get('b'));
})();
