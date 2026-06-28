// Minimal 2-letter country code map for ticker flag emojis.
// Falls back to first 3 letters of the name if not listed.
const COUNTRY_CODES = {
    'Argentina':'AR','Australia':'AU','Austria':'AT','Algeria':'DZ','Belgium':'BE',
    'Bosnia and Herzegovina':'BA','Brazil':'BR','Canada':'CA','Cape Verde':'CV',
    'Colombia':'CO','Croatia':'HR','Curaçao':'CW','Czech Republic':'CZ',
    'DR Congo':'CD','Ecuador':'EC','Egypt':'EG','France':'FR',
    'Germany':'DE','Ghana':'GH','Haiti':'HT','Iran':'IR','Iraq':'IQ',
    'Italy':'IT','Ivory Coast':'CI','Japan':'JP','Jordan':'JO','Mexico':'MX',
    'Morocco':'MA','Netherlands':'NL','New Zealand':'NZ','Norway':'NO',
    'Panama':'PA','Paraguay':'PY','Portugal':'PT','Qatar':'QA',
    'Saudi Arabia':'SA','Senegal':'SN','South Africa':'ZA',
    'South Korea':'KR','Spain':'ES','Sweden':'SE','Switzerland':'CH',
    'Tunisia':'TN','Turkey':'TR','United States':'US','Uruguay':'UY',
    'Uzbekistan':'UZ',
};

// UK home nations need the special subdivision-flag sequence
// (black-flag base + tag characters + cancel tag). The Union Jack would
// be wrong: at the World Cup these are separate footballing nations.
const SUBDIVISION_FLAGS = {
    'England':  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'Scotland': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
    'Wales':    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
};

function flagEmoji(country) {
    if (SUBDIVISION_FLAGS[country]) return SUBDIVISION_FLAGS[country];
    const code = COUNTRY_CODES[country];
    if (!code) return '';
    return code.split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

// Official FIFA three-letter country codes. These are what appear on the
// scoreboard, kit numbers, and bracket graphics during the tournament —
// they differ from ISO-2/IOC codes in several places (e.g. NED not NET).
const FIFA_CODES = {
    'Algeria':                'ALG',
    'Argentina':              'ARG',
    'Australia':              'AUS',
    'Austria':                'AUT',
    'Belgium':                'BEL',
    'Bosnia and Herzegovina': 'BIH',
    'Brazil':                 'BRA',
    'Canada':                 'CAN',
    'Cape Verde':             'CPV',
    'Colombia':               'COL',
    'Croatia':                'CRO',
    'Curaçao':                'CUW',
    'Czech Republic':         'CZE',
    'DR Congo':               'COD',
    'Ecuador':                'ECU',
    'Egypt':                  'EGY',
    'England':                'ENG',
    'France':                 'FRA',
    'Germany':                'GER',
    'Ghana':                  'GHA',
    'Haiti':                  'HAI',
    'Iran':                   'IRN',
    'Iraq':                   'IRQ',
    'Italy':                  'ITA',
    'Ivory Coast':            'CIV',
    'Japan':                  'JPN',
    'Jordan':                 'JOR',
    'Mexico':                 'MEX',
    'Morocco':                'MAR',
    'Netherlands':            'NED',
    'New Zealand':            'NZL',
    'Norway':                 'NOR',
    'Panama':                 'PAN',
    'Paraguay':               'PAR',
    'Portugal':               'POR',
    'Qatar':                  'QAT',
    'Saudi Arabia':           'KSA',
    'Scotland':               'SCO',
    'Senegal':                'SEN',
    'South Africa':           'RSA',
    'South Korea':            'KOR',
    'Spain':                  'ESP',
    'Sweden':                 'SWE',
    'Switzerland':            'SUI',
    'Tunisia':                'TUN',
    'Turkey':                 'TUR',
    'United States':          'USA',
    'Uruguay':                'URU',
    'Uzbekistan':             'UZB',
    'Wales':                  'WAL',
};

function shortCountry(c) {
    return FIFA_CODES[c] || c.slice(0, 3).toUpperCase();
}

// Expose the FIFA code map so other small scripts (movers.js, fixtures.js)
// can reuse it without duplicating the table.
window.WC_FIFA_CODES = FIFA_CODES;
window.WC_FLAG_EMOJI = flagEmoji;

function dayLabel(dateIso, kickoffUtc) {
    try {
        const d = kickoffUtc ? new Date(kickoffUtc) : new Date(dateIso + 'T12:00:00Z');
        const now = new Date();
        const diffDays = Math.floor((d - now) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) return 'TODAY';
        if (diffDays === 1) return 'TMRW';
        const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        return wd;
    } catch { return ''; }
}

// Returns the kickoff time in the viewer's local timezone, e.g. "3:00 PM".
// Falls back to the stadium-local fx.time string if kickoff_utc is missing.
function localTime(fx) {
    if (!fx.kickoff_utc) return fx.time || '';
    try {
        return new Date(fx.kickoff_utc).toLocaleTimeString(undefined, {
            hour: 'numeric', minute: '2-digit',
        });
    } catch { return fx.time || ''; }
}

function pillHtmlFor(fx) {
    const status = fx.status || 'upcoming';
    const day = dayLabel(fx.date, fx.kickoff_utc);
    const time = localTime(fx);
    const score = fx.score;

    // Center-of-pill content depends on status:
    //   live + score present → "1 - 0" with pulsing LIVE dot + minute
    //   ft   + score present → "1 - 0" with FT label
    //   else                 → "vs" + scheduled kickoff time
    let centerHtml = `<span class="wc-ticker-vs">vs</span>`;
    let dayHtml = `<span class="wc-ticker-day">${day}</span>`;
    let trailingHtml = `<span class="wc-ticker-time">${time}</span>`;

    if (status === 'live') {
        const minute = (score && score.minute) ? score.minute : 'LIVE';
        dayHtml = `<span class="wc-ticker-day wc-ticker-live"><span class="dot"></span>${minute}</span>`;
        if (score && score.home_score !== null && score.home_score !== undefined) {
            centerHtml = `<span class="wc-ticker-score">${score.home_score} <span class="dash">-</span> ${score.away_score}</span>`;
        }
        trailingHtml = '';
    } else if (status === 'ft') {
        dayHtml = `<span class="wc-ticker-day wc-ticker-ft">FT</span>`;
        if (score && score.home_score !== null && score.home_score !== undefined) {
            centerHtml = `<span class="wc-ticker-score">${score.home_score} <span class="dash">-</span> ${score.away_score}</span>`;
        }
        trailingHtml = '';
    }

    return `
        <a class="wc-ticker-pill" data-id="${fx.id}" data-status="${status}" href="/rank?match=${encodeURIComponent(fx.id)}">
            ${dayHtml}
            <span class="wc-ticker-flag">${flagEmoji(fx.home)}</span>
            <span class="wc-ticker-team">${shortCountry(fx.home)}</span>
            ${centerHtml}
            <span class="wc-ticker-team">${shortCountry(fx.away)}</span>
            <span class="wc-ticker-flag">${flagEmoji(fx.away)}</span>
            ${trailingHtml}
            <span class="wc-ticker-cta">RATE</span>
        </a>`;
}

async function loadTicker() {
    const track = document.getElementById('wc_ticker_track');
    if (!track) return;
    let fixtures;
    try {
        fixtures = await fetch('/api/fixtures?limit=30').then(r => r.json());
    } catch {
        track.innerHTML = '<span class="wc-ticker-loading">Fixtures unavailable</span>';
        return;
    }
    if (!fixtures || fixtures.length === 0) {
        track.innerHTML = '<span class="wc-ticker-loading">No upcoming fixtures</span>';
        return;
    }

    const pillHtml = fixtures.map(pillHtmlFor).join('');

    // Duplicate the pill list once so the marquee can loop without a visible
    // gap when the first copy scrolls off-screen.
    track.innerHTML = pillHtml + pillHtml;
}

// Re-fetch fixtures (with fresh status + scores) every minute so live scores
// update in place without a page reload.
loadTicker();
setInterval(loadTicker, 60_000);
