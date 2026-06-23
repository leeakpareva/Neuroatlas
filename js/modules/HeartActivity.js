/**
 * HeartActivity - cardiac-state heatmap + live heartbeat for the heart atlas.
 *
 * Mirrors the brain's ActivityManager: tweens each part between its anatomy
 * colour (rest) and a heat colour driven by a scenario, adds an idle shimmer,
 * and pulses the strongly-involved parts. Additionally it owns the cardiac
 * cycle — heart rate, beat phase and a ventricular contraction value (0..1)
 * that the app uses to make the whole model visibly beat and that the
 * telemetry uses to draw a synchronised ECG.
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

// Each scenario: hr (bpm), bp [systolic, diastolic], spo2 (%), arousal 0..1,
// levels keyed by substrings of the part name, pulse[] to throb, optional flags.
export const SCENARIOS = {
    rest: { cat: 'concept', name: 'Resting Rhythm', hr: 65, bp: [118, 76], spo2: 98, arousal: 0.18,
        desc: 'Normal sinus rhythm. The SA node fires ~65 times a minute; chambers fill and empty in a calm, even cycle — the baseline every other state is compared against.',
        levels: {}, pulse: [] },
    systole: { cat: 'concept', name: 'Systole · Contraction', hr: 70, bp: [120, 80], spo2: 98, arousal: 0.6,
        desc: 'The ventricles contract. The mitral and tricuspid valves snap shut (the "lub"), pressure rockets, and the aortic and pulmonary valves fly open to eject blood to the body and lungs.',
        levels: { 'right ventricle': 0.95, 'left ventricle': 1.0, 'papillary': 0.9, 'leaflet': 0.7, 'right atrium': 0.3, 'left atrium': 0.3 }, pulse: ['ventricle'] },
    diastole: { cat: 'concept', name: 'Diastole · Filling', hr: 60, bp: [115, 74], spo2: 98, arousal: 0.3,
        desc: 'The ventricles relax and refill. The aortic and pulmonary valves close (the "dub"), the AV valves open, and the atria top up the ventricles ready for the next beat.',
        levels: { 'right atrium': 0.85, 'left atrium': 0.9, 'right ventricle': 0.35, 'left ventricle': 0.35, 'leaflet': 0.5 }, pulse: ['atrium'] },
    tachy: { cat: 'concept', name: 'Tachycardia', hr: 170, bp: [134, 92], spo2: 96, arousal: 0.95,
        desc: 'An abnormally fast rate (>100 bpm). The chambers have less time to fill between beats, so each stroke pumps less — the heart works harder for a smaller payoff.',
        levels: { 'right ventricle': 0.9, 'left ventricle': 0.95, 'right atrium': 0.8, 'left atrium': 0.8, 'papillary': 0.85 }, pulse: ['ventricle'] },
    afib: { cat: 'concept', name: 'Atrial Fibrillation', hr: 130, bp: [128, 86], spo2: 95, arousal: 0.85, irregular: true,
        desc: 'The atria quiver chaotically instead of beating cleanly, so the ventricles respond at an irregular, often rapid rate. No coordinated P wave — the pulse feels "irregularly irregular".',
        levels: { 'right atrium': 1.0, 'left atrium': 1.0, 'right ventricle': 0.7, 'left ventricle': 0.7 }, pulse: ['atrium'] },
    mi: { cat: 'concept', name: 'Myocardial Infarction', hr: 105, bp: [96, 64], spo2: 92, arousal: 0.9, mi: true,
        desc: 'A heart attack: a blocked coronary artery starves part of the left-ventricular muscle of oxygen. The affected wall stops contracting (it goes cold/blue here) and the ECG shows ST elevation.',
        levels: { 'left ventricle': 0.05, 'left atrium': 0.45, 'right ventricle': 0.6, 'papillary': 0.2 }, pulse: [] },

    exercise: { cat: 'activity', name: 'Exercise', hr: 150, bp: [150, 85], spo2: 97, arousal: 0.9,
        desc: 'Muscles demand more oxygen, so the heart rate and the force of each contraction both climb. Cardiac output can rise four- to five-fold.',
        levels: { 'right ventricle': 0.9, 'left ventricle': 1.0, 'right atrium': 0.75, 'left atrium': 0.78, 'papillary': 0.85 }, pulse: ['ventricle'] },
    sleep: { cat: 'activity', name: 'Sleep', hr: 50, bp: [104, 66], spo2: 97, arousal: 0.08,
        desc: 'At rest the vagus nerve slows the SA node. Heart rate and blood pressure dip to their lowest of the day during deep sleep.',
        levels: { 'right ventricle': 0.32, 'left ventricle': 0.34, 'right atrium': 0.3, 'left atrium': 0.3 }, pulse: [] },
    stress: { cat: 'activity', name: 'Stress / Fear', hr: 120, bp: [145, 95], spo2: 97, arousal: 0.92,
        desc: 'Adrenaline floods the system in fight-or-flight. The SA node speeds up, contractions strengthen and blood pressure spikes to prime the body for action.',
        levels: { 'left ventricle': 0.92, 'right ventricle': 0.85, 'left atrium': 0.7, 'right atrium': 0.7, 'papillary': 0.8 }, pulse: ['ventricle'] },
    eating: { cat: 'activity', name: 'Eating', hr: 78, bp: [120, 78], spo2: 98, arousal: 0.4,
        desc: 'After a meal, blood is redirected to the digestive tract and the heart rate rises modestly to keep the rest of the body supplied.',
        levels: { 'left ventricle': 0.6, 'right ventricle': 0.55, 'left atrium': 0.55, 'right atrium': 0.55 }, pulse: [] },
    standing: { cat: 'activity', name: 'Standing Up', hr: 92, bp: [110, 75], spo2: 98, arousal: 0.55,
        desc: 'Gravity pulls blood toward the legs. Baroreceptors react within seconds, nudging up heart rate and tone so blood still reaches the brain — the orthostatic response.',
        levels: { 'left ventricle': 0.7, 'right ventricle': 0.6, 'right atrium': 0.6, 'left atrium': 0.6 }, pulse: [] },
};

export class HeartActivity {
    constructor(scene, idToMesh, regions) {
        this.scene = scene;
        this.idToMesh = idToMesh;
        this.regions = regions;
        this.active = 'rest';
        this._t = 0;

        // cardiac cycle
        this.hr = 65; this.hrTgt = 65;
        this.rr = 1; this.irregular = false; this.mi = false;
        this._beatT = 0; this.beatPhase = 0; this.contraction = 0;

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
        this.hrTgt = s.hr;
        this.irregular = !!s.irregular;
        this.mi = !!s.mi;
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

    /** ventricular contraction envelope for a given beat phase (0..1) */
    _contractionAt(phase) {
        const d = phase - 0.40;
        return Math.exp(-(d * d) / (2 * 0.085 * 0.085));
    }

    update(dt) {
        this._t += dt;

        // advance the cardiac cycle
        this.hr += (this.hrTgt - this.hr) * Math.min(1, dt * 2.5);
        const period = (60 / Math.max(20, this.hr)) * this.rr;
        this._beatT += dt;
        if (this._beatT >= period) {
            this._beatT -= period;
            this.rr = this.irregular ? (0.55 + Math.abs(Math.sin(this._t * 12.9)) * 1.05) : 1;
        }
        this.beatPhase = this._beatT / period;
        this.contraction = this._contractionAt(this.beatPhase);

        const k = Math.min(1, dt * 4);
        for (const [, st] of this.state) {
            st.curLevel += (st.tgtLevel - st.curLevel) * k;
            st.curCol.lerp(st.tgtCol, k);
            st.curGlow += (st.tgtGlow - st.curGlow) * k;

            const mat = st.mesh.material;
            mat.color.copy(st.curCol);
            const shimmer = 0.05 * (0.5 + 0.5 * Math.sin(this._t * 1.6 + st.phase));
            let glow = st.curGlow * 0.7 + shimmer;
            // every part throbs gently with the live heartbeat
            glow += this.contraction * 0.28;
            if (st.pulsing) glow += 0.5 * this.contraction + 0.25 * (0.5 + 0.5 * Math.sin(this._t * 6));
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

    /** live averaged activity per system, for the telemetry dashboard */
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
