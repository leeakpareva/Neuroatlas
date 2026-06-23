/**
 * LungActivity - ventilation heatmap + live breathing cycle for the lung atlas.
 *
 * Mirrors HeartActivity: tweens each part between its anatomy colour (rest) and
 * a heat colour driven by a scenario, with an idle shimmer and pulse. It also
 * owns the respiratory cycle — breathing rate, breath phase and an inflation
 * value (0 = fully exhaled .. 1 = fully inhaled) that the app uses to make the
 * lungs visibly breathe and that the telemetry uses to draw a synchronised
 * spirogram.
 *
 * Scientifically-informed dramatisation for learning, not a biophysical sim.
 */

import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

const STOPS = [
    [0.00, new THREE.Color(0.10, 0.28, 0.90)],
    [0.25, new THREE.Color(0.15, 0.55, 0.78)],
    [0.50, new THREE.Color(0.52, 0.53, 0.60)],
    [0.75, new THREE.Color(0.96, 0.66, 0.16)],
    [1.00, new THREE.Color(0.98, 0.12, 0.12)],
];
function heat(level) {
    level = Math.max(0, Math.min(1, level));
    for (let i = 1; i < STOPS.length; i++) {
        if (level <= STOPS[i][0]) {
            const [l0, c0] = STOPS[i - 1], [l1, c1] = STOPS[i];
            return c0.clone().lerp(c1, (level - l0) / (l1 - l0));
        }
    }
    return STOPS[STOPS.length - 1][1].clone();
}

// rr = breaths/min, tidal = tidal volume (ml), spo2 (%), arousal 0..1,
// levels keyed by substrings of the part name, pulse[] to throb, flags.
export const SCENARIOS = {
    rest: { cat: 'concept', name: 'Resting Breath', rr: 14, tidal: 500, spo2: 98, arousal: 0.18,
        desc: 'Quiet tidal breathing. The diaphragm does almost all the work, moving about half a litre of air in and out roughly 14 times a minute — the baseline every other state is compared against.',
        levels: {}, pulse: [] },
    deep: { cat: 'concept', name: 'Deep Breath', rr: 7, tidal: 3000, spo2: 99, arousal: 0.5, amp: 1.0,
        desc: 'A slow, full breath. The diaphragm drops further and the lobes expand to near their full capacity, drawing in up to six times the resting volume.',
        levels: { 'lung': 0.9, 'diaphragm': 1.0, 'trachea': 0.7 }, pulse: ['diaphragm'] },
    forced: { cat: 'concept', name: 'Forced Exhale', rr: 12, tidal: 1200, spo2: 98, arousal: 0.6,
        desc: 'Pushing air out hard — like blowing out candles. The abdominal and accessory muscles join the diaphragm to squeeze the lungs below their resting volume.',
        levels: { 'diaphragm': 0.95, 'lung': 0.55, 'trachea': 0.85 }, pulse: ['diaphragm'] },
    hold: { cat: 'concept', name: 'Breath-Hold', rr: 3, tidal: 0, spo2: 89, arousal: 0.4, hold: true,
        desc: 'Holding the breath. Airflow stops, the lobes stay inflated, and blood oxygen slowly falls while carbon dioxide climbs — which is what eventually forces you to breathe again.',
        levels: { 'lung': 0.4, 'diaphragm': 0.2, 'trachea': 0.1 }, pulse: [] },

    exercise: { cat: 'activity', name: 'Exercise', rr: 35, tidal: 2200, spo2: 96, arousal: 0.95, amp: 0.95,
        desc: 'Hard exercise. Breathing rate and depth both surge so the lungs can supply the oxygen the muscles burn and clear the extra carbon dioxide.',
        levels: { 'lung': 1.0, 'diaphragm': 0.95, 'trachea': 0.85 }, pulse: ['diaphragm'] },
    sleep: { cat: 'activity', name: 'Sleep', rr: 11, tidal: 450, spo2: 96, arousal: 0.08, amp: 0.7,
        desc: 'During sleep, breathing slows and becomes shallow and regular as the body\'s demand for oxygen drops.',
        levels: { 'lung': 0.34, 'diaphragm': 0.4 }, pulse: [] },
    asthma: { cat: 'activity', name: 'Asthma Attack', rr: 28, tidal: 320, spo2: 90, arousal: 0.9, amp: 0.45, wheeze: true,
        desc: 'The airways narrow and inflame, so air gets trapped and each breath moves less. Breathing is fast and laboured, the chest works hard, and oxygen falls — the hallmark wheeze of asthma.',
        levels: { 'trachea': 1.0, 'lung': 0.3, 'diaphragm': 0.85 }, pulse: ['trachea'] },
    yawn: { cat: 'activity', name: 'Yawn', rr: 8, tidal: 2500, spo2: 99, arousal: 0.3, amp: 1.0,
        desc: 'One long, involuntary deep breath that reinflates collapsed alveoli and may help reset arousal. The jaw drops and the diaphragm pulls down hard.',
        levels: { 'lung': 0.85, 'diaphragm': 0.95 }, pulse: ['diaphragm'] },
};

export class LungActivity {
    constructor(scene, idToMesh, regions) {
        this.scene = scene;
        this.idToMesh = idToMesh;
        this.regions = regions;
        this.active = 'rest';
        this._t = 0;

        // respiratory cycle
        this.rr = 14; this.rrTgt = 14;
        this.amp = 0.8; this.ampTgt = 0.8;
        this.hold = false; this.wheeze = false;
        this._breathT = 0; this.breathPhase = 0; this.inflation = 0;

        this.state = new Map();
        let i = 0;
        for (const [id, mesh] of idToMesh) {
            const base = mesh.material.userData.baseColor.clone();
            this.state.set(id, {
                mesh, base,
                curLevel: 0.5, tgtLevel: 0.5,
                curCol: base.clone(), tgtCol: base.clone(),
                curGlow: 0, tgtGlow: 0, flash: 0,
                pulsing: false, phase: (i++ % 12) * 0.6, heatMode: false,
            });
        }
    }

    _levelFor(id, levels) {
        const k = id.toLowerCase();
        let lvl = 0.5;
        for (const key in levels) if (k.includes(key)) lvl = levels[key];
        return lvl;
    }

    apply(key) {
        const s = SCENARIOS[key];
        if (!s) return;
        this.active = key;
        this.rrTgt = s.rr;
        this.ampTgt = s.amp != null ? s.amp : 0.8;
        this.hold = !!s.hold;
        this.wheeze = !!s.wheeze;
        const heatMode = key !== 'rest';
        for (const [id, st] of this.state) {
            const lvl = heatMode ? this._levelFor(id, s.levels) : 0.5;
            st.tgtLevel = lvl;
            st.heatMode = heatMode;
            st.tgtCol = heatMode ? heat(lvl) : st.base.clone();
            st.tgtGlow = heatMode ? Math.abs(lvl - 0.5) * 2 : 0;
            st.pulsing = heatMode && s.pulse.some(p => id.toLowerCase().includes(p));
            st.flash = (heatMode && lvl >= 0.7) ? 2.0 : 0;
        }
    }

    clear() { this.apply('rest'); }

    _ease(x) { return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x))); }

    update(dt) {
        this._t += dt;
        this.rr += (this.rrTgt - this.rr) * Math.min(1, dt * 2.5);
        this.amp += (this.ampTgt - this.amp) * Math.min(1, dt * 2.5);

        // advance the breathing cycle (inhale ~45% of the period, exhale the rest)
        const period = 60 / Math.max(2, this.rr);
        this._breathT += dt;
        if (this._breathT >= period) this._breathT -= period;
        this.breathPhase = this._breathT / period;
        const fi = 0.45;
        let infl = this.breathPhase < fi
            ? this._ease(this.breathPhase / fi)
            : 1 - this._ease((this.breathPhase - fi) / (1 - fi));
        if (this.hold) infl = 0.8;             // breath-hold: stay inflated
        this.inflation = infl * this.amp;

        const k = Math.min(1, dt * 4);
        for (const [, st] of this.state) {
            st.curLevel += (st.tgtLevel - st.curLevel) * k;
            st.curCol.lerp(st.tgtCol, k);
            st.curGlow += (st.tgtGlow - st.curGlow) * k;

            const mat = st.mesh.material;
            mat.color.copy(st.curCol);
            const shimmer = 0.05 * (0.5 + 0.5 * Math.sin(this._t * 1.6 + st.phase));
            let glow = st.curGlow * 0.7 + shimmer;
            glow += this.inflation * 0.22;     // parts brighten as the lungs fill
            if (st.pulsing) glow += 0.4 * this.inflation + 0.25 * (0.5 + 0.5 * Math.sin(this._t * 6));
            mat.emissive.copy(st.heatMode ? st.curCol : st.base);
            if (st.flash > 0) {
                st.flash = Math.max(0, st.flash - dt);
                const osc = 0.5 + 0.5 * Math.sin(this._t * 18);
                glow += st.flash * (0.9 + osc * 1.6);
                mat.emissive.lerp(WHITE, st.flash * 0.5 * osc);
            }
            mat.emissiveIntensity = glow;
        }
    }

    getSystemLevels() {
        const acc = {}, cnt = {};
        for (const [id, st] of this.state) {
            const sys = (this.regions[id] && this.regions[id].system) || 'Other';
            acc[sys] = (acc[sys] || 0) + st.curLevel;
            cnt[sys] = (cnt[sys] || 0) + 1;
        }
        const out = {};
        for (const s in acc) out[s] = acc[s] / cnt[s];
        return out;
    }
}
