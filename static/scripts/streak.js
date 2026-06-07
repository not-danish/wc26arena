(function () {
    // Total votes the user has cast in this browser. Persisted in
    // localStorage so the count survives page navigation.
    const KEY = 'wc26_votes_cast';
    const MILESTONES = new Set([1, 10, 25, 50, 100, 250, 500, 1000]);

    function ensureBubble() {
        let bubble = document.getElementById('wc_streak');
        if (bubble) return bubble;
        bubble = document.createElement('div');
        bubble.id = 'wc_streak';
        bubble.className = 'wc-streak hidden';
        bubble.innerHTML = '<span>Votes</span> <span class="count">0</span>';
        document.body.appendChild(bubble);
        return bubble;
    }

    function render(n) {
        const bubble = ensureBubble();
        bubble.classList.toggle('hidden', n <= 0);
        bubble.querySelector('.count').textContent = n;
    }

    function confettiBurst() {
        const colors = ['#C9A227', '#E8C547', '#E31B23', '#006847', '#002868', '#FFFFFF'];
        const N = 60;
        for (let i = 0; i < N; i++) {
            const piece = document.createElement('div');
            piece.className = 'wc-confetti-piece';
            piece.style.left = (Math.random() * 100) + 'vw';
            piece.style.top = '-20px';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.transform = `rotate(${Math.random() * 360}deg)`;
            piece.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
            piece.style.animationDelay = (Math.random() * 0.2) + 's';
            document.body.appendChild(piece);
            setTimeout(() => piece.remove(), 2000);
        }
    }

    function record() {
        const next = (parseInt(localStorage.getItem(KEY) || '0', 10) || 0) + 1;
        localStorage.setItem(KEY, String(next));
        render(next);
        const bubble = document.getElementById('wc_streak');
        if (bubble) {
            bubble.classList.add('celebrate');
            setTimeout(() => bubble.classList.remove('celebrate'), 700);
        }
        if (MILESTONES.has(next)) confettiBurst();
        return next;
    }

    // Expose globally so updateFirebase.js can call it after every successful vote.
    window.WCStreak = { record, render, get: () => parseInt(localStorage.getItem(KEY) || '0', 10) };

    // Show the existing total on every page load.
    document.addEventListener('DOMContentLoaded', () => render(window.WCStreak.get()));
})();
