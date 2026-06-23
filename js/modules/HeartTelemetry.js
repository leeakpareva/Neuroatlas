/**
 * HeartTelemetry - live cardiac "report" dashboards drawn on canvases.
 *
 *  1. Lead-II ECG trace (P-QRS-T), synced to the live heartbeat; ST-elevates in
 *     infarction and loses its P wave / goes irregular in atrial fibrillation.
 *  2. Per-system chamber activity bars (driven by HeartActivity).
 *  3. Chamber pressure bars (RA / RV / LA / LV / Aorta), modulated by contraction.
 *  4. Readouts: heart rate, blood pressure, SpO2, and rhythm status.
 */

function gauss(x, c, w) { const d = x - c; return Math.exp(-(d * d) / (2 * w * w)); }

export class HeartTelemetry {
    constructor(canvases, readoutEls, activity) {
        this.cv = canvases.trace; this.ctx = this.cv.getContext('2d');
        this.sv = canvases.sys || null; this.sctx = this.sv ? this.sv.getContext('2d') : null;
        this.bv = canvases.bands; this.bctx = this.bv.getContext('2d');
        this.els = readoutEls;
        this.activity = activity;
        this.t = 0;
        this.trace = new Array(220).fill(0.5);
        this.scn = null; this.key = 'rest';

        // systems must match the `system` strings in heart-regions.json
        this.SYS = ['Left heart · oxygenated', 'Right heart · deoxygenated',
            'Atrioventricular valves', 'Semilunar valves', 'Papillary muscles'];
        this.SYS_SHORT = { 'Left heart · oxygenated': 'Left heart', 'Right heart · deoxygenated': 'Right heart',
            'Atrioventricular valves': 'AV valves', 'Semilunar valves': 'Semilunar', 'Papillary muscles': 'Papillary' };
        this.CHAMBERS = ['RA', 'RV', 'LA', 'LV', 'Ao'];

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

    _ecg(p) {
        const a = this.activity;
        let v = 0;
        if (a.irregular) v += 0.035 * Math.sin(this.t * 38 + p * 70);   // fibrillatory baseline, no clean P
        else v += 0.12 * gauss(p, 0.17, 0.018);                         // P wave
        v += -0.07 * gauss(p, 0.295, 0.008);                            // Q
        v += 0.98 * gauss(p, 0.33, 0.0085);                             // R
        v += -0.17 * gauss(p, 0.365, 0.009);                            // S
        if (a.mi) v += 0.17 * gauss(p, 0.49, 0.075);                    // ST elevation
        v += 0.22 * gauss(p, 0.60, 0.030);                              // T wave
        return v;
    }

    update(dt) {
        this.t += dt;
        // sample the ECG at the live cardiac phase and scroll it in
        const v = this._ecg(this.activity.beatPhase);
        this.trace.push(Math.max(0.04, Math.min(0.96, 0.5 - v * 0.42)));
        this.trace.shift();

        this._drawTrace();
        if (this.sv) this._drawSys();
        this._drawPressure();

        const scn = this.scn || {};
        if (this.els.hr) this.els.hr.textContent = Math.round(this.activity.hr) + ' bpm';
        if (this.els.bp && scn.bp) this.els.bp.textContent = scn.bp[0] + '/' + scn.bp[1];
        if (this.els.spo2 && scn.spo2 != null) this.els.spo2.textContent = scn.spo2 + '%';
        if (this.els.status) {
            let txt = 'sinus rhythm', cls = '';
            if (this.activity.mi) { txt = '● INFARCTION'; cls = 'on'; }
            else if (this.key === 'afib') { txt = '● ATRIAL FIB'; cls = 'on'; }
            else if (this.activity.hr > 100) { txt = '● tachycardia'; cls = 'warn'; }
            else if (this.activity.hr < 55) { txt = '● bradycardia'; cls = 'warn'; }
            this.els.status.textContent = txt;
            this.els.status.className = 'tele-status ' + cls;
        }
    }

    _drawTrace() {
        const c = this.ctx, W = this.W, H = this.H;
        c.clearRect(0, 0, W, H);
        const traceH = this.sv ? H : H * 0.46;
        c.fillStyle = 'rgba(255,60,80,0.05)'; c.fillRect(0, 0, W, traceH);
        // faint ECG grid
        c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = 1;
        for (let x = 0; x < W; x += 18) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, traceH); c.stroke(); }
        const danger = this.activity.mi || this.key === 'afib';
        c.strokeStyle = danger ? '#ff3b5c' : '#ff5a6e'; c.lineWidth = 1.5; c.beginPath();
        for (let i = 0; i < this.trace.length; i++) {
            const x = (i / (this.trace.length - 1)) * W, y = this.trace[i] * traceH;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        c.fillStyle = 'rgba(180,150,160,0.85)'; c.font = '9px ui-monospace, monospace';
        c.fillText('Lead II · ECG', 6, 12);
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
            const y = top + i * rowH + 1, bw = W - 92;
            c.fillStyle = 'rgba(180,150,160,0.85)'; c.fillText(this.SYS_SHORT[sys] || sys, 0, y + rowH * 0.62);
            c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(88, y, bw, rowH - 4);
            const col = lvl < 0.4 ? '#2790c6' : (lvl < 0.6 ? '#85878f' : (lvl < 0.8 ? '#f5a829' : '#fa1e3c'));
            c.fillStyle = col; c.fillRect(88, y, bw * Math.max(0.02, lvl), rowH - 4);
        }
    }

    _drawPressure() {
        const c = this.bctx, W = this.BW, H = this.BH;
        c.clearRect(0, 0, W, H);
        const cc = this.activity.contraction;
        const sysP = (this.scn && this.scn.bp) ? this.scn.bp[0] : 120;
        const diaP = (this.scn && this.scn.bp) ? this.scn.bp[1] : 80;
        const lvF = this.activity.mi ? 0.42 : 1;   // infarcted ventricle pumps weakly
        const P = {
            RA: 4 + 2 * cc,
            RV: 6 + 22 * cc,
            LA: 9 + 4 * cc,
            LV: (8 + (sysP - 8) * cc) * lvF,
            Ao: diaP + (sysP - diaP) * cc * lvF,
        };
        const MAX = 180, n = this.CHAMBERS.length;
        const gap = 10, bw = (W - gap * (n + 1)) / n, base = H - 14;
        for (let i = 0; i < n; i++) {
            const id = this.CHAMBERS[i];
            const v = Math.max(0.02, Math.min(1, P[id] / MAX));
            const x = gap + i * (bw + gap), h = v * (base - 6);
            const grad = c.createLinearGradient(0, base - h, 0, base);
            grad.addColorStop(0, '#ff6e85'); grad.addColorStop(1, 'rgba(255,60,90,0.15)');
            c.fillStyle = grad; c.fillRect(x, base - h, bw, h);
            c.fillStyle = 'rgba(200,170,180,0.9)'; c.font = '10px ui-monospace, monospace';
            c.textAlign = 'center'; c.fillText(id, x + bw / 2, H - 2);
        }
        c.textAlign = 'left';
    }
}
