/**
 * EyeActivity - visual-response heatmap + live ocular behaviour for the eye atlas.
 *
 * Mirrors the other organs' activity managers (heat-colour tween, shimmer,
 * pulse), but instead of a beat/breath cycle it owns the eye's living state:
 * pupil diameter (mm), lens accommodation (0..1) and gaze direction {x,y} with
 * idle micro-saccades. The app rotates the eyeball from `gaze`; the telemetry
 * reads pupil/accommodation and the per-muscle levels.
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

// pupil (mm), light label, focus label, accom (0..1), gaze {x,y} in -1..1,
// saccade (idle micro-movements), levels keyed by part-name substrings.
export const SCENARIOS = {
    rest: { cat: 'concept', name: 'Relaxed Gaze', pupil: 3.8, light: 'normal', focus: 'far', accom: 0.1,
        gaze: { x: 0, y: 0 }, saccade: true, arousal: 0.18,
        desc: 'Looking calmly into the distance in normal light. The pupil sits around 3–4 mm, the lens is relaxed and flat, and the eye makes tiny involuntary flicks (micro-saccades) to stop the image fading.',
        levels: {}, pulse: [] },
    bright: { cat: 'concept', name: 'Bright Light', pupil: 2.1, light: 'bright', focus: 'far', accom: 0.1,
        gaze: { x: 0, y: 0 }, arousal: 0.7,
        desc: 'In bright light the iris constricts the pupil to about 2 mm, cutting the light reaching the retina to protect it and sharpen focus — the pupillary light reflex.',
        levels: { 'iris': 1.0, 'anterior segment': 0.5 }, pulse: ['iris'] },
    dark: { cat: 'concept', name: 'Darkness', pupil: 7.2, light: 'dim', focus: 'far', accom: 0.1,
        gaze: { x: 0, y: 0 }, arousal: 0.5,
        desc: 'In the dark the iris widens the pupil to around 7–8 mm to gather every available photon. Vision shifts to the retina\'s rod cells, which are far more light-sensitive than the colour-seeing cones.',
        levels: { 'iris': 0.85 }, pulse: ['iris'] },
    near: { cat: 'concept', name: 'Near Focus', pupil: 3.0, light: 'normal', focus: 'near', accom: 1.0,
        gaze: { x: 0, y: 0 }, arousal: 0.6,
        desc: 'Focusing on something close triggers the "near triad": the lens fattens (accommodation), the pupil narrows, and both eyes turn inward (convergence) using the medial rectus muscles.',
        levels: { 'lens': 1.0, 'iris': 0.6, 'medial rectus': 0.7 }, pulse: ['lens'] },

    left: { cat: 'activity', name: 'Look Left', pupil: 3.6, light: 'normal', focus: 'mid', accom: 0.2,
        gaze: { x: -1, y: 0 }, arousal: 0.6,
        desc: 'Turning this right eye toward the nose (adduction) is driven mainly by the medial rectus muscle, while the lateral rectus relaxes.',
        levels: { 'medial rectus': 1.0, 'lateral rectus': 0.08 }, pulse: ['medial rectus'] },
    right: { cat: 'activity', name: 'Look Right', pupil: 3.6, light: 'normal', focus: 'mid', accom: 0.2,
        gaze: { x: 1, y: 0 }, arousal: 0.6,
        desc: 'Turning this right eye outward, away from the nose (abduction), is driven by the lateral rectus muscle via the abducens nerve.',
        levels: { 'lateral rectus': 1.0, 'medial rectus': 0.08 }, pulse: ['lateral rectus'] },
    up: { cat: 'activity', name: 'Look Up', pupil: 3.6, light: 'normal', focus: 'mid', accom: 0.2,
        gaze: { x: 0, y: 1 }, arousal: 0.6,
        desc: 'Raising the gaze (elevation) combines the superior rectus, which lifts the eye, with the inferior oblique, which keeps it from rolling.',
        levels: { 'superior rectus': 1.0, 'inferior oblique': 0.8, 'levator': 0.6 }, pulse: ['superior rectus'] },
    down: { cat: 'activity', name: 'Look Down', pupil: 3.6, light: 'normal', focus: 'mid', accom: 0.2,
        gaze: { x: 0, y: -1 }, arousal: 0.6,
        desc: 'Lowering the gaze (depression) combines the inferior rectus, which pulls the eye down, with the superior oblique, which steadies the roll.',
        levels: { 'inferior rectus': 1.0, 'superior oblique': 0.8 }, pulse: ['inferior rectus'] },
    reading: { cat: 'activity', name: 'Reading', pupil: 3.2, light: 'normal', focus: 'near', accom: 0.7,
        gaze: { x: 0.25, y: -0.2 }, saccade: true, arousal: 0.5,
        desc: 'Reading is a rapid string of small jumps (saccades) along a line with brief pauses to take in words, while the lens holds a near focus and the pupil sits slightly small.',
        levels: { 'lens': 0.7, 'medial rectus': 0.5, 'lateral rectus': 0.5, 'iris': 0.4 }, pulse: [] },
};

export class EyeActivity {
    constructor(scene, idToMesh, regions) {
        this.scene = scene;
        this.idToMesh = idToMesh;
        this.regions = regions;
        this.active = 'rest';
        this._t = 0;

        // ocular state
        this.pupil = 3.8; this.pupilTgt = 3.8;
        this.accom = 0.1; this.accomTgt = 0.1;
        this.gaze = { x: 0, y: 0 };
        this.gazeBase = { x: 0, y: 0 };
        this.gazeTgt = { x: 0, y: 0 };
        this.saccade = true; this._sacT = 0;
        this.light = 'normal'; this.focus = 'far';

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
        this.pupilTgt = s.pupil;
        this.accomTgt = s.accom != null ? s.accom : 0.1;
        this.light = s.light || 'normal';
        this.focus = s.focus || 'far';
        this.saccade = !!s.saccade;
        this.gazeBase = { x: s.gaze ? s.gaze.x : 0, y: s.gaze ? s.gaze.y : 0 };
        this.gazeTgt = { ...this.gazeBase };
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

    update(dt) {
        this._t += dt;
        this.pupil += (this.pupilTgt - this.pupil) * Math.min(1, dt * 3);
        this.accom += (this.accomTgt - this.accom) * Math.min(1, dt * 3);

        // idle micro-saccades: re-aim the gaze around the base point now and then
        if (this.saccade) {
            this._sacT += dt;
            if (this._sacT > 0.85) {
                this._sacT = 0;
                this.gazeTgt = {
                    x: this.gazeBase.x + (Math.random() - 0.5) * 0.5,
                    y: this.gazeBase.y + (Math.random() - 0.5) * 0.35,
                };
            }
        } else {
            this.gazeTgt = { ...this.gazeBase };
        }
        const gk = Math.min(1, dt * (this.saccade ? 14 : 6));
        this.gaze.x += (this.gazeTgt.x - this.gaze.x) * gk;
        this.gaze.y += (this.gazeTgt.y - this.gaze.y) * gk;

        const k = Math.min(1, dt * 4);
        for (const [, st] of this.state) {
            st.curLevel += (st.tgtLevel - st.curLevel) * k;
            st.curCol.lerp(st.tgtCol, k);
            st.curGlow += (st.tgtGlow - st.curGlow) * k;

            const mat = st.mesh.material;
            mat.color.copy(st.curCol);
            const shimmer = 0.05 * (0.5 + 0.5 * Math.sin(this._t * 1.6 + st.phase));
            let glow = st.curGlow * 0.7 + shimmer;
            if (st.pulsing) glow += 0.5 * (0.5 + 0.5 * Math.sin(this._t * 5));
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
