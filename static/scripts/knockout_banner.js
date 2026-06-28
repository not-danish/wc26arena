(function () {
    // Homepage knockout banner. Hidden until /api/bracket returns at least
    // one knockout fixture in the upcoming/live window, at which point we
    // show a countdown and the current round.
    const el = document.getElementById('wc_ko_banner');
    if (!el) return;

    const ROUND_LABELS = {
        r32: 'Round of 32', r16: 'Round of 16',
        qf: 'Quarterfinals', sf: 'Semifinals',
        '3p': 'Third-Place Playoff', final: 'The Final',
    };
    const ROUND_HYPE = {
        r32: '32 teams → 16. Win or pack your bags.',
        r16: 'Sweet 16. No second chances.',
        qf:  'Quarterfinals. Glory or grief.',
        sf:  'One step from the Final.',
        '3p': 'Last shot at silver lining.',
        final: 'The trophy is on the line.',
    };
    const ROUND_ICONS = {
        r32: '⚔️', r16: '⚔️', qf: '🔥', sf: '🏆', '3p': '🥉', final: '🏆',
    };

    let countdownTimer = null;

    function updateCountdown(target) {
        const now = Date.now();
        const diff = Math.max(0, target - now);
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / (1000 * 60)) % 60);
        document.getElementById('wc_ko_cd_d').textContent = d;
        document.getElementById('wc_ko_cd_h').textContent = String(h).padStart(2, '0');
        document.getElementById('wc_ko_cd_m').textContent = String(m).padStart(2, '0');
    }

    function setLive(roundLabel, hypeText) {
        el.classList.add('live');
        document.getElementById('wc_ko_banner_eyebrow').textContent = '● LIVE NOW';
        document.getElementById('wc_ko_banner_title').textContent = roundLabel;
        document.getElementById('wc_ko_banner_sub').textContent = hypeText;
        document.getElementById('wc_ko_banner_cd').style.display = 'none';
        document.getElementById('wc_ko_banner_cta').textContent = 'WATCH BRACKET →';
    }

    function setUpcoming(roundKey, target, homeTeam, awayTeam) {
        el.classList.remove('live');
        document.getElementById('wc_ko_banner_eyebrow').textContent = 'KNOCKOUT STAGE';
        document.getElementById('wc_ko_banner_icon').textContent = ROUND_ICONS[roundKey] || '⚔️';
        const teamsHtml = (homeTeam && awayTeam)
            ? `<span class="accent">${homeTeam}</span> vs <span class="accent">${awayTeam}</span>`
            : ROUND_LABELS[roundKey];
        document.getElementById('wc_ko_banner_title').innerHTML = teamsHtml;
        document.getElementById('wc_ko_banner_sub').textContent =
            (ROUND_LABELS[roundKey] || 'Next knockout') + ' · ' + (ROUND_HYPE[roundKey] || '');
        document.getElementById('wc_ko_banner_cd').style.display = 'flex';
        document.getElementById('wc_ko_banner_cta').textContent = 'SEE BRACKET →';
        if (countdownTimer) clearInterval(countdownTimer);
        updateCountdown(target);
        countdownTimer = setInterval(() => updateCountdown(target), 30 * 1000);
    }

    function setClosed(championTeam) {
        el.style.display = 'grid';
        el.classList.remove('live');
        document.getElementById('wc_ko_banner_icon').textContent = '🏆';
        document.getElementById('wc_ko_banner_eyebrow').textContent = 'CHAMPIONS OF 26';
        document.getElementById('wc_ko_banner_title').innerHTML = `<span class="accent">${championTeam}</span>`;
        document.getElementById('wc_ko_banner_sub').textContent = 'Crowned by 48 nations of struggle.';
        document.getElementById('wc_ko_banner_cd').style.display = 'none';
        document.getElementById('wc_ko_banner_cta').textContent = 'RELIVE THE RUN →';
    }

    async function load() {
        let data;
        try {
            data = await fetch('/api/bracket').then(r => r.json());
        } catch (e) { return; }
        const rounds = data.rounds || {};
        const order = ['r32', 'r16', 'qf', 'sf', '3p', 'final'];
        const now = Date.now();

        // 1. Is anything live right now?
        for (const stage of order) {
            for (const m of (rounds[stage] || [])) {
                if (m.status === 'live') {
                    el.style.display = 'grid';
                    document.getElementById('wc_ko_banner_icon').textContent = ROUND_ICONS[stage] || '⚔️';
                    setLive(`${m.home} vs ${m.away}`, ROUND_LABELS[stage] + ' · ' + (ROUND_HYPE[stage] || ''));
                    return;
                }
            }
        }

        // 2. Has the tournament ended? Show champion if final is FT
        const finalMatch = (rounds.final || [])[0];
        if (finalMatch && finalMatch.status === 'ft' && finalMatch.score) {
            const sc = finalMatch.score;
            const champ = sc.home_score > sc.away_score ? finalMatch.home
                       : sc.away_score > sc.home_score ? finalMatch.away : null;
            if (champ) { setClosed(champ); return; }
        }

        // 3. Find the nearest upcoming knockout match
        let nextMatch = null;
        let nextStage = null;
        let nextTime = Infinity;
        for (const stage of order) {
            for (const m of (rounds[stage] || [])) {
                if (m.status !== 'upcoming') continue;
                if (!m.kickoff_utc) continue;
                const t = new Date(m.kickoff_utc).getTime();
                if (t > now && t < nextTime) {
                    nextTime = t; nextMatch = m; nextStage = stage;
                }
            }
        }
        if (nextMatch && nextStage) {
            el.style.display = 'grid';
            // Hide team names if they're still placeholders
            const showTeams = !nextMatch.placeholder;
            setUpcoming(nextStage, nextTime,
                showTeams ? nextMatch.home : null,
                showTeams ? nextMatch.away : null);
        }
        // Otherwise stay hidden (knockouts haven't been set up yet)
    }

    load();
    setInterval(load, 90 * 1000);
})();
