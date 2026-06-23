/**
 * EyeTelemetry - live ocular "report" dashboards drawn on canvases.
 *
 *  1. Pupillometry trace — pupil diameter over time, reacting to light.
 *  2. Per-system activity bars (Light path / Globe & retina / Eye muscles).
 *  3. Extraocular muscle-tone bars (SR / IR / LR / MR / SO / IO), driven by gaze.
 *  4. Readouts: pupil diameter, light level, focus distance, and gaze status.
 */

export class EyeTelemetry {
    constructor(canvases, readoutEls, activity) {
        this.cv = canvases.trace; this.ctx = this.cv.getContext('2d');
        this.sv = canvases.sys || null; this.sctx = this.sv ? this.sv.getContext('2d') : null;
        this.bv = canvases.bands; this.bctx = this.bv.getContext('2d');
        this.els = readoutEls;
        this.activity = activity;
        this.t = 0;
        this.trace = new Array(220).fill(0.5);
        this.scn = null; this.key = 'rest';

        // systems must match the `system` strings in eye-regions.json
        this.SYS = ['Light path', 'Globe & retina', 'Eye muscles'];
        this.MUSCLES = [
            { k: 'SR', id: 'Superior rectus muscle' },
            { k: 'IR', id: 'Inferior rectus muscle' },
            { k: 'LR', id: 'Lateral rectus muscle' },
            { k: 'MR', id: 'Medial rectus muscle' },
            { k: 'SO', id: 'Superior oblique muscle' },
            { k: 'IO', id: 'Inferior oblique muscle' },
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
        // pupillometry: map pupil 1.5..8 mm onto the trace, bigger pupil = higher
        const norm = Math.max(0, Math.min(1, (this.activity.pupil - 1.5) / 6.5));
        this.trace.push(0.9 - norm * 0.78);
        this.trace.shift();

        this._drawTrace();
        if (this.sv) this._drawSys();
        this._drawMuscles();

        const a = this.activity;
        if (this.els.pupil) this.els.pupil.textContent = a.pupil.toFixed(1) + ' mm';
        if (this.els.light) this.els.light.textContent = a.light;
        if (this.els.focus) this.els.focus.textContent = a.focus;
        if (this.els.status) {
            let txt = 'relaxed', cls = '';
            if (a.pupil < 2.6) { txt = '● constricted'; cls = 'warn'; }
            else if (a.pupil > 6) { txt = '● dilated'; cls = 'warn'; }
            else if (a.accom > 0.6) { txt = '● focusing'; cls = ''; }
            else if (this.key.match(/left|right|up|down|reading/)) { txt = '● tracking'; cls = ''; }
            this.els.status.textContent = txt;
            this.els.status.className = 'tele-status ' + cls;
        }
    }

    _drawTrace() {
        const c = this.ctx, W = this.W, H = this.H;
        c.clearRect(0, 0, W, H);
        const traceH = this.sv ? H : H * 0.46;
        c.fillStyle = 'rgba(167,139,250,0.06)'; c.fillRect(0, 0, W, traceH);
        c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = 1;
        for (let x = 0; x < W; x += 18) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, traceH); c.stroke(); }
        c.strokeStyle = '#a78bfa'; c.lineWidth = 1.6; c.beginPath();
        for (let i = 0; i < this.trace.length; i++) {
            const x = (i / (this.trace.length - 1)) * W, y = this.trace[i] * traceH;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        c.fillStyle = 'rgba(180,170,200,0.85)'; c.font = '9px ui-monospace, monospace';
        c.fillText('Pupillometry · diameter', 6, 12);
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
            c.fillStyle = 'rgba(180,170,200,0.85)'; c.fillText(sys, 0, y + rowH * 0.62);
            c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(100, y, bw, rowH - 4);
            const col = lvl < 0.4 ? '#2790c6' : (lvl < 0.6 ? '#85878f' : (lvl < 0.8 ? '#f5a829' : '#a78bfa'));
            c.fillStyle = col; c.fillRect(100, y, bw * Math.max(0.02, lvl), rowH - 4);
        }
    }

    _drawMuscles() {
        const c = this.bctx, W = this.BW, H = this.BH;
        c.clearRect(0, 0, W, H);
        const n = this.MUSCLES.length, gap = 9, bw = (W - gap * (n + 1)) / n, base = H - 14;
        for (let i = 0; i < n; i++) {
            const mu = this.MUSCLES[i];
            const st = this.activity.state.get(mu.id);
            const lvl = st ? st.curLevel : 0.5;
            const v = Math.max(0.03, Math.min(1, lvl));
            const x = gap + i * (bw + gap), h = v * (base - 6);
            const grad = c.createLinearGradient(0, base - h, 0, base);
            grad.addColorStop(0, '#c4b5fd'); grad.addColorStop(1, 'rgba(167,139,250,0.15)');
            c.fillStyle = grad; c.fillRect(x, base - h, bw, h);
            c.fillStyle = 'rgba(190,180,210,0.9)'; c.font = '10px ui-monospace, monospace';
            c.textAlign = 'center'; c.fillText(mu.k, x + bw / 2, H - 2);
        }
        c.textAlign = 'left';
    }
}
