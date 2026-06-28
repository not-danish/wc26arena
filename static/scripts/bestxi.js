(function () {
const FIFA_CODES = {
    'Algeria':'ALG','Argentina':'ARG','Australia':'AUS','Austria':'AUT','Belgium':'BEL',
    'Bosnia and Herzegovina':'BIH','Brazil':'BRA','Canada':'CAN','Cape Verde':'CPV',
    'Colombia':'COL','Croatia':'CRO','Curaçao':'CUW','Czech Republic':'CZE',
    'DR Congo':'COD','Ecuador':'ECU','Egypt':'EGY','England':'ENG','France':'FRA',
    'Germany':'GER','Ghana':'GHA','Haiti':'HAI','Iran':'IRN','Iraq':'IRQ',
    'Italy':'ITA','Ivory Coast':'CIV','Japan':'JPN','Jordan':'JOR','Mexico':'MEX',
    'Morocco':'MAR','Netherlands':'NED','New Zealand':'NZL','Norway':'NOR',
    'Panama':'PAN','Paraguay':'PAR','Portugal':'POR','Qatar':'QAT','Saudi Arabia':'KSA',
    'Scotland':'SCO','Senegal':'SEN','South Africa':'RSA','South Korea':'KOR',
    'Spain':'ESP','Sweden':'SWE','Switzerland':'SUI','Tunisia':'TUN','Turkey':'TUR',
    'United States':'USA','Uruguay':'URU','Uzbekistan':'UZB','Wales':'WAL',
};
const ISO2 = {
    'Argentina':'AR','Australia':'AU','Austria':'AT','Algeria':'DZ','Belgium':'BE',
    'Bosnia and Herzegovina':'BA','Brazil':'BR','Canada':'CA','Cape Verde':'CV',
    'Colombia':'CO','Croatia':'HR','Curaçao':'CW','Czech Republic':'CZ',
    'DR Congo':'CD','Ecuador':'EC','Egypt':'EG','France':'FR','Germany':'DE',
    'Ghana':'GH','Haiti':'HT','Iran':'IR','Iraq':'IQ','Italy':'IT',
    'Ivory Coast':'CI','Japan':'JP','Jordan':'JO','Mexico':'MX','Morocco':'MA',
    'Netherlands':'NL','New Zealand':'NZ','Norway':'NO','Panama':'PA','Paraguay':'PY',
    'Portugal':'PT','Qatar':'QA','Saudi Arabia':'SA','Senegal':'SN','South Africa':'ZA',
    'South Korea':'KR','Spain':'ES','Sweden':'SE','Switzerland':'CH','Tunisia':'TN',
    'Turkey':'TR','United States':'US','Uruguay':'UY','Uzbekistan':'UZ',
};
const SUBDIVISION_FLAGS = {
    'England':  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'Scotland': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
    'Wales':    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
};
function flag(country) {
    if (SUBDIVISION_FLAGS[country]) return SUBDIVISION_FLAGS[country];
    const code = ISO2[country];
    if (!code) return '';
    return code.split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}
function fifaCode(country) {
    return FIFA_CODES[country] || (country || '').slice(0, 3).toUpperCase();
}

const SILHOUETTE = 'https://cdn.sofifa.net/player_0.svg';

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function pitchPlayerHtml(p) {
    const img = p.image_url || SILHOUETTE;
    return `
        <div class="wc-pitch-player">
            <div class="wc-pitch-photo">
                <img src="${esc(img)}" onerror="this.src='${SILHOUETTE}'" alt="">
            </div>
            <div class="wc-pitch-name-tag">
                <span class="name">${esc(p.player_name)}</span>
                <span class="stat">
                    <span class="flag">${flag(p.country)}</span>
                    <span>${fifaCode(p.country)}</span>
                    <span>·</span>
                    <span>${Math.round(p.ELO)}</span>
                </span>
            </div>
        </div>`;
}

function subCardHtml(p, bucket) {
    const img = p.image_url || SILHOUETTE;
    return `
        <div class="wc-sub-card">
            <span class="pos-chip">${bucket}</span>
            <div class="wc-pitch-photo">
                <img src="${esc(img)}" onerror="this.src='${SILHOUETTE}'" alt="">
            </div>
            <span class="name">${esc(p.player_name)}</span>
            <span class="elo">${flag(p.country)} ${fifaCode(p.country)} · ${Math.round(p.ELO)}</span>
        </div>`;
}

let aliveOnly = false;

async function loadBestXi() {
    const pitch = document.getElementById('wc_pitch');
    const subsRow = document.getElementById('wc_subs_row');
    const subtitle = document.getElementById('wc_bestxi_subtitle');

    const loading = document.createElement('div');
    loading.className = 'wc-pitch-loading';
    loading.textContent = 'COMPUTING…';
    pitch.appendChild(loading);

    const url = aliveOnly ? '/api/best_xi?alive=1' : '/api/best_xi';
    let data;
    try {
        data = await fetch(url).then(r => r.json());
    } catch (e) {
        loading.textContent = 'Failed to load.';
        return;
    }
    loading.remove();

    if (subtitle) {
        subtitle.textContent = aliveOnly
            ? 'Best XI of the survivors · only players from teams still alive · 3-4-3'
            : 'Highest-rated lineup right now · 3-4-3 · Refresh to recompute';
    }

    for (const row of pitch.querySelectorAll('.wc-row')) {
        const bucket = row.dataset.bucket;
        const players = (data.starters && data.starters[bucket]) || [];
        row.innerHTML = players.map(pitchPlayerHtml).join('') ||
            '<div class="wc-pitch-empty">No survivors at this position.</div>';
    }

    const subs = data.subs || {};
    const subOrder = ['GK', 'DEF', 'MID', 'FWD'];
    subsRow.innerHTML = subOrder
        .flatMap(b => (subs[b] || []).map(p => subCardHtml(p, b)))
        .join('');
}

document.getElementById('wc_ko_xi_toggle')?.addEventListener('click', (e) => {
    aliveOnly = !aliveOnly;
    e.currentTarget.classList.toggle('active', aliveOnly);
    loadBestXi();
});

loadBestXi();

document.getElementById('wc_share_png')?.addEventListener('click', async () => {
    if (!window.html2canvas) return;
    const target = document.querySelector('.wc-bestxi-page');
    if (!target) return;
    const btn = document.getElementById('wc_share_png');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Rendering…';
    try {
        // CORS-tainted images (TheSportsDB CDN) cause html2canvas to throw
        // unless useCORS is set; even then some images may fail to render.
        const canvas = await html2canvas(target, {
            backgroundColor: '#0A0A0A',
            useCORS: true,
            scale: 2,
            logging: false,
        });
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'wc26arena-best-xi.png';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        alert('Could not generate image. Try a different browser.');
    } finally {
        btn.disabled = false;
        btn.textContent = origText;
    }
});
})();
