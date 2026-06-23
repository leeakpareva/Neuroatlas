/**
 * GutActivity - digestive-transit heatmap + live bowel behaviour for GutAtlas.
 *
 * Mirrors the other organs' activity managers (heat-colour tween, shimmer,
 * pulse, flash) but instead of a beat/breath cycle it owns the gut's living
 * state: motility (0..1 peristalsis strength), hydration (0..1 water reclaimed)
 * and a transit label. The app uses `motility` to send a peristaltic wave down
 * the colon segments. The telemetry reads motility/hydration and per-segment
 * transit.
 *
 * Scientifically-informed dramatisation for learning, not a biophysical sim.
 */

import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

const STOPS = [
    [0.00, new THREE.Color(0.20, 0.40, 0.66)],
    [0.25, new THREE.Color(0.30, 0.62, 0.55)],
    [0.50, new THREE.Color(0.66, 0.58, 0.40)],
    [0.75, new THREE.Color(0.97, 0.55, 0.18)],
    [1.00, new THREE.Color(0.90, 0.22, 0.10)],
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

// motility (0..1), hydration (0..1), transit label, levels keyed by part-name
// substrings, pulse (parts that throb).
export const SCENARIOS = {
    rest: { cat: 'concept', name: 'Resting', motility: 0.15, hydration: 0.6, transit: 'normal',
        desc: 'Between meals the gut ticks over with slow background contractions. The colon quietly reclaims water and the microbiome ferments yesterday\'s fibre. Things move along at a gentle, steady pace.',
        levels: {}, pulse: [] },
    meal: { cat: 'concept', name: 'After Eating', motility: 0.75, hydration: 0.55, transit: 'normal',
        desc: 'Eating triggers the gastrocolic reflex: the stomach filling tells the colon to push its contents onward, which is why a meal often prompts the urge to go. Motility rises right along the tract.',
        levels: { 'duodenum': 0.8, 'ascending': 0.8, 'transverse': 0.8, 'descending': 0.7, 'sigmoid': 0.6 }, pulse: ['transverse'] },
    fibre: { cat: 'concept', name: 'High-Fibre Meal', motility: 0.65, hydration: 0.65, transit: 'normal',
        desc: 'Fibre adds bulk and feeds the gut bacteria, which ferment it into short-chain fatty acids that nourish the colon wall. Healthy transit, softer stool and a thriving microbiome — the goal for gut health.',
        levels: { 'ascending': 0.9, 'transverse': 0.9, 'descending': 0.8, 'sigmoid': 0.7 }, pulse: ['ascending', 'transverse'] },
    hydrated: { cat: 'concept', name: 'Well Hydrated', motility: 0.5, hydration: 0.5, transit: 'normal',
        desc: 'With enough water the colon doesn\'t need to wring the stool dry, so it stays soft and passes easily. Hydration and fibre together are the simplest levers for comfortable, regular bowels.',
        levels: { 'descending': 0.6, 'sigmoid': 0.6 }, pulse: [] },

    peristalsis: { cat: 'activity', name: 'Peristalsis Wave', motility: 1.0, hydration: 0.55, transit: 'normal',
        desc: 'A wave of muscle contraction sweeps along the colon — ascending, transverse, descending, sigmoid — squeezing contents forward like toothpaste in a tube. This is peristalsis, the engine of the whole digestive tract.',
        levels: { 'ascending': 1.0, 'transverse': 1.0, 'descending': 1.0, 'sigmoid': 1.0 }, pulse: ['ascending', 'transverse', 'descending', 'sigmoid'] },
    slow: { cat: 'activity', name: 'Slow Transit', motility: 0.1, hydration: 0.95, transit: 'slow',
        desc: 'When motility drops (low fibre, dehydration, inactivity) waste lingers and the colon keeps reclaiming water, leaving stool hard and dry — constipation. More fibre, water and movement usually get things going again.',
        levels: { 'descending': 0.7, 'sigmoid': 0.85 }, pulse: ['sigmoid'] },
    fast: { cat: 'activity', name: 'Fast Transit', motility: 1.0, hydration: 0.2, transit: 'fast',
        desc: 'When contents rush through too quickly the colon can\'t reclaim enough water, so stool stays loose — diarrhoea. Common with infection or irritation; the main risk is dehydration, so fluids matter.',
        levels: { 'ascending': 0.9, 'transverse': 1.0, 'descending': 1.0, 'sigmoid': 0.9 }, pulse: ['transverse', 'descending'] },
    appendicitis: { cat: 'activity', name: 'Appendicitis', motility: 0.3, hydration: 0.6, transit: 'normal',
        desc: 'If the appendix gets blocked it swells, inflames and can burst — appendicitis. The classic sign is pain that starts near the navel then settles sharply in the lower right abdomen. It is a surgical emergency.',
        levels: { 'appendix': 1.0, 'ascending': 0.6 }, pulse: ['appendix'] },
};

export class GutActivity {
    constructor(scene, idToMesh, regions) {
        this.scene = scene;
        this.idToMesh = idToMesh;
        this.regions = regions;
        this.active = 'rest';
        this._t = 0;

        // digestive state
        this.motility = 0.15; this.motilityTgt = 0.15;
        this.hydration = 0.6; this.hydrationTgt = 0.6;
        this.transit = 'normal';

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
        this.motilityTgt = s.motility != null ? s.motility : 0.15;
        this.hydrationTgt = s.hydration != null ? s.hydration : 0.6;
        this.transit = s.transit || 'normal';
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
        const ease = Math.min(1, dt * 2.4);
        this.motility += (this.motilityTgt - this.motility) * ease;
        this.hydration += (this.hydrationTgt - this.hydration) * ease;

        const k = Math.min(1, dt * 4);
        for (const [, st] of this.state) {
            st.curLevel += (st.tgtLevel - st.curLevel) * k;
            st.curCol.lerp(st.tgtCol, k);
            st.curGlow += (st.tgtGlow - st.curGlow) * k;

            const mat = st.mesh.material;
            mat.color.copy(st.curCol);
            const shimmer = 0.05 * (0.5 + 0.5 * Math.sin(this._t * 1.6 + st.phase));
            let glow = st.curGlow * 0.7 + shimmer;
            if (st.pulsing) glow += 0.5 * (0.5 + 0.5 * Math.sin(this._t * 3.5));
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
