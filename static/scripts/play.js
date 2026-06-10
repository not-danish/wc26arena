(function () {
    const SILHOUETTE = 'https://cdn.sofifa.net/player_0.svg';
    const BEST_KEY = 'wc26_play_best_today';
    const BEST_DATE_KEY = 'wc26_play_best_date';

    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function todayKey() {
        const d = new Date();
        return d.toISOString().slice(0, 10);
    }

    function getBestToday() {
        const date = localStorage.getItem(BEST_DATE_KEY);
        if (date !== todayKey()) return 0;
        return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    }

    function saveBestToday(streak) {
        localStorage.setItem(BEST_KEY, String(streak));
        localStorage.setItem(BEST_DATE_KEY, todayKey());
    }

    // ---------- Game state ----------
    let anchor = null;     // {id, ELO, player_name, image_url, ...}
    let mystery = null;    // same shape
    let streak = 0;
    let busy = false;
    let currentTab = 'today';   // 'today' | 'week' | 'all'
    let lastSeenDay = todayKey(); // for periodic day-rollover detection

    // ---------- DOM helpers ----------
    const $streak = () => document.getElementById('wc_play_streak');
    const $best   = () => document.getElementById('wc_play_best');
    const $board  = () => document.getElementById('wc_play_board');

    function updateHud() {
        $streak().textContent = streak;
        $best().textContent = Math.max(getBestToday(), streak);
    }

    // ---------- Server I/O ----------
    async function fetchPair() {
        // Reuse the matchmaker. Skip pairs where ELOs are identical
        // (game would be a coin-flip), retry a couple of times.
        for (let tries = 0; tries < 4; tries++) {
            try {
                const data = await fetch('/api/next_pair').then(r => r.json());
                if (data?.a && data?.b) {
                    const aRec = { id: data.a[0], ...data.a[1] };
                    const bRec = { id: data.b[0], ...data.b[1] };
                    if (aRec.ELO !== bRec.ELO) return [aRec, bRec];
                }
            } catch {}
        }
        // Fall back: even with equal ELOs, the game can still run
        const data = await fetch('/api/next_pair').then(r => r.json());
        return [{ id: data.a[0], ...data.a[1] }, { id: data.b[0], ...data.b[1] }];
    }

    async function loadTopStreaks() {
        const TAB_TO_URL = {
            today: '/api/streaks/today',
            week:  '/api/streaks/week',
            all:   '/api/streaks/all_time',
        };
        const TAB_TO_EMPTY = {
            today: 'No streaks yet today. Be the first.',
            week:  'No streaks recorded this week yet.',
            all:   'No streaks recorded yet.',
        };
        const url = TAB_TO_URL[currentTab] || TAB_TO_URL.today;
        try {
            const rows = await fetch(`${url}?limit=10`).then(r => r.json());
            const ol = document.getElementById('wc_play_top');
            if (!rows.length) {
                ol.innerHTML = `<li class="muted">${TAB_TO_EMPTY[currentTab]}</li>`;
                return;
            }
            ol.innerHTML = rows.map(r => `
                <li>
                    <span class="name">${esc(r.name)}</span>
                    <span class="streak">${r.streak}</span>
                </li>
            `).join('');
        } catch {}
    }

    async function submitStreak(name, value) {
        try {
            await fetch('/api/streaks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, streak: value }),
            });
        } catch {}
    }

    // ---------- Rendering ----------
    function playerCardHtml(rec, opts = {}) {
        const reveal = opts.reveal !== false; // anchor always reveals
        const ring = opts.accent ? `style="--wc-card-accent:${opts.accent}"` : '';
        return `
            <div class="wc-play-card ${opts.side || ''}" ${ring}>
                <div class="wc-play-photo">
                    <img src="${esc(rec.image_url || SILHOUETTE)}" onerror="this.src='${SILHOUETTE}'" alt="">
                </div>
                <div class="wc-play-name">${esc(rec.player_name)}</div>
                <div class="wc-play-meta">${esc(rec.country || '')} · ${esc(rec.position || '')}</div>
                <div class="wc-play-elo">
                    <span class="label">ELO</span>
                    <span class="value" data-elo>${reveal ? Math.round(rec.ELO) : '?'}</span>
                </div>
            </div>`;
    }

    function chooserHtml() {
        return `
            <div class="wc-play-chooser">
                <button class="wc-play-btn higher" data-pick="higher">▲ HIGHER</button>
                <button class="wc-play-btn lower"  data-pick="lower">▼ LOWER</button>
            </div>`;
    }

    function render() {
        $board().innerHTML = `
            <div class="wc-play-grid">
                ${playerCardHtml(anchor, { side: 'anchor' })}
                <div class="wc-play-vs">
                    <span>vs</span>
                    ${chooserHtml()}
                </div>
                ${playerCardHtml(mystery, { side: 'mystery', reveal: false })}
            </div>`;

        $board().querySelectorAll('[data-pick]').forEach(btn => {
            btn.addEventListener('click', () => onPick(btn.dataset.pick));
        });
    }

    // ---------- Reveal animation ----------
    function animateNumber(el, target, ms = 700) {
        const start = parseInt(el.textContent, 10) || 0;
        if (Number.isNaN(start) || start === target) {
            el.textContent = target;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const t0 = performance.now();
            const step = (now) => {
                const p = Math.min(1, (now - t0) / ms);
                const eased = 1 - Math.pow(1 - p, 3);
                el.textContent = Math.round(start + (target - start) * eased);
                if (p < 1) requestAnimationFrame(step);
                else resolve();
            };
            requestAnimationFrame(step);
        });
    }

    async function onPick(choice) {
        if (busy) return;
        busy = true;

        const correct = (choice === 'higher')
            ? (mystery.ELO > anchor.ELO)
            : (mystery.ELO < anchor.ELO);

        const mysteryCard = $board().querySelector('.wc-play-card.mystery');
        const eloEl = mysteryCard.querySelector('[data-elo]');
        eloEl.textContent = '0';

        // Mark which button was picked + correctness for color feedback
        const buttons = $board().querySelectorAll('[data-pick]');
        buttons.forEach(b => b.classList.add('locked'));
        const pickedBtn = $board().querySelector(`[data-pick="${choice}"]`);
        pickedBtn.classList.add(correct ? 'correct' : 'wrong');

        await animateNumber(eloEl, Math.round(mystery.ELO));
        mysteryCard.classList.add(correct ? 'correct' : 'wrong');

        if (correct) {
            streak += 1;
            updateHud();
            // Pause briefly so the user sees the reveal, then advance
            await new Promise(r => setTimeout(r, 700));
            await advance();
        } else {
            await endGame();
        }
        busy = false;
    }

    async function advance() {
        // The mystery becomes the next anchor; we fetch a fresh mystery.
        const [, freshB] = await fetchPair();
        // If matchmaker happens to return the same person, fetch again.
        let mysteryNext = freshB;
        let attempts = 0;
        while (mysteryNext.id === mystery.id && attempts < 3) {
            const [, b2] = await fetchPair();
            mysteryNext = b2;
            attempts++;
        }
        anchor = mystery;
        mystery = mysteryNext;
        render();
    }

    async function endGame() {
        const finalStreak = streak;
        const best = getBestToday();
        const isPersonalBest = finalStreak > best;
        if (isPersonalBest) saveBestToday(finalStreak);
        updateHud();

        $board().innerHTML = `
            <div class="wc-play-end animate__animated animate__fadeIn">
                <div class="wc-play-end-header">${finalStreak === 0 ? 'No streak this time.' : 'Game over.'}</div>
                <div class="wc-play-end-streak">${finalStreak}</div>
                <div class="wc-play-end-label">${finalStreak === 1 ? 'correct guess' : 'correct guesses in a row'}</div>
                ${isPersonalBest && finalStreak > 0
                    ? '<div class="wc-play-end-pb">New personal best today 🥇</div>' : ''}
                ${finalStreak > 0 ? `
                    <form class="wc-play-end-form" id="wc_play_submit">
                        <input name="name" type="text" placeholder="Your name (for the daily board)"
                               maxlength="24" autocomplete="off" required>
                        <button type="submit">Submit</button>
                    </form>
                    <div class="wc-play-end-skip" id="wc_play_skip_submit">Skip and play again →</div>
                ` : ''}
                <button class="wc-play-end-restart" id="wc_play_restart">Play again</button>
            </div>`;

        const form = document.getElementById('wc_play_submit');
        const skip = document.getElementById('wc_play_skip_submit');
        const restart = document.getElementById('wc_play_restart');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = form.elements.name.value.trim();
                if (!name) return;
                form.querySelector('button').disabled = true;
                await submitStreak(name, finalStreak);
                await loadTopStreaks();
                form.replaceWith(Object.assign(document.createElement('div'),
                    { className: 'wc-play-end-pb', textContent: 'Submitted to the daily board.' }));
            });
        }
        if (skip) {
            skip.addEventListener('click', () => start());
        }
        restart.addEventListener('click', () => start());
    }

    async function start() {
        streak = 0;
        updateHud();
        $board().innerHTML = '<div class="wc-loading">Loading matchup…</div>';
        const [a, b] = await fetchPair();
        anchor = a;
        mystery = b;
        render();
    }

    // ---------- Tab switching ----------
    document.querySelectorAll('.wc-play-tabs button').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            document.querySelectorAll('.wc-play-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.dataset.tab;
            loadTopStreaks();
        });
    });

    // ---------- Day rollover + auto-refresh ----------
    // The HUD's "Best today" stays stale if the tab is left open across UTC
    // midnight, because updateHud() only runs on user input. Periodically
    // detect the rollover and reset the displayed value.
    function checkDayRollover() {
        const today = todayKey();
        if (today !== lastSeenDay) {
            lastSeenDay = today;
            updateHud();
            if (currentTab === 'today') loadTopStreaks();
        }
    }
    setInterval(checkDayRollover, 60_000);

    // When the user comes back to the tab, recheck immediately and refresh
    // the visible leaderboard (might have moved while they were away).
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            checkDayRollover();
            loadTopStreaks();
        }
    });
    window.addEventListener('focus', () => {
        checkDayRollover();
        loadTopStreaks();
    });

    // Periodic leaderboard poll so live submissions from other players show up
    // without requiring a tab focus event.
    setInterval(loadTopStreaks, 60_000);

    // ---------- Init ----------
    updateHud();
    loadTopStreaks();
    start();
})();
