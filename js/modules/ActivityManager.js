/**
 * ActivityManager - Scenario-driven activity heatmap + NAVADA_9 ErrP overlay.
 *
 * - Smoothly tweens each region between anatomy colour (rest) and a heatmap
 *   colour (active scenario).
 * - Adds a subtle idle "neural shimmer" so the brain always feels alive.
 * - Pulses hyperactive regions and animates the ErrP signal path to the
 *   mastoid sensor for the NAVADA_9 scenario.
 * - Exposes live per-system activity for the telemetry dashboard.
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

export const SCENARIOS = {
    rest:  { cat: 'concept', name: 'Resting State', arousal: 0.15,
        desc: 'A calm, awake baseline — the reference every other state is compared against.', levels: {}, pulse: [] },
    errp:  { cat: 'concept', name: 'NAVADA_9 · Error Signal', arousal: 0.95, confidence: 98.6, latency: 290,
        desc: 'An autonomous system made a decision the brain judged wrong. The anterior cingulate fires an involuntary ErrP within ~250 ms; NAVADA_9 detects it at the mastoid and corrects the machine before you could press a button.',
        levels: { anteriorCingulate: 1.0, frontalLobe: 0.74, thalamus: 0.62, insula: 0.68, putamen: 0.58 }, pulse: ['anteriorCingulate'], path: true },
    sleep: { cat: 'concept', name: 'Sleep Deprivation', arousal: 0.55,
        desc: 'After no sleep the prefrontal cortex is suppressed (poor judgement), the amygdala runs hot (over-reaction) and the hippocampus underperforms (weak memory).',
        levels: { frontalLobe: 0.24, amygdala: 0.92, hippocampus: 0.30, thalamus: 0.40, hypothalamus: 0.72, occipitalLobe: 0.45 }, pulse: ['amygdala'] },
    focus: { cat: 'concept', name: 'Deep Focus', arousal: 0.6, confidence: 70, latency: 420,
        desc: 'Sustained attention. The fronto-parietal attention network is highly engaged and the anterior cingulate monitors for errors.',
        levels: { frontalLobe: 0.88, parietalLobe: 0.82, anteriorCingulate: 0.70, occipitalLobe: 0.64, caudate: 0.66 }, pulse: [] },

    music: { cat: 'activity', name: 'Listening to Music', arousal: 0.45,
        desc: 'Auditory cortex in the temporal lobes processes sound; the limbic system adds emotion and the cerebellum tracks rhythm.',
        levels: { temporalLobe: 0.9, occipitalLobe: 0.45, cerebellum: 0.7, amygdala: 0.65, hippocampus: 0.6 }, pulse: [] },
    exercise: { cat: 'activity', name: 'Exercise / Movement', arousal: 0.8,
        desc: 'The motor and cerebellar systems drive and coordinate movement; the brainstem ramps up heart rate and breathing.',
        levels: { cerebellum: 0.95, frontalLobe: 0.7, putamen: 0.85, globusPallidus: 0.8, midbrain: 0.75, pons: 0.7, medulla: 0.8 }, pulse: [] },
    reading: { cat: 'activity', name: 'Reading', arousal: 0.5,
        desc: 'Visual cortex decodes letters, the left temporal lobe handles language, and the frontal lobe builds meaning.',
        levels: { occipitalLobe: 0.9, temporalLobe: 0.82, frontalLobe: 0.7, parietalLobe: 0.6 }, pulse: [] },
    eating: { cat: 'activity', name: 'Eating', arousal: 0.45,
        desc: 'The insula registers taste and gut state, the hypothalamus tracks hunger and fullness, and reward circuits respond.',
        levels: { insula: 0.9, hypothalamus: 0.88, amygdala: 0.55, caudate: 0.6, brainstem: 0.55 }, pulse: [] },
    meditation: { cat: 'activity', name: 'Meditation', arousal: 0.2,
        desc: 'A calm, controlled state: the amygdala quietens, the prefrontal cortex steadies attention and arousal drops.',
        levels: { amygdala: 0.2, frontalLobe: 0.6, anteriorCingulate: 0.55, parietalLobe: 0.35, thalamus: 0.4 }, pulse: [] },
    stress: { cat: 'activity', name: 'Stress / Fear', arousal: 0.9,
        desc: 'The amygdala drives the threat response, the hypothalamus triggers fight-or-flight, and rational frontal control drops.',
        levels: { amygdala: 1.0, hypothalamus: 0.9, anteriorCingulate: 0.8, frontalLobe: 0.35, insula: 0.75 }, pulse: ['amygdala'] },
};

export class ActivityManager {
    constructor(scene, idToMesh, regions) {
        this.scene = scene;
        this.idToMesh = idToMesh;
        this.regions = regions;
        this.active = 'rest';
        this.overlay = null;
        this._t = 0;

        // per-region tween state
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
        let lvl = 0.5;
        for (const key in levels) if (id.includes(key)) lvl = levels[key];
        return lvl;
    }

    apply(key) {
        const s = SCENARIOS[key];
        if (!s) return;
        this.active = key;
        const heatMode = key !== 'rest';
        for (const [id, st] of this.state) {
            const lvl = heatMode ? this._levelFor(id, s.levels) : 0.5;
            st.tgtLevel = lvl;
            st.heatMode = heatMode;
            st.tgtCol = heatMode ? heat(lvl) : st.base.clone();
            st.tgtGlow = heatMode ? Math.abs(lvl - 0.5) * 2 : 0;
            st.pulsing = heatMode && s.pulse.some(p => id.includes(p));
            // flash the strongly-involved regions so the response is obvious
            st.flash = (heatMode && lvl >= 0.7) ? 2.0 : 0;
        }
        this._removeOverlay();
        if (s.path) this._buildErrpPath();
    }

    clear() { this.apply('rest'); }

    update(dt) {
        this._t += dt;
        const k = Math.min(1, dt * 4);
        for (const [, st] of this.state) {
            st.curLevel += (st.tgtLevel - st.curLevel) * k;
            st.curCol.lerp(st.tgtCol, k);
            st.curGlow += (st.tgtGlow - st.curGlow) * k;

            const mat = st.mesh.material;
            mat.color.copy(st.curCol);
            const shimmer = 0.05 * (0.5 + 0.5 * Math.sin(this._t * 1.6 + st.phase));
            let glow = st.curGlow * 0.7 + shimmer;
            if (st.pulsing) glow += 0.6 * (0.5 + 0.5 * Math.sin(this._t * 6));
            mat.emissive.copy(st.heatMode ? st.curCol : st.base);
            // flash burst when an activity is first selected
            if (st.flash > 0) {
                st.flash = Math.max(0, st.flash - dt);
                const osc = 0.5 + 0.5 * Math.sin(this._t * 18);
                glow += st.flash * (0.9 + osc * 1.6);
                mat.emissive.lerp(WHITE, st.flash * 0.5 * osc);
            }
            mat.emissiveIntensity = glow;
        }
        if (this.overlay) {
            const tt = (this._t * 0.85) % 1;
            this.overlay.pulse.position.lerpVectors(this.overlay.a, this.overlay.b, tt);
            const fade = Math.sin(tt * Math.PI);
            this.overlay.pulse.material.opacity = fade;
            this.overlay.pulse.scale.setScalar(0.04 + fade * 0.05);
            this.overlay.sensor.material.emissiveIntensity = 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(this._t * 4));
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

    // ---- ErrP overlay ----
    _accCentre() {
        const box = new THREE.Box3(), c = new THREE.Vector3(); let n = 0;
        for (const [id, mesh] of this.idToMesh) if (id.includes('anteriorCingulate')) {
            box.setFromObject(mesh); c.add(box.getCenter(new THREE.Vector3())); n++;
        }
        if (n) c.multiplyScalar(1 / n);
        return c;
    }
    _brainBox() { const b = new THREE.Box3(); for (const [, m] of this.idToMesh) b.expandByObject(m); return b; }

    _buildErrpPath() {
        const acc = this._accCentre();
        const box = this._brainBox();
        const size = box.getSize(new THREE.Vector3());
        const ctr = box.getCenter(new THREE.Vector3());
        const sensorPos = new THREE.Vector3(ctr.x + size.x * 0.78, ctr.y - size.y * 0.34, ctr.z - size.z * 0.28);
        const group = new THREE.Group();

        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([acc, sensorPos]),
            new THREE.LineBasicMaterial({ color: 0xff1ad9, transparent: true, opacity: 0.55 }));
        group.add(line);

        const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 24),
            new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0x35e0ff, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 }));
        sensor.position.copy(sensorPos);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 12, 32),
            new THREE.MeshStandardMaterial({ color: 0x35e0ff, emissive: 0x35e0ff, emissiveIntensity: 0.7 }));
        ring.position.copy(sensorPos); ring.lookAt(ctr);
        group.add(sensor); group.add(ring);

        const pulse = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xff5ae6, transparent: true, opacity: 1 }));
        pulse.scale.setScalar(0.05); group.add(pulse);

        this.scene.add(group);
        this.overlay = { group, a: acc.clone(), b: sensorPos.clone(), pulse, sensor };
    }
    _removeOverlay() {
        if (!this.overlay) return;
        this.scene.remove(this.overlay.group);
        this.overlay.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.overlay = null;
    }
}
