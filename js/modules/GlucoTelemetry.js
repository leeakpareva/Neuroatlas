/**
 * GlucoTelemetry - live metabolic "report" dashboards drawn on canvases.
 *
 *  1. Continuous-glucose trace — blood glucose (mg/dL) over time, with the
 *     70-140 in-range band shaded (the view a CGM gives).
 *  2. Per-system activity bars (Digestive tract / Glucose control / Accessory).
 *  3. Hormone bars (Insulin / Glucagon / GLP-1), driven by the glucose state.
 *  4. Readouts: glucose (mg/dL), insulin level, and metabolic state.
 */

export class GlucoTelemetry {
    constructor(canvases, readoutEls, activity) {
        this.cv = canvases.trace; this.ctx = this.cv.getContext('2d');
        this.sv = canvases.sys || null; this.sctx = this.sv ? this.sv.getContext('2d') : null;
        this.bv = canvases.bands; this.bctx = this.bv.getContext('2d');
        this.els = readoutEls;
        this.activity = activity;
        this.t = 0;
        this.trace = new Array(220).fill(0.5);
        this.scn = null; this.key = 'rest';

        // glucose axis (mg/dL) for the trace + in-range band
        this.GMIN = 40; this.GMAX = 280;
        this.RANGE_LO = 70; this.RANGE_HI = 140;

        // systems must match the `system` strings in gluco-regions.json
        this.SYS = ['Digestive tract', 'Glucose control', 'Accessory organs'];
        this.HORMONES = [
            { k: 'INS', label: 'Insulin', get: a => a.insulin },
            { k: 'GLU', label: 'Glucagon', get: a => a.glucagon },
            { k: 'GLP1', label: 'GLP-1', get: a => a.glp1 },
        ];
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

    _gNorm(g) { return Math.max(0, Math.min(1, (g - this.GMIN) / (this.GMAX - this.GMIN))); }

    update(dt) {
        this.t += dt;
        const a = this.activity;
        // glucose trace: higher glucose -> higher on screen (low y). small live jitter.
        const n = this._gNorm(a.glucose) + (Math.random() - 0.5) * 0.012;
        this.trace.push(0.92 - Math.max(0, Math.min(1, n)) * 0.8);
        this.trace.shift();

        this._drawTrace();
        if (this.sv) this._drawSys();
        this._drawHormones();

        if (this.els.glucose) this.els.glucose.textContent = Math.round(a.glucose) + ' mg/dL';
        if (this.els.insulin) this.els.insulin.textContent = a.insulin > 0.66 ? 'high' : (a.insulin < 0.25 ? 'low' : 'mid');
        if (this.els.state) {
            let txt = this.scn ? this.scn.name : 'fasting';
            this.els.state.textContent = txt;
        }
        if (this.els.status) {
            let txt = 'in range', cls = '';
            if (a.glucose >= 180) { txt = '● high · risk'; cls = 'warn'; }
            else if (a.glucose < 70) { txt = '● low · risk'; cls = 'warn'; }
            else if (a.glucose > 140) { txt = '● elevated'; cls = ''; }
            else { txt = '● in range'; cls = ''; }
            this.els.status.textContent = txt;
            this.els.status.className = 'tele-status ' + cls;
        }
    }

    _drawTrace() {
        const c = this.ctx, W = this.W, H = this.H;
        c.clearRect(0, 0, W, H);
        const traceH = this.sv ? H : H * 0.46;
        c.fillStyle = 'rgba(236,72,153,0.06)'; c.fillRect(0, 0, W, traceH);
        // in-range band (70-140 mg/dL)
        const yHi = (0.92 - this._gNorm(this.RANGE_HI) * 0.8) * traceH;
        const yLo = (0.92 - this._gNorm(this.RANGE_LO) * 0.8) * traceH;
        c.fillStyle = 'rgba(132,204,22,0.10)'; c.fillRect(0, yHi, W, yLo - yHi);
        c.strokeStyle = 'rgba(132,204,22,0.25)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(0, yHi); c.lineTo(W, yHi); c.moveTo(0, yLo); c.lineTo(W, yLo); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.04)';
        for (let x = 0; x < W; x += 18) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, traceH); c.stroke(); }
        c.strokeStyle = '#ec4899'; c.lineWidth = 1.8; c.beginPath();
        for (let i = 0; i < this.trace.length; i++) {
            const x = (i / (this.trace.length - 1)) * W, y = this.trace[i] * traceH;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        c.fillStyle = 'rgba(214,170,196,0.85)'; c.font = '9px ui-monospace, monospace';
        c.fillText('Continuous glucose · mg/dL', 6, 12);
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
            const y = top + i * rowH + 1, bw = W - 124;
            c.fillStyle = 'rgba(214,170,196,0.85)'; c.fillText(sys, 0, y + rowH * 0.62);
            c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(120, y, bw, rowH - 4);
            const col = lvl < 0.4 ? '#3b82f6' : (lvl < 0.6 ? '#85878f' : (lvl < 0.8 ? '#f97316' : '#ec4899'));
            c.fillStyle = col; c.fillRect(120, y, bw * Math.max(0.02, lvl), rowH - 4);
        }
    }

    _drawHormones() {
        const c = this.bctx, W = this.BW, H = this.BH;
        c.clearRect(0, 0, W, H);
        const n = this.HORMONES.length, gap = 12, bw = (W - gap * (n + 1)) / n, base = H - 14;
        for (let i = 0; i < n; i++) {
            const hm = this.HORMONES[i];
            const v = Math.max(0.03, Math.min(1, hm.get(this.activity)));
            const x = gap + i * (bw + gap), h = v * (base - 6);
            const grad = c.createLinearGradient(0, base - h, 0, base);
            grad.addColorStop(0, '#f9a8d4'); grad.addColorStop(1, 'rgba(236,72,153,0.15)');
            c.fillStyle = grad; c.fillRect(x, base - h, bw, h);
            c.fillStyle = 'rgba(220,196,210,0.9)'; c.font = '10px ui-monospace, monospace';
            c.textAlign = 'center'; c.fillText(hm.k, x + bw / 2, H - 2);
        }
        c.textAlign = 'left';
    }
}
