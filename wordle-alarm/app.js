// Daily word selection: our own list, NOT the NYT Wordle answer.
// Day #1 = 3 Nov 2026. The date is computed in Asia/Kolkata (midnight IST rollover),
// so everyone in the group gets the same word on the same day regardless of device timezone.
// Test hook: ?date=YYYY-MM-DD forces a date.

const ROWS = 6, COLS = 5;
const KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const EPOCH_UTC = Date.UTC(2026, 10, 3); // 3 Nov 2026 = daily word #1

const $ = (id) => document.getElementById(id);
let phase = 'setup'; // setup | playing | won
let words = null, answers = null;
let ANSWER = '';
let row = 0, col = 0, grid = [], solved = false, keyState = {};
let wakeLock = null;

function istDateString(d) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d || new Date()); // en-CA yields YYYY-MM-DD
}

function activeDateString() {
    const forced = new URLSearchParams(location.search).get('date');
    if (forced && /^\d{4}-\d{2}-\d{2}$/.test(forced) && !isNaN(Date.parse(forced + 'T00:00:00Z'))) return forced;
    return istDateString();
}

function puzzleFor(dateStr, answerCount) {
    const dayMs = Date.parse(dateStr + 'T00:00:00Z');
    const idx = Math.round((dayMs - EPOCH_UTC) / 86400000);
    return { number: idx + 1, answerIndex: ((idx % answerCount) + answerCount) % answerCount };
}

function prettyDate(dateStr) {
    return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
}

// ---------- buzzer ----------
let audioCtx = null, beepTimer = null;
function startBuzzer() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    let high = true;
    const beep = () => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = high ? 880 : 660;
        gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.28);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
        high = !high;
    };
    beep();
    beepTimer = setInterval(beep, 320);
}
function stopBuzzer() { if (beepTimer) { clearInterval(beepTimer); beepTimer = null; } }

// ---------- board ----------
function buildBoard() {
    const board = $('board');
    board.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'row';
        for (let c = 0; c < COLS; c++) {
            const t = document.createElement('div');
            t.className = 'tile';
            t.id = 't' + r + c;
            rowEl.appendChild(t);
        }
        board.appendChild(rowEl);
    }
}

function buildKeyboard() {
    const kb = $('kb');
    kb.innerHTML = '';
    KB_ROWS.forEach((letters, i) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'kbrow';
        if (i === 2) rowEl.appendChild(makeKey('ENTER', 'wide'));
        for (const ch of letters) rowEl.appendChild(makeKey(ch));
        if (i === 2) rowEl.appendChild(makeKey('DEL', 'wide'));
        kb.appendChild(rowEl);
    });
}
function makeKey(label, cls) {
    const k = document.createElement('button');
    k.className = 'key' + (cls ? ' ' + cls : '');
    k.textContent = label;
    k.dataset.key = label;
    k.addEventListener('click', () => onKey(label));
    return k;
}

function tile(r, c) { return $('t' + r + c); }
function setMsg(m) { $('msg').textContent = m; }

function onKey(label) {
    if (phase !== 'playing' || solved) return;
    if (label === 'DEL' || label === 'BACKSPACE') {
        if (col > 0) { col--; grid[row][col] = ''; const t = tile(row, col); t.textContent = ''; t.classList.remove('filled', 'pop'); }
        return;
    }
    if (label === 'ENTER') { submit(); return; }
    if (/^[A-Z]$/.test(label) && col < COLS) {
        grid[row][col] = label;
        const t = tile(row, col);
        t.textContent = label;
        t.classList.add('filled', 'pop');
        setTimeout(() => t.classList.remove('pop'), 120);
        col++;
    }
}

// Coloring with correct duplicate-letter handling (green first, then yellow from remaining pool).
function grade(guess, answer) {
    const res = Array(COLS).fill('gray');
    const pool = {};
    for (let i = 0; i < COLS; i++) {
        if (guess[i] === answer[i]) res[i] = 'green';
        else pool[answer[i]] = (pool[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < COLS; i++) {
        if (res[i] !== 'green' && pool[guess[i]] > 0) { res[i] = 'yellow'; pool[guess[i]]--; }
    }
    return res;
}

function submit() {
    if (col < COLS) { shakeRow(row); setMsg('Not enough letters'); return; }
    const guess = grid[row].join('');
    if (words && !words.has(guess.toLowerCase())) { shakeRow(row); setMsg('Not in word list'); return; }
    setMsg('');
    const colors = grade(guess, ANSWER);
    colors.forEach((color, i) => {
        const t = tile(row, i);
        setTimeout(() => {
            t.classList.add('flip');
            setTimeout(() => t.classList.add(color), 220);
        }, i * 130);
        // keyboard: never downgrade a key
        const prev = keyState[guess[i]];
        const rank = { gray: 1, yellow: 2, green: 3 };
        if (!prev || rank[colors[i]] > rank[prev]) keyState[guess[i]] = colors[i];
    });
    setTimeout(() => {
        Object.entries(keyState).forEach(([ch, color]) => {
            const k = document.querySelector('.key[data-key="' + ch + '"]');
            if (k) { k.classList.remove('green', 'yellow', 'gray'); k.classList.add(color); }
        });
        if (guess === ANSWER) return win();
        row++; col = 0;
        if (row >= ROWS) {
            setMsg('Out of guesses - alarm keeps ringing. Board resets.');
            setTimeout(resetBoard, 1400);
        }
    }, COLS * 130 + 300);
}

function shakeRow(r) {
    const rowEl = tile(r, 0).parentElement;
    rowEl.classList.add('shake');
    setTimeout(() => rowEl.classList.remove('shake'), 500);
}

function resetBoard() {
    row = 0; col = 0;
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
    buildBoard();
    setMsg('Same word. Try again.');
}

function win() {
    solved = true;
    phase = 'won';
    stopBuzzer();
    $('winbanner').style.display = 'block';
    $('phaseLabel').textContent = 'Alarm off';
    $('stopbtn').style.display = 'none';
    $('againbtn').style.display = '';
    setMsg('Solved in ' + (row + 1) + ' of 6');
}

// ---------- flow ----------
async function start() {
    if (!words || !answers) {
        try {
            const [wRes, aRes] = await Promise.all([fetch('./words.txt'), fetch('./answers.txt')]);
            words = new Set((await wRes.text()).trim().split('\n').map(w => w.trim().toLowerCase()));
            answers = (await aRes.text()).trim().split('\n').map(w => w.trim().toLowerCase());
        } catch (e) {
            setMsg('Word lists failed to load. Check your connection and reload.');
            return;
        }
    }
    const dateStr = activeDateString();
    const p = puzzleFor(dateStr, answers.length);
    ANSWER = answers[p.answerIndex].toUpperCase();
    $('dateLabel').textContent = 'Puzzle date: ' + prettyDate(dateStr) + ' · daily word #' + p.number + ' (midnight IST rollover)';

    row = 0; col = 0; solved = false; keyState = {};
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
    buildBoard();
    buildKeyboard();
    setMsg('');
    $('winbanner').style.display = 'none';
    $('stopbtn').style.display = '';
    $('againbtn').style.display = 'none';
    $('phaseLabel').textContent = 'Alarm ringing - solve the word';
    $('setupView').style.display = 'none';
    $('playView').style.display = '';
    phase = 'playing';
    startBuzzer();
    if (navigator.wakeLock) { navigator.wakeLock.request('screen').then(w => wakeLock = w).catch(() => {}); }
}

function stopAll() {
    stopBuzzer();
    phase = 'setup';
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $('setupView').style.display = '';
    $('playView').style.display = 'none';
}

$('startbtn').addEventListener('click', start);
$('againbtn').addEventListener('click', start);
$('stopbtn').addEventListener('click', stopAll);
document.addEventListener('keydown', (e) => {
    if (phase !== 'playing') return;
    const k = e.key.toUpperCase();
    if (k === 'ENTER' || k === 'BACKSPACE' || /^[A-Z]$/.test(k)) onKey(k);
});
