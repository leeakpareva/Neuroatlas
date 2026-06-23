/**
 * EarTelemetry - live auditory "report" dashboards drawn on canvases.
 *
 *  1. Sound-level trace — a VU-style waveform whose amplitude tracks loudness.
 *  2. Per-system activity bars (Outer ear / Middle ear / Inner ear).
 *  3. Frequency-response bars (250 500 1k 2k 4k 8k Hz), shaped by the current
 *     pitch — an audiogram-style readout of where the cochlea is responding.
 *  4. Readouts: loudness (dB), frequency band, and balance status.
 */

export class EarTelemetry {
    constructor(canvases, readoutEls, activity) {
        this.cv = canvases.trace; this.ctx = this.cv.getContext('2d');
        this.sv = canvases.sys || null; this.sctx = this.sv ? this.sv.getContext('2d') : null;
        this.bv = canvases.bands; this.bctx = this.bv.getContext('2d');
        this.els = readoutEls;
        this.activity = activity;
        this.t = 0;
        this.trace = new Array(220).fill(0.5);
        this.scn = null; this.key = 'rest';

        // systems must match the `system` strings in ear-regions.json
        this.SYS = ['Outer ear', 'Middle ear', 'Inner ear'];
        // audiogram-style frequency bands (Hz), low -> high
        this.BANDS = [
            { k: '250', hz: 250 }, { k: '500', hz: 500 }, { k: '1k', hz: 1000 },
            { k: '2k', hz: 2000 }, { k: '4k', hz: 4000 }, { k: '8k', hz: 8000 },
        ];
        this.bandLvl = new Array(this.BANDS.length).fill(0.1);
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

    setScenario(key, scn) { this.scn = scn; this.key = key; }

    // shape a frequency profile from the current pitch + loudness
    _targetBands() {
        const a = this.activity;
        const amp = Math.max(0.05, Math.min(1, (a.db - 20) / 80));
        // emphasis curve per band index 0..5 (250Hz..8kHz)
        const profiles = {
            low:  [1.0, 0.9, 0.6, 0.35, 0.2, 0.12],
            mid:  [0.4, 0.7, 1.0, 0.9, 0.55, 0.3],
            high: [0.15, 0.25, 0.5, 0.8, 1.0, 0.95],
            mix:  [0.7, 0.8, 0.9, 0.9, 0.8, 0.7],
        };
        const p = profiles[a.freq] || profiles.mid;
        return p.map(v => Math.max(0.05, v * amp));
    }

    update(dt) {
        this.t += dt;
        const a = this.activity;

        // VU waveform: amplitude tracks loudness; flat-ish line when quiet
        const amp = Math.max(0, Math.min(1, (a.db - 20) / 80));
        const wob = Math.sin(this.t * 22) * 0.5 + Math.sin(this.t * 51 + 1.3) * 0.3 + (Math.random() - 0.5) * 0.4;
        this.trace.push(0.5 - wob * amp * 0.42);
        this.trace.shift();

        // ease the frequency bars toward their target profile
        const tb = this._targetBands(), bk = Math.min(1, dt * 5);
        for (let i = 0; i < this.bandLvl.length; i++) this.bandLvl[i] += (tb[i] - this.bandLvl[i]) * bk;

        this._drawTrace();
        if (this.sv) this._drawSys();
        this._drawBands();

        if (this.els.db) this.els.db.textContent = Math.round(a.db) + ' dB';
        if (this.els.freq) this.els.freq.textContent = a.freq;
        if (this.els.balance) this.els.balance.textContent = a.balance > 0.6 ? 'active' : 'steady';
        if (this.els.status) {
            let txt = 'quiet', cls = '';
            if (a.db >= 85) { txt = '● loud · risk'; cls = 'warn'; }
            else if (a.balance > 0.6) { txt = '● balancing'; cls = ''; }
            else if (a.db >= 55) { txt = '● hearing'; cls = ''; }
            else if (a.db <= 30) { txt = 'quiet'; cls = ''; }
            this.els.status.textContent = txt;
            this.els.status.className = 'tele-status ' + cls;
        }
    }

    _drawTrace() {
        const c = this.ctx, W = this.W, H = this.H;
        c.clearRect(0, 0, W, H);
        const traceH = this.sv ? H : H * 0.46;
        c.fillStyle = 'rgba(251,191,36,0.06)'; c.fillRect(0, 0, W, traceH);
        c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = 1;
        for (let x = 0; x < W; x += 18) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, traceH); c.stroke(); }
        c.strokeStyle = '#fbbf24'; c.lineWidth = 1.6; c.beginPath();
        for (let i = 0; i < this.trace.length; i++) {
            const x = (i / (this.trace.length - 1)) * W, y = this.trace[i] * traceH;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        c.fillStyle = 'rgba(210,190,150,0.85)'; c.font = '9px ui-monospace, monospace';
        c.fillText('Sound level · loudness', 6, 12);
        if (this.sv) return;
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
            const y = top + i * rowH + 1, bw = W - 104;
            c.fillStyle = 'rgba(210,190,150,0.85)'; c.fillText(sys, 0, y + rowH * 0.62);
            c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(100, y, bw, rowH - 4);
            const col = lvl < 0.4 ? '#2dd4bf' : (lvl < 0.6 ? '#85878f' : (lvl < 0.8 ? '#f59e0b' : '#fb7185'));
            c.fillStyle = col; c.fillRect(100, y, bw * Math.max(0.02, lvl), rowH - 4);
        }
    }

    _drawBands() {
        const c = this.bctx, W = this.BW, H = this.BH;
        c.clearRect(0, 0, W, H);
        const n = this.BANDS.length, gap = 9, bw = (W - gap * (n + 1)) / n, base = H - 14;
        for (let i = 0; i < n; i++) {
            const v = Math.max(0.03, Math.min(1, this.bandLvl[i]));
            const x = gap + i * (bw + gap), h = v * (base - 6);
            const grad = c.createLinearGradient(0, base - h, 0, base);
            grad.addColorStop(0, '#fcd34d'); grad.addColorStop(1, 'rgba(251,191,36,0.15)');
            c.fillStyle = grad; c.fillRect(x, base - h, bw, h);
            c.fillStyle = 'rgba(214,196,156,0.9)'; c.font = '10px ui-monospace, monospace';
            c.textAlign = 'center'; c.fillText(this.BANDS[i].k, x + bw / 2, H - 2);
        }
        c.textAlign = 'left';
    }
}
