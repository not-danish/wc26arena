(function () {
    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    const FIFA = (window.WC_FIFA_CODES) || {};
    function shortCountry(c) {
        return FIFA[c] || (c || '').slice(0, 3).toUpperCase();
    }

    // Country -> flag emoji via the helper exposed by ticker.js. Returns a
    // crossed-swords glyph for placeholders so the UI still has something to
    // render before teams advance.
    function flag(country) {
        const fn = window.WC_FLAG_EMOJI;
        const emoji = fn ? fn(country) : '';
        return emoji || '⚔️';
    }

    const ROUND_LABELS = {
        r32: 'Round of 32',
        r16: 'Round of 16',
        qf:  'Quarterfinals',
        sf:  'Semifinals',
        '3p': 'Third Place',
        final: 'Final',
    };

    function isPlaceholder(name) {
        if (!name) return true;
        return /^([12][A-L]|Best 3rd|W |L )/i.test(name) || name.length <= 3;
    }

    function renderTeam(name, score, isWinner, isLoser) {
        const flagSpan = isPlaceholder(name)
            ? '<span class="bk-team-flag tbd">?</span>'
            : `<span class="bk-team-flag">${flag(name)}</span>`;
        const cls = ['bk-team'];
        if (isWinner) cls.push('winner');
        if (isLoser) cls.push('loser');
        if (isPlaceholder(name)) cls.push('tbd');
        const displayName = isPlaceholder(name)
            ? `<span class="bk-team-name tbd">${esc(name || 'TBD')}</span>`
            : `<span class="bk-team-name">${esc(name)}</span>`;
        const scoreSpan = (score !== undefined && score !== null)
            ? `<span class="bk-team-score">${esc(score)}</span>`
            : '';
        return `<div class="${cls.join(' ')}">${flagSpan}${displayName}${scoreSpan}</div>`;
    }

    function matchCard(fx) {
        const sc = fx.score || {};
        const hs = sc.home_score;
        const as = sc.away_score;
        const isFt = fx.status === 'ft' && hs != null && as != null;
        const homeWin = isFt && hs > as;
        const awayWin = isFt && as > hs;

        let badge = '';
        if (fx.status === 'live') {
            badge = `<span class="bk-badge live"><span class="dot"></span>${esc((sc.minute) || 'LIVE')}</span>`;
        } else if (fx.status === 'ft') {
            badge = `<span class="bk-badge ft">FT</span>`;
        } else if (fx.placeholder) {
            badge = `<span class="bk-badge tbd">TBD</span>`;
        } else {
            const d = fx.kickoff_utc ? new Date(fx.kickoff_utc) : null;
            const dateStr = d ? d.toLocaleDateString(undefined, {month:'short', day:'numeric'}) : '';
            const timeStr = d ? d.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'}) : '';
            badge = `<span class="bk-badge upcoming">${esc(dateStr)} · ${esc(timeStr)}</span>`;
        }

        const slot = fx.bracket_slot ? `<span class="bk-slot">${esc(fx.bracket_slot)}</span>` : '';
        const venue = fx.venue ? `<span class="bk-venue">${esc(fx.venue)}</span>` : '';

        const clickable = !fx.placeholder;
        const href = clickable ? `/rank?match=${encodeURIComponent(fx.id)}` : '#';

        return `
            <${clickable ? 'a' : 'div'} class="bk-match ${clickable ? 'clickable' : 'static'} stage-${esc(fx.stage)}"
               ${clickable ? `href="${href}"` : ''}>
                <div class="bk-match-head">${slot}${badge}</div>
                ${renderTeam(fx.home, hs, homeWin, awayWin)}
                ${renderTeam(fx.away, as, awayWin, homeWin)}
                <div class="bk-match-foot">${venue}${clickable ? '<span class="bk-cta">RATE →</span>' : ''}</div>
            </${clickable ? 'a' : 'div'}>`;
    }

    function renderTree(data) {
        const r = data.rounds || {};

        // Layout: R32 | R16 | QF | SF | FINAL  (then a 3P off to the side)
        // The R32 column is split into two halves (top/bottom) like a real bracket
        // so the tree visually narrows toward the final.
        const cols = [
            { stage: 'r32', title: 'R32', matches: r.r32 || [] },
            { stage: 'r16', title: 'R16', matches: r.r16 || [] },
            { stage: 'qf',  title: 'QF',  matches: r.qf  || [] },
            { stage: 'sf',  title: 'SF',  matches: r.sf  || [] },
            { stage: 'final', title: 'FINAL', matches: r.final || [] },
        ];

        const colsHtml = cols.map(col => {
            const matchHtml = col.matches.map(matchCard).join('') || '<div class="bk-match-empty">—</div>';
            return `
                <div class="bk-col bk-col-${col.stage}">
                    <h3 class="bk-col-title">${col.title}</h3>
                    <div class="bk-col-matches">${matchHtml}</div>
                </div>`;
        }).join('');

        // Trophy column shown when the final has been resolved
        const finalMatch = (r.final || [])[0];
        let trophyHtml = '<div class="bk-trophy"><span class="trophy-glyph">🏆</span><span class="trophy-label">Champion</span><span class="trophy-team">TBD</span></div>';
        if (finalMatch && finalMatch.status === 'ft' && finalMatch.score) {
            const sc = finalMatch.score;
            const champ = sc.home_score > sc.away_score ? finalMatch.home
                       : sc.away_score > sc.home_score ? finalMatch.away : null;
            if (champ) {
                trophyHtml = `<div class="bk-trophy crowned">
                    <span class="trophy-glyph">🏆</span>
                    <span class="trophy-label">Champion</span>
                    <span class="trophy-team">${flag(champ)} ${esc(champ)}</span>
                </div>`;
            }
        }

        // Third-place playoff lives below the main tree, full-width
        const thirdMatches = (r['3p'] || []).map(matchCard).join('') || '';
        const thirdHtml = thirdMatches ? `
            <div class="bk-third">
                <h3 class="bk-col-title">Third-Place Playoff</h3>
                <div class="bk-third-match">${thirdMatches}</div>
            </div>` : '';

        return `
            <div class="bk-tree-cols">${colsHtml}<div class="bk-col bk-col-trophy">${trophyHtml}</div></div>
            ${thirdHtml}`;
    }

    function updateMeta(data) {
        const allMatches = [].concat(
            ...['r32','r16','qf','sf','3p','final'].map(s => (data.rounds || {})[s] || [])
        );
        const totalTeams = 32;
        const eliminated = (data.eliminated || []).length;
        document.getElementById('wc_br_alive').textContent = Math.max(0, totalTeams - eliminated);

        // Figure out the current round = first round with any non-FT matches.
        // If everything's done, show "FINAL".
        const order = ['r32','r16','qf','sf','3p','final'];
        let current = 'r32';
        for (const stage of order) {
            const matches = (data.rounds || {})[stage] || [];
            if (matches.some(m => m.status !== 'ft')) { current = stage; break; }
            current = stage;
        }
        document.getElementById('wc_br_round').textContent = ROUND_LABELS[current] || '—';

        // Next match = nearest future upcoming match
        const now = Date.now();
        let nextLabel = '—';
        const upcoming = allMatches
            .filter(m => m.status === 'upcoming' && m.kickoff_utc)
            .map(m => ({ t: new Date(m.kickoff_utc).getTime(), m }))
            .filter(x => x.t > now)
            .sort((a,b) => a.t - b.t);
        if (upcoming.length) {
            const mins = Math.round((upcoming[0].t - now) / 60000);
            if (mins < 60) nextLabel = `${mins}m`;
            else if (mins < 60 * 24) nextLabel = `${Math.round(mins / 60)}h`;
            else nextLabel = `${Math.round(mins / (60 * 24))}d`;
        }
        document.getElementById('wc_br_next').textContent = nextLabel;
    }

    async function load() {
        let data;
        try {
            data = await fetch('/api/bracket').then(r => r.json());
        } catch (e) {
            document.getElementById('wc_bracket_tree').innerHTML =
                '<div class="wc-loading">Failed to load bracket.</div>';
            return;
        }
        document.getElementById('wc_bracket_tree').innerHTML = renderTree(data);
        updateMeta(data);
    }

    load();
    // Refresh every 60s so live scores propagate without a page reload.
    setInterval(load, 60_000);
})();
