/**
 * GlucoActivity - metabolic heatmap + live blood-sugar behaviour for GlucoAtlas.
 *
 * Mirrors the other organs' activity managers (heat-colour tween, shimmer,
 * pulse, flash) but instead of a beat/breath cycle it owns the body's glucose
 * state: blood glucose (mg/dL), the pancreatic hormones insulin & glucagon,
 * the incretin GLP-1, and a `peristalsis` (0..1) digestion intensity. The app
 * uses `peristalsis` to ripple the stomach & duodenum and `insulin` to pulse
 * the pancreas as its islets release.
 *
 * Scientifically-informed dramatisation for learning, not a biophysical sim.
 */

import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

const STOPS = [
    [0.00, new THREE.Color(0.16, 0.42, 0.66)],
    [0.25, new THREE.Color(0.22, 0.64, 0.60)],
    [0.50, new THREE.Color(0.62, 0.58, 0.48)],
    [0.75, new THREE.Color(0.93, 0.50, 0.30)],
    [1.00, new THREE.Color(0.92, 0.16, 0.45)],
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

// glucose (mg/dL), insulin/glucagon/glp1 (0..1), peristalsis (0..1 digestion),
// levels keyed by part-name substrings, pulse (parts that throb).
export const SCENARIOS = {
    rest: { cat: 'concept', name: 'Fasting', glucose: 85, insulin: 0.15, glucagon: 0.55, glp1: 0.1, peristalsis: 0.1,
        desc: 'Between meals or overnight, blood sugar sits steady around 85 mg/dL. Insulin is low and glucagon nudges the liver to trickle stored glucose back into the blood, so you stay fuelled without eating.',
        levels: { 'liver': 0.65, 'pancreas': 0.55 }, pulse: [] },
    meal: { cat: 'concept', name: 'After a Meal', glucose: 140, insulin: 0.8, glucagon: 0.2, glp1: 0.7, peristalsis: 0.7,
        desc: 'A balanced meal pushes blood sugar up toward 140 mg/dL. The stomach and duodenum digest, GLP-1 primes the pancreas, and a surge of insulin moves the glucose into cells and the liver — bringing it back down within a couple of hours.',
        levels: { 'stomach': 0.8, 'duodenum': 0.85, 'pancreas': 1.0, 'liver': 0.8, 'gallbladder': 0.5 }, pulse: ['pancreas'] },
    sugary: { cat: 'concept', name: 'Sugary Drink', glucose: 180, insulin: 1.0, glucagon: 0.12, glp1: 0.5, peristalsis: 0.4,
        desc: 'A sugary drink has little to slow it down, so blood sugar spikes fast — often past 180 mg/dL. The pancreas answers with a big insulin burst. Repeated sharp spikes like this are what steady, fibre-rich meals help avoid.',
        levels: { 'stomach': 0.6, 'duodenum': 0.7, 'pancreas': 1.0, 'liver': 0.9 }, pulse: ['pancreas'] },
    exercise: { cat: 'concept', name: 'Exercise', glucose: 75, insulin: 0.2, glucagon: 0.7, glp1: 0.1, peristalsis: 0.1,
        desc: 'Working muscles pull glucose from the blood without needing much insulin, so levels drift down. Glucagon rises and the liver releases stored glucose to keep up — which is why exercise is such a powerful way to manage blood sugar.',
        levels: { 'liver': 0.9, 'pancreas': 0.6 }, pulse: ['liver'] },

    digesting: { cat: 'activity', name: 'Digesting', glucose: 120, insulin: 0.6, glucagon: 0.2, glp1: 0.8, peristalsis: 1.0,
        desc: 'Food moves by waves of muscle (peristalsis) from the stomach into the duodenum, where bile from the gallbladder and enzymes from the pancreas finish the job. Sugars are absorbed steadily into the blood.',
        levels: { 'stomach': 1.0, 'duodenum': 1.0, 'gallbladder': 0.9, 'pancreas': 0.7 }, pulse: ['stomach', 'duodenum'] },
    insulinResp: { cat: 'activity', name: 'Insulin Response', glucose: 110, insulin: 1.0, glucagon: 0.1, glp1: 0.4, peristalsis: 0.2,
        desc: 'The pancreas\'s islets release insulin, the key that lets glucose enter cells. The liver soaks up the surplus as glycogen and blood sugar falls back toward normal. This feedback loop runs every time you eat.',
        levels: { 'pancreas': 1.0, 'liver': 0.85 }, pulse: ['pancreas'] },
    hypo: { cat: 'activity', name: 'Low Blood Sugar', glucose: 58, insulin: 0.05, glucagon: 1.0, glp1: 0.1, peristalsis: 0.1,
        desc: 'When glucose drops too low (hypoglycaemia, under ~70 mg/dL) the body acts fast: insulin shuts off and glucagon spikes, driving the liver to dump glucose into the blood. It can cause shakiness and confusion until levels recover.',
        levels: { 'pancreas': 0.8, 'liver': 1.0 }, pulse: ['liver'] },
    diabetes: { cat: 'activity', name: 'High · Unmanaged', glucose: 250, insulin: 0.25, glucagon: 0.4, glp1: 0.3, peristalsis: 0.3,
        desc: 'In unmanaged diabetes the pancreas can\'t make enough insulin, or the body stops responding to it, so glucose stays high (here 250 mg/dL). Sugar builds up in the blood instead of fuelling cells — over years this damages nerves, eyes, kidneys and vessels.',
        levels: { 'pancreas': 1.0, 'liver': 0.7, 'stomach': 0.4 }, pulse: ['pancreas'] },
};

export class GlucoActivity {
    constructor(scene, idToMesh, regions) {
        this.scene = scene;
        this.idToMesh = idToMesh;
        this.regions = regions;
        this.active = 'rest';
        this._t = 0;

        // metabolic state
        this.glucose = 85; this.glucoseTgt = 85;
        this.insulin = 0.15; this.insulinTgt = 0.15;
        this.glucagon = 0.55; this.glucagonTgt = 0.55;
        this.glp1 = 0.1; this.glp1Tgt = 0.1;
        this.peristalsis = 0.1; this.peristalsisTgt = 0.1;

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
        this.glucoseTgt = s.glucose != null ? s.glucose : 85;
        this.insulinTgt = s.insulin != null ? s.insulin : 0.15;
        this.glucagonTgt = s.glucagon != null ? s.glucagon : 0.55;
        this.glp1Tgt = s.glp1 != null ? s.glp1 : 0.1;
        this.peristalsisTgt = s.peristalsis != null ? s.peristalsis : 0.1;
        const heatMode = key !== 'rest';
        for (const [id, st] of this.state) {
            const lvl = heatMode ? this._levelFor(id, s.levels) : 0.5;
            st.tgtLevel = lvl;
            st.heatMode = heatMode;
            st.tgtCol = heatMode ? heat(lvl) : st.base.clone();
            st.tgtGlow = heatMode ? Math.abs(lvl - 0.5) * 2 : 0;
            st.pulsing = heatMode && s.pulse.some(p => id.toLowerCase().includes(p));
            st.flash = (heatMode && lvl >= 0.95) ? 2.0 : 0;
        }
    }

    clear() { this.apply('rest'); }

    update(dt) {
        this._t += dt;
        const ease = Math.min(1, dt * 2.2);
        this.glucose += (this.glucoseTgt - this.glucose) * ease;
        this.insulin += (this.insulinTgt - this.insulin) * ease;
        this.glucagon += (this.glucagonTgt - this.glucagon) * ease;
        this.glp1 += (this.glp1Tgt - this.glp1) * ease;
        this.peristalsis += (this.peristalsisTgt - this.peristalsis) * ease;

        const k = Math.min(1, dt * 4);
        for (const [, st] of this.state) {
            st.curLevel += (st.tgtLevel - st.curLevel) * k;
            st.curCol.lerp(st.tgtCol, k);
            st.curGlow += (st.tgtGlow - st.curGlow) * k;

            const mat = st.mesh.material;
            mat.color.copy(st.curCol);
            const shimmer = 0.05 * (0.5 + 0.5 * Math.sin(this._t * 1.6 + st.phase));
            let glow = st.curGlow * 0.7 + shimmer;
            if (st.pulsing) glow += 0.5 * (0.5 + 0.5 * Math.sin(this._t * 4));
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
