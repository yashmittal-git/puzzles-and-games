import { FilesetResolver, PoseLandmarker } from './vision_bundle.mjs';

const TARGETS = [5, 10, 15, 20];
let target = 10;
let phase = 'setup'; // setup | loading | playing | won
let reps = 0;
let landmarker = null;
let stream = null;
let camState = 'pending'; // pending | on | unavailable
let wakeLock = null;

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('stage');
const ctx2d = canvas.getContext('2d');

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

// ---------- rep counter: dual-signal (side-on elbow angle OR front-on shoulder height) ----------
const counter = {
    lastRepAt: -1e9, plankSince: null, lastSampleAt: null, lastPickAt: 0, dominant: 'elbow',
    elbow: { ema: null, hi: null, lo: null, state: 'UP' },       // side-on: elbow angle, extended = high
    shoulder: { ema: null, hi: null, lo: null, state: 'UP' },    // front-on: shoulder height, lowered body = high y
    angle(ax, ay, bx, by, cx, cy) {
        const bax = ax - bx, bay = ay - by, bcx = cx - bx, bcy = cy - by;
        const cos = (bax * bcx + bay * bcy) / ((Math.hypot(bax, bay) * Math.hypot(bcx, bcy)) + 1e-9);
        return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    },
    track(sig, value, dt, drift) {
        sig.ema = sig.ema === null ? value : sig.ema * 0.5 + value * 0.5;
        sig.hi = sig.hi === null ? sig.ema : Math.max(sig.ema, sig.hi - drift * dt);
        sig.lo = sig.lo === null ? sig.ema : Math.min(sig.ema, sig.lo + drift * dt);
    },
    sample(lm, now) {
        const vis = (lm[11].visibility + lm[12].visibility + lm[13].visibility + lm[14].visibility +
                     lm[15].visibility + lm[16].visibility) / 6;
        if (vis < 0.5) { this.plankSince = null; return false; }
        if (this.plankSince === null) this.plankSince = now;
        const dt = this.lastSampleAt === null ? 0.033 : Math.min(0.2, (now - this.lastSampleAt) / 1000);
        this.lastSampleAt = now;

        const el = (this.angle(lm[11].x, lm[11].y, lm[13].x, lm[13].y, lm[15].x, lm[15].y) +
                    this.angle(lm[12].x, lm[12].y, lm[14].x, lm[14].y, lm[16].x, lm[16].y)) / 2;
        const e = this.elbow, s = this.shoulder;
        this.track(e, el, dt, 30);                       // extremes drift 30 deg/s
        this.track(s, (lm[11].y + lm[12].y) / 2, dt, 0.05); // extremes drift 0.05 frame/s

        if (now - this.plankSince < 400) return false;

        // one dominant signal counts; the other is tracked but cannot fire (prevents double counts)
        if (now - this.lastPickAt > 500) {
            this.lastPickAt = now;
            this.dominant = (e.hi - e.lo) / 40 >= (s.hi - s.lo) / 0.06 ? 'elbow' : 'shoulder';
        }

        let rep = false;
        if (e.state === 'UP' && e.ema < e.hi - 40) e.state = 'DOWN';
        else if (e.state === 'DOWN' && e.ema > e.hi - 12) { e.state = 'UP'; if (this.dominant === 'elbow') rep = true; }
        if (s.state === 'UP' && s.ema > s.lo + 0.06) s.state = 'DOWN';
        else if (s.state === 'DOWN' && s.ema < s.lo + 0.025) { s.state = 'UP'; if (this.dominant === 'shoulder') rep = true; }

        if (rep && now - this.lastRepAt > 600) { this.lastRepAt = now; return true; }
        return false;
    },
    debug() {
        const e = this.elbow, s = this.shoulder;
        return this.dominant + ' | elbow ' + (e.ema === null ? '-' : Math.round(e.ema) + '\u00b0') + ' ' + e.state +
               ' | shoulderY ' + (s.ema === null ? '-' : s.ema.toFixed(3)) + ' ' + s.state;
    },
    reset() {
        this.lastRepAt = -1e9; this.plankSince = null; this.lastSampleAt = null; this.lastPickAt = 0; this.dominant = 'elbow';
        this.elbow = { ema: null, hi: null, lo: null, state: 'UP' };
        this.shoulder = { ema: null, hi: null, lo: null, state: 'UP' };
    }
};

// ---------- flappy game ----------
const game = { birdY: 150, birdV: 0, pipes: [], lastPipe: 0 };
function flap() { game.birdV = -5.2; }

function drawStage(now, poseLm) {
    const W = canvas.width, H = canvas.height;
    game.birdV += 0.32; game.birdY += game.birdV;
    if (game.birdY > H - 20) { game.birdY = H - 20; game.birdV = -3; }
    if (game.birdY < 10) { game.birdY = 10; game.birdV = 0; }
    if (now - game.lastPipe > 2600) { game.lastPipe = now; game.pipes.push({ x: W + 20, gapY: 60 + Math.random() * (H - 160) }); }
    game.pipes.forEach(p => p.x -= 1.6);
    game.pipes = game.pipes.filter(p => p.x > -60);

    ctx2d.clearRect(0, 0, W, H);
    const gapH = 110;
    ctx2d.fillStyle = '#2f9e44';
    game.pipes.forEach(p => {
        ctx2d.fillRect(p.x, 0, 34, p.gapY - gapH / 2);
        ctx2d.fillRect(p.x, p.gapY + gapH / 2, 34, H);
        ctx2d.fillRect(p.x - 4, p.gapY - gapH / 2 - 14, 42, 14);
        ctx2d.fillRect(p.x - 4, p.gapY + gapH / 2, 42, 14);
    });
    ctx2d.save();
    ctx2d.translate(56, game.birdY);
    ctx2d.rotate(Math.max(-0.4, Math.min(0.7, game.birdV * 0.08)));
    ctx2d.fillStyle = '#ffde59'; ctx2d.fillRect(-10, -8, 20, 16);
    ctx2d.fillStyle = '#f4a63b'; ctx2d.fillRect(-14, -4, 8, 8);
    ctx2d.fillStyle = '#251f21'; ctx2d.fillRect(4, -5, 3, 3);
    ctx2d.fillStyle = '#ed5b2d'; ctx2d.fillRect(10, -2, 6, 4);
    ctx2d.restore();

    // pose skeleton hint (shows the camera sees you)
    if (poseLm) {
        ctx2d.fillStyle = 'rgba(115,168,154,0.9)';
        [11, 12, 13, 14, 15, 16, 23, 24].forEach(i => {
            ctx2d.beginPath();
            ctx2d.arc(poseLm[i].x * W, poseLm[i].y * H, 4, 0, 7);
            ctx2d.fill();
        });
    }
}

// ---------- main loop ----------
let raf = 0;
function loop(now) {
    if (phase !== 'playing') return;
    let poseLm = null;
    if (camState === 'on' && landmarker && video.readyState >= 2) {
        try {
            const res = landmarker.detectForVideo(video, now);
            poseLm = res.landmarks && res.landmarks[0];
            if (poseLm && counter.sample(poseLm, now)) countRep();
        } catch (e) { /* skip frame */ }
    }
    drawStage(now, poseLm);
    const dbg = $('debug');
    if (dbg && now - (loop.lastDbg || 0) > 200) { loop.lastDbg = now; dbg.textContent = counter.debug(); }
    raf = requestAnimationFrame(loop);
}

function countRep() {
    reps += 1;
    $('repcount').textContent = reps + ' / ' + target + ' push-ups';
    flap();
    if (reps >= target) {
        stopBuzzer();
        phase = 'won';
        cancelAnimationFrame(raf);
        $('winbanner').style.display = 'flex';
        $('tapbtn').style.display = 'none';
        $('stopbtn').style.display = 'none';
        $('againbtn').style.display = '';
        $('phaseLabel').textContent = 'Alarm off';
    }
}

// ---------- flow ----------
async function start() {
    reps = 0; counter.reset();
    game.pipes = []; game.lastPipe = 0; game.birdY = 150; game.birdV = 0;
    $('repcount').textContent = '0 / ' + target + ' push-ups';
    $('winbanner').style.display = 'none';
    $('tapbtn').style.display = '';
    $('stopbtn').style.display = '';
    $('againbtn').style.display = 'none';
    $('phaseLabel').textContent = 'Alarm ringing';
    $('setupView').style.display = 'none';
    $('playView').style.display = '';
    phase = 'playing';
    startBuzzer();
    if (navigator.wakeLock) { navigator.wakeLock.request('screen').then(w => wakeLock = w).catch(() => {}); }

    camState = 'pending';
    let modelReady = !!landmarker, modelFailed = false;
    const renderNote = () => {
        const cam = camState === 'on' ? 'Camera on.' : camState === 'unavailable' ? 'Camera not available or blocked, so the tap button counts reps.' : 'Starting camera\u2026';
        const model = modelReady ? ' Pose model ready - counting on, side or front view.' :
                      modelFailed ? ' Pose model failed to load; tap button counts reps.' : ' Loading pose model\u2026';
        $('camnote').textContent = camState === 'unavailable' ? cam : cam + model;
    };
    renderNote();

    if (!landmarker) {
        (async () => {
            try {
                const files = await FilesetResolver.forVisionTasks('./wasm');
                landmarker = await PoseLandmarker.createFromOptions(files, {
                    baseOptions: { modelAssetPath: './pose_landmarker_lite.task' },
                    runningMode: 'VIDEO', numPoses: 1,
                    minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5
                });
                modelReady = true;
            } catch (e) { modelFailed = true; }
            if (phase === 'playing') renderNote();
        })();
    }
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
        camState = 'on';
    } catch (e) { camState = 'unavailable'; }
    if (phase === 'playing') renderNote();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
}

function stopAll() {
    stopBuzzer();
    phase = 'setup';
    cancelAnimationFrame(raf);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $('setupView').style.display = '';
    $('playView').style.display = 'none';
}

$('startbtn').addEventListener('click', start);
$('againbtn').addEventListener('click', start);
$('stopbtn').addEventListener('click', stopAll);
$('tapbtn').addEventListener('click', countRep);
document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        target = parseInt(btn.dataset.n, 10);
    });
});
