/**
 * LungTelemetry - live respiratory "report" dashboards drawn on canvases.
 *
 *  1. Spirogram — lung volume over time, synced to the live breathing cycle;
 *     goes shallow/fast in asthma and flatlines during a breath-hold.
 *  2. Per-system activity bars (driven by LungActivity).
 *  3. Lobe ventilation bars (RUL / RML / RLL / LUL / LLL), modulated by inflation.
 *  4. Readouts: respiratory rate, SpO2, tidal volume, and breathing status.
 */

export class LungTelemetry {
    constructor(canvases, readoutEls, activity) {
        this.cv = canvases.trace; this.ctx = this.cv.getContext('2d');
        this.sv = canvases.sys || null; this.sctx = this.sv ? this.sv.getContext('2d') : null;
        this.bv = canvases.bands; this.bctx = this.bv.getContext('2d');
        this.els = readoutEls;
        this.activity = activity;
        this.t = 0;
        this.trace = new Array(220).fill(0.9);
        this.scn = null; this.key = 'rest';

        // systems must match the `system` strings in lungs-regions.json
        this.SYS = ['Right lung', 'Left lung', 'Airway', 'Respiratory muscle'];
        this.LOBES = [
            { k: 'RUL', id: 'Superior lobe of right lung' },
            { k: 'RML', id: 'Middle lobe of right lung' },
            { k: 'RLL', id: 'Inferior lobe of right lung' },
            { k: 'LUL', id: 'Superior lobe of left lung' },
            { k: 'LLL', id: 'Inferior lobe of left lung' },
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

    update(dt) {
        this.t += dt;
        // spirogram: lung volume = inflation; small wheeze jitter in asthma
        let vol = this.activity.inflation;
        if (this.activity.wheeze) vol += 0.03 * Math.sin(this.t * 26);
        // canvas y: full lungs near the top, empty near the bottom
        this.trace.push(Math.max(0.06, Math.min(0.96, 0.92 - vol * 0.74)));
        this.trace.shift();

        this._drawTrace();
        if (this.sv) this._drawSys();
        this._drawVentilation();

        const scn = this.scn || {};
        if (this.els.rr) this.els.rr.textContent = Math.round(this.activity.rr) + '/min';
        if (this.els.spo2 && scn.spo2 != null) this.els.spo2.textContent = scn.spo2 + '%';
        if (this.els.tidal && scn.tidal != null) this.els.tidal.textContent = scn.tidal >= 1000
            ? (scn.tidal / 1000).toFixed(1) + ' L' : scn.tidal + ' ml';
        if (this.els.status) {
            let txt = 'breathing', cls = '';
            if (this.activity.hold) { txt = '● breath-hold'; cls = 'on'; }
            else if (this.activity.wheeze) { txt = '● wheezing'; cls = 'on'; }
            else if (this.activity.rr > 24) { txt = '● rapid'; cls = 'warn'; }
            this.els.status.textContent = txt;
            this.els.status.className = 'tele-status ' + cls;
        }
    }

    _drawTrace() {
        const c = this.ctx, W = this.W, H = this.H;
        c.clearRect(0, 0, W, H);
        const traceH = this.sv ? H : H * 0.46;
        c.fillStyle = 'rgba(52,211,153,0.05)'; c.fillRect(0, 0, W, traceH);
        c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = 1;
        for (let x = 0; x < W; x += 18) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, traceH); c.stroke(); }
        const danger = this.activity.wheeze || this.activity.hold;
        c.strokeStyle = danger ? '#ffb13b' : '#34d399'; c.lineWidth = 1.6; c.beginPath();
        for (let i = 0; i < this.trace.length; i++) {
            const x = (i / (this.trace.length - 1)) * W, y = this.trace[i] * traceH;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        c.fillStyle = 'rgba(150,180,165,0.85)'; c.font = '9px ui-monospace, monospace';
        c.fillText('Spirogram · lung volume', 6, 12);
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
            const y = top + i * rowH + 1, bw = W - 100;
            c.fillStyle = 'rgba(150,180,165,0.85)'; c.fillText(sys, 0, y + rowH * 0.62);
            c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(96, y, bw, rowH - 4);
            const col = lvl < 0.4 ? '#2790c6' : (lvl < 0.6 ? '#85878f' : (lvl < 0.8 ? '#f5a829' : '#34d399'));
            c.fillStyle = col; c.fillRect(96, y, bw * Math.max(0.02, lvl), rowH - 4);
        }
    }

    _drawVentilation() {
        const c = this.bctx, W = this.BW, H = this.BH;
        c.clearRect(0, 0, W, H);
        const infl = this.activity.inflation;
        const levels = this.activity.getSystemLevels();
        const n = this.LOBES.length, gap = 10, bw = (W - gap * (n + 1)) / n, base = H - 14;
        for (let i = 0; i < n; i++) {
            const lobe = this.LOBES[i];
            const st = this.activity.state.get(lobe.id);
            const lvl = st ? st.curLevel : 0.5;
            // each lobe's bar = how hard it's working × how full the lungs are
            const v = Math.max(0.03, Math.min(1, (0.25 + lvl * 0.75) * (0.35 + infl * 0.65)));
            const x = gap + i * (bw + gap), h = v * (base - 6);
            const grad = c.createLinearGradient(0, base - h, 0, base);
            grad.addColorStop(0, '#5ee7b0'); grad.addColorStop(1, 'rgba(52,211,153,0.15)');
            c.fillStyle = grad; c.fillRect(x, base - h, bw, h);
            c.fillStyle = 'rgba(170,200,185,0.9)'; c.font = '10px ui-monospace, monospace';
            c.textAlign = 'center'; c.fillText(lobe.k, x + bw / 2, H - 2);
        }
        c.textAlign = 'left';
    }
}
