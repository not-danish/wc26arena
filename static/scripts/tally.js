// Live total-vote counter in the nav. Polls every 30s and animates the
// number from its current display value to the latest server total.
(function () {
    const POLL_MS = 30_000;
    const ANIM_MS = 700;

    function $count() {
        return document.querySelector('#wc_total_votes .count');
    }

    let current = 0;
    let animating = false;

    function format(n) { return n.toLocaleString(); }

    // Animate the displayed number from `current` to `target`. For small
    // deltas this looks like a quick tick; for big ones (e.g. first load)
    // it counts up smoothly. Easing is intentionally light.
    function animateTo(target) {
        const el = $count();
        if (!el) return;
        if (target === current) return;
        if (animating) {
            // If we're mid-animation, just jump to the latest target.
            current = target;
            el.textContent = format(current);
            return;
        }
        animating = true;
        const start = current;
        const delta = target - start;
        const t0 = performance.now();
        function tick(now) {
            const p = Math.min(1, (now - t0) / ANIM_MS);
            const eased = 1 - Math.pow(1 - p, 3);
            const v = Math.round(start + delta * eased);
            el.textContent = format(v);
            if (p < 1) requestAnimationFrame(tick);
            else {
                current = target;
                animating = false;
                el.classList.add('bump');
                setTimeout(() => el.classList.remove('bump'), 500);
            }
        }
        requestAnimationFrame(tick);
    }

    async function refresh() {
        try {
            const data = await fetch('/api/total_votes').then(r => r.json());
            if (typeof data.total === 'number') animateTo(data.total);
        } catch { /* ignore — try again next poll */ }
    }

    refresh();
    setInterval(refresh, POLL_MS);

    // Refresh immediately after this tab casts a vote so the counter feels
    // responsive instead of waiting up to 30s. updateFirebase.js calls
    // window.WCTally.bump() once /api/update_data returns.
    window.WCTally = {
        bump() {
            animateTo(current + 1);
            // Re-sync against the server shortly after, in case other tabs
            // voted too while we weren't polling.
            setTimeout(refresh, 1500);
        },
    };
})();
