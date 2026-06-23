/**
 * EarActivity - sound-conduction heatmap + live auditory behaviour for the ear atlas.
 *
 * Mirrors the other organs' activity managers (heat-colour tween, shimmer,
 * pulse, flash), but instead of a beat/breath cycle it owns the ear's living
 * state: loudness (dB), perceived frequency (low/mid/high), a balance level for
 * the vestibule, and a `vibration` (0..1) that the app uses to buzz the
 * ossicle chain (eardrum -> malleus -> incus -> stapes -> cochlea) as a
 * travelling wave. The telemetry reads loudness/frequency/balance and the
 * per-system levels.
 *
 * Scientifically-informed dramatisation for learning, not a biophysical sim.
 */

import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

const STOPS = [
    [0.00, new THREE.Color(0.16, 0.36, 0.62)],
    [0.25, new THREE.Color(0.20, 0.62, 0.66)],
    [0.50, new THREE.Color(0.62, 0.60, 0.45)],
    [0.75, new THREE.Color(0.97, 0.66, 0.16)],
    [1.00, new THREE.Color(0.98, 0.32, 0.10)],
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

// db (loudness), freq (low|mid|high), balance (0..1), levels keyed by part-name
// substrings, pulse (parts that throb), and the conduction `chain` flag that
// makes the middle-ear bones buzz with the sound.
export const SCENARIOS = {
    rest: { cat: 'concept', name: 'Quiet Room', db: 30, freq: 'mid', balance: 0.12, chain: false,
        desc: 'A calm, quiet room (about 30 dB). The eardrum and ossicles barely move, the cochlea ticks over in the background, and the vestibule quietly keeps track of which way is up.',
        levels: {}, pulse: [] },
    speech: { cat: 'concept', name: 'Conversation', db: 60, freq: 'mid', balance: 0.12, chain: true,
        desc: 'Normal conversation sits around 60 dB in the mid frequencies. The eardrum vibrates, the three ossicles pass the motion along, and the speech region of the cochlea responds — exactly the band the concha is shaped to gather.',
        levels: { 'concha': 0.6, 'tympanic': 0.7, 'malleus': 0.7, 'incus': 0.7, 'stapes': 0.7, 'cochlea': 0.8 }, pulse: ['cochlea'] },
    loud: { cat: 'concept', name: 'Loud Noise', db: 95, freq: 'mid', balance: 0.15, chain: true,
        desc: 'A loud concert or power tool (about 95 dB) drives the whole conduction chain hard. Sustained exposure at this level can fatigue and damage the cochlea\'s hair cells — the most common cause of permanent hearing loss.',
        levels: { 'helix': 0.6, 'concha': 0.8, 'tympanic': 1.0, 'malleus': 1.0, 'incus': 1.0, 'stapes': 1.0, 'cochlea': 1.0 }, pulse: ['cochlea', 'tympanic'] },
    highpitch: { cat: 'concept', name: 'High Pitch', db: 65, freq: 'high', balance: 0.12, chain: true,
        desc: 'A high-pitched whistle or birdsong. High frequencies are picked up at the base of the cochlear spiral, near the oval window — the first stretch the incoming vibration reaches.',
        levels: { 'tympanic': 0.7, 'malleus': 0.7, 'incus': 0.8, 'stapes': 0.9, 'cochlea': 1.0 }, pulse: ['stapes', 'cochlea'] },
    lowpitch: { cat: 'concept', name: 'Low Pitch', db: 65, freq: 'low', balance: 0.12, chain: true,
        desc: 'A deep bass note or rumble. Low frequencies travel further along the cochlear spiral and are detected near its tip (apex) — the cochlea sorts pitch by position along its coil.',
        levels: { 'tympanic': 0.7, 'malleus': 0.7, 'incus': 0.7, 'stapes': 0.7, 'cochlea': 0.85 }, pulse: ['cochlea'] },

    music: { cat: 'activity', name: 'Listening to Music', db: 75, freq: 'mix', balance: 0.12, chain: true,
        desc: 'Music spans the whole frequency range at a moderate-to-loud level, so the full conduction chain works and sound lights up the cochlea from base to apex. Comfortable for short listens, but headphone volume adds up over a day.',
        levels: { 'concha': 0.6, 'tympanic': 0.8, 'malleus': 0.8, 'incus': 0.85, 'stapes': 0.9, 'cochlea': 1.0 }, pulse: ['cochlea'] },
    whisper: { cat: 'activity', name: 'Whisper', db: 25, freq: 'high', balance: 0.12, chain: true,
        desc: 'A faint whisper is near the limit of hearing. The eardrum and ossicles move only slightly, and you instinctively turn your ear toward the sound so the auricle can gather every bit of it.',
        levels: { 'helix': 0.5, 'concha': 0.7, 'tympanic': 0.4, 'malleus': 0.4, 'incus': 0.4, 'stapes': 0.45, 'cochlea': 0.55 }, pulse: [] },
    balance: { cat: 'activity', name: 'Head Turn · Balance', db: 35, freq: 'mid', balance: 1.0, chain: false,
        desc: 'Turning or tilting your head sets the inner-ear balance organ to work. The vestibule senses gravity and motion and reports your head\'s position to the brain, completely separate from hearing — though it shares the same fluid-filled inner ear.',
        levels: { 'vestibule': 1.0, 'cochlea': 0.4 }, pulse: ['vestibule'] },
    swallow: { cat: 'activity', name: 'Swallow · Yawn', db: 35, freq: 'mid', balance: 0.12, chain: false,
        desc: 'Swallowing or yawning briefly opens the Eustachian tube, letting air in or out to equalise the pressure behind the eardrum. This is the "ear pop" that clears the blocked feeling on a plane or in a lift.',
        levels: { 'auditory tube': 1.0, 'tympanic': 0.5 }, pulse: ['auditory tube'] },
};

export class EarActivity {
    constructor(scene, idToMesh, regions) {
        this.scene = scene;
        this.idToMesh = idToMesh;
        this.regions = regions;
        this.active = 'rest';
        this._t = 0;

        // auditory state
        this.db = 30; this.dbTgt = 30;
        this.balance = 0.12; this.balanceTgt = 0.12;
        this.freq = 'mid';
        this.chain = false;
        this.vibration = 0;          // 0..1, drives the ossicle-chain buzz in the app

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
        this.dbTgt = s.db != null ? s.db : 30;
        this.balanceTgt = s.balance != null ? s.balance : 0.12;
        this.freq = s.freq || 'mid';
        this.chain = !!s.chain;
        const heatMode = key !== 'rest';
        for (const [id, st] of this.state) {
            const lvl = heatMode ? this._levelFor(id, s.levels) : 0.5;
            st.tgtLevel = lvl;
            st.heatMode = heatMode;
            st.tgtCol = heatMode ? heat(lvl) : st.base.clone();
            st.tgtGlow = heatMode ? Math.abs(lvl - 0.5) * 2 : 0;
            st.pulsing = heatMode && s.pulse.some(p => id.toLowerCase().includes(p));
            st.flash = (heatMode && lvl >= 0.9) ? 2.0 : 0;
        }
    }

    clear() { this.apply('rest'); }

    update(dt) {
        this._t += dt;
        this.db += (this.dbTgt - this.db) * Math.min(1, dt * 3);
        this.balance += (this.balanceTgt - this.balance) * Math.min(1, dt * 3);
        // map ~20..100 dB onto 0..1 and only buzz when sound is actually conducting
        this.vibration = this.chain ? Math.max(0, Math.min(1, (this.db - 20) / 80)) : 0;

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
