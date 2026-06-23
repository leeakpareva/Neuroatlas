/**
 * TelemetryManager - Live "report" dashboards drawn on canvases.
 *
 *  1. EEG / ErrP signal trace (spikes during error/stress states)
 *  2. Per-system activity bars (driven by ActivityManager)
 *  3. Neural frequency-band spectrum (delta/theta/alpha/beta/gamma) per scenario
 *  4. NAVADA_9 readouts: ErrP status, classification confidence, feedback latency
 */

// Relative EEG band power per scenario: [delta, theta, alpha, beta, gamma]
const BANDS = {
    rest:  [0.30, 0.40, 0.80, 0.40, 0.20],
    errp:  [0.20, 0.30, 0.30, 0.85, 0.72],
    sleep: [0.92, 0.70, 0.30, 0.18, 0.10],
    focus: [0.20, 0.30, 0.42, 0.88, 0.72],
    music: [0.30, 0.62, 0.74, 0.50, 0.40],
    exercise: [0.22, 0.34, 0.42, 0.82, 0.62],
    reading: [0.22, 0.34, 0.60, 0.74, 0.52],
    eating: [0.32, 0.52, 0.62, 0.44, 0.30],
    meditation: [0.42, 0.86, 0.80, 0.30, 0.20],
    stress: [0.20, 0.30, 0.30, 0.92, 0.82],
};
const BAND_LABELS = ['δ', 'θ', 'α', 'β', 'γ'];

export class TelemetryManager {
    constructor(canvases, readoutEls, activity) {
        this.cv = canvases.trace; this.ctx = this.cv.getContext('2d');
        this.sv = canvases.sys || null; this.sctx = this.sv ? this.sv.getContext('2d') : null;
        this.bv = canvases.bands; this.bctx = this.bv.getContext('2d');
        this.els = readoutEls;
        this.activity = activity;
        this.t = 0;
        this.trace = new Array(160).fill(0.5);
        this.spikePhase = 0; this._spike = 0;

        this.conf = 4; this.confTgt = 4;
        this.lat = 0; this.latTgt = 0;
        this.band = BANDS.rest.slice();
        this.bandTgt = BANDS.rest.slice();

        this.SYS = ['Cerebrum', 'Limbic', 'Basal Ganglia', 'Diencephalon', 'Cerebellum', 'Brainstem'];
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _fit(cv, ctx) {
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth, h = cv.clientHeight;
        cv.width = w * dpr; cv.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w, h };
    }
    _resize() {
        const a = this._fit(this.cv, this.ctx); this.W = a.w; this.H = a.h;
        const b = this._fit(this.bv, this.bctx); this.BW = b.w; this.BH = b.h;
        if (this.sv) { const s = this._fit(this.sv, this.sctx); this.SW = s.w; this.SH = s.h; }
    }

    setScenario(key, scn) {
        this.scn = scn; this.key = key;
        this.confTgt = scn.confidence != null ? scn.confidence : (key === 'rest' ? 4 : 8 + scn.arousal * 10);
        this.latTgt = scn.latency != null ? scn.latency : 0;
        this.errp = key === 'errp';
        this.stress = key === 'stress' || key === 'errp';
        this.bandTgt = (BANDS[key] || BANDS.rest).slice();
    }

    update(dt) {
        this.t += dt;
        this.conf += (this.confTgt - this.conf) * Math.min(1, dt * 3);
        this.lat += (this.latTgt - this.lat) * Math.min(1, dt * 3);
        for (let i = 0; i < 5; i++) this.band[i] += (this.bandTgt[i] - this.band[i]) * Math.min(1, dt * 2.5);

        // EEG trace
        const arousal = this.scn ? this.scn.arousal : 0.15;
        let v = 0.5 + (Math.sin(this.t * 9) * 0.04 + (Math.random() - 0.5) * 0.06) * (0.4 + arousal);
        this.spikePhase += dt;
        const period = this.errp ? 1.6 : (this.stress ? 1.1 : 0);
        if (period && this.spikePhase > period) { this.spikePhase = 0; this._spike = 1; }
        if (this._spike > 0) { v -= this._spike * 0.42; this._spike -= dt * 3.2; if (this._spike < 0) this._spike = 0; }
        this.trace.push(Math.max(0.05, Math.min(0.95, v))); this.trace.shift();

        this._drawTrace();
        if (this.sv) this._drawSys();
        this._drawBands();

        if (this.els.confidence) this.els.confidence.textContent = this.conf.toFixed(1) + '%';
        if (this.els.latency) this.els.latency.textContent = this.lat < 1 ? '—' : Math.round(this.lat) + ' ms';
        if (this.els.status) {
            this.els.status.textContent = this.errp ? '● ERROR SIGNAL' : (this.stress ? '● elevated' : 'monitoring');
            this.els.status.className = 'tele-status ' + (this.errp ? 'on' : (this.stress ? 'warn' : ''));
        }
    }

    _drawTrace() {
        const c = this.ctx, W = this.W, H = this.H;
        c.clearRect(0, 0, W, H);
        const traceH = this.sv ? H : H * 0.46;     // full height when bars get their own chart
        c.fillStyle = 'rgba(53,224,255,0.04)'; c.fillRect(0, 0, W, traceH);
        c.strokeStyle = this.errp ? '#ff1ad9' : '#35e0ff'; c.lineWidth = 1.4; c.beginPath();
        for (let i = 0; i < this.trace.length; i++) {
            const x = (i / (this.trace.length - 1)) * W, y = this.trace[i] * traceH;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        c.fillStyle = 'rgba(138,147,163,0.8)'; c.font = '9px ui-monospace, monospace';
        c.fillText('EEG / ErrP', 6, 12);
        if (this.sv) return;                        // bars drawn on their own canvas
        this._bars(c, traceH + 8, H, W);
    }

    _drawSys() {
        const c = this.sctx;
        c.clearRect(0, 0, this.SW, this.SH);
        this._bars(c, 0, this.SH, this.SW);
    }

    _bars(c, top, H, W) {
        const levels = this.activity.getSystemLevels(), n = this.SYS.length, rowH = (H - top) / n;
        c.font = '9px ui-monospace, monospace';
        for (let i = 0; i < n; i++) {
            const sys = this.SYS[i], lvl = levels[sys] != null ? levels[sys] : 0.5;
            const y = top + i * rowH + 1, bw = W - 92;
            c.fillStyle = 'rgba(138,147,163,0.85)'; c.fillText(sys, 0, y + rowH * 0.62);
            c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(88, y, bw, rowH - 4);
            const col = lvl < 0.5 ? '#2790c6' : (lvl < 0.66 ? '#85878f' : (lvl < 0.83 ? '#f5a829' : '#fa1e1e'));
            c.fillStyle = col; c.fillRect(88, y, bw * Math.max(0.02, lvl), rowH - 4);
        }
    }

    _drawBands() {
        const c = this.bctx, W = this.BW, H = this.BH;
        c.clearRect(0, 0, W, H);
        const n = 5, gap = 10, bw = (W - gap * (n + 1)) / n, base = H - 14;
        for (let i = 0; i < n; i++) {
            const jitter = 0.04 * Math.sin(this.t * (5 + i) + i);
            const v = Math.max(0.02, Math.min(1, this.band[i] + jitter));
            const x = gap + i * (bw + gap), h = v * (base - 6);
            // bar
            const grad = c.createLinearGradient(0, base - h, 0, base);
            grad.addColorStop(0, '#4af0ff'); grad.addColorStop(1, 'rgba(53,224,255,0.15)');
            c.fillStyle = grad;
            c.fillRect(x, base - h, bw, h);
            // label
            c.fillStyle = 'rgba(180,190,205,0.9)'; c.font = '11px ui-monospace, monospace';
            c.textAlign = 'center'; c.fillText(BAND_LABELS[i], x + bw / 2, H - 2);
        }
        c.textAlign = 'left';
    }
}
