/**
 * GutTelemetry - live digestive "report" dashboards drawn on canvases.
 *
 *  1. Motility trace — slow peristaltic contraction waves, amplitude tracks
 *     how strongly the gut is moving.
 *  2. Per-system activity bars (Small intestine / Colon / Accessory).
 *  3. Colon-transit bars (Asc / Trans / Desc / Sig) — a wave travelling down
 *     the four colon segments.
 *  4. Readouts: motility, transit speed, and hydration / stool consistency.
 */

export class GutTelemetry {
    constructor(canvases, readoutEls, activity) {
        this.cv = canvases.trace; this.ctx = this.cv.getContext('2d');
        this.sv = canvases.sys || null; this.sctx = this.sv ? this.sv.getContext('2d') : null;
        this.bv = canvases.bands; this.bctx = this.bv.getContext('2d');
        this.els = readoutEls;
        this.activity = activity;
        this.t = 0;
        this.trace = new Array(220).fill(0.5);
        this.scn = null; this.key = 'rest';

        // systems must match the `system` strings in gut-regions.json
        this.SYS = ['Small intestine', 'Colon (large intestine)', 'Accessory'];
        // the four colon segments, in peristaltic order
        this.SEGS = [
            { k: 'ASC', id: 'Ascending colon' },
            { k: 'TRAN', id: 'Transverse colon' },
            { k: 'DESC', id: 'Descending colon' },
            { k: 'SIG', id: 'Sigmoid colon' },
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
        const a = this.activity;
        // slow peristaltic wave; amplitude tracks motility
        const amp = Math.max(0.04, Math.min(1, a.motility));
        const wob = Math.sin(this.t * 2.4) * 0.7 + Math.sin(this.t * 5.1 + 0.6) * 0.3;
        this.trace.push(0.5 - wob * amp * 0.4);
        this.trace.shift();

        this._drawTrace();
        if (this.sv) this._drawSys();
        this._drawSegments();

        if (this.els.motility) this.els.motility.textContent = a.motility > 0.66 ? 'high' : (a.motility < 0.25 ? 'low' : 'normal');
        if (this.els.transit) this.els.transit.textContent = a.transit;
        if (this.els.state) this.els.state.textContent = this.scn ? this.scn.name : 'resting';
        if (this.els.status) {
            let txt = 'regular', cls = '';
            if (this.key === 'appendicitis') { txt = '● inflamed · emergency'; cls = 'warn'; }
            else if (a.transit === 'slow') { txt = '● slow · constipation'; cls = 'warn'; }
            else if (a.transit === 'fast') { txt = '● fast · loose'; cls = 'warn'; }
            else { txt = '● regular'; cls = ''; }
            this.els.status.textContent = txt;
            this.els.status.className = 'tele-status ' + cls;
        }
    }

    _drawTrace() {
        const c = this.ctx, W = this.W, H = this.H;
        c.clearRect(0, 0, W, H);
        const traceH = this.sv ? H : H * 0.46;
        c.fillStyle = 'rgba(249,115,22,0.06)'; c.fillRect(0, 0, W, traceH);
        c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = 1;
        for (let x = 0; x < W; x += 18) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, traceH); c.stroke(); }
        c.strokeStyle = '#f97316'; c.lineWidth = 1.7; c.beginPath();
        for (let i = 0; i < this.trace.length; i++) {
            const x = (i / (this.trace.length - 1)) * W, y = this.trace[i] * traceH;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        c.fillStyle = 'rgba(214,180,150,0.85)'; c.font = '9px ui-monospace, monospace';
        c.fillText('Motility · peristaltic waves', 6, 12);
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
            const y = top + i * rowH + 1, bw = W - 134;
            c.fillStyle = 'rgba(214,180,150,0.85)'; c.fillText(sys, 0, y + rowH * 0.62);
            c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(130, y, bw, rowH - 4);
            const col = lvl < 0.4 ? '#3b82f6' : (lvl < 0.6 ? '#85878f' : (lvl < 0.8 ? '#f97316' : '#dc2626'));
            c.fillStyle = col; c.fillRect(130, y, bw * Math.max(0.02, lvl), rowH - 4);
        }
    }

    // a peristaltic wave travelling down the four colon segments
    _drawSegments() {
        const c = this.bctx, W = this.BW, H = this.BH;
        c.clearRect(0, 0, W, H);
        const n = this.SEGS.length, gap = 12, bw = (W - gap * (n + 1)) / n, base = H - 14;
        const mot = this.activity.motility;
        for (let i = 0; i < n; i++) {
            const wave = 0.5 + 0.5 * Math.sin(this.t * 2.4 - i * 1.1);
            const seg = this.activity.state.get(this.SEGS[i].id);
            const baseLvl = seg ? seg.curLevel * 0.4 : 0.2;
            const v = Math.max(0.04, Math.min(1, baseLvl + mot * wave * 0.6));
            const x = gap + i * (bw + gap), h = v * (base - 6);
            const grad = c.createLinearGradient(0, base - h, 0, base);
            grad.addColorStop(0, '#fdba74'); grad.addColorStop(1, 'rgba(249,115,22,0.15)');
            c.fillStyle = grad; c.fillRect(x, base - h, bw, h);
            c.fillStyle = 'rgba(220,190,160,0.9)'; c.font = '10px ui-monospace, monospace';
            c.textAlign = 'center'; c.fillText(this.SEGS[i].k, x + bw / 2, H - 2);
        }
        c.textAlign = 'left';
    }
}
