// InstanceState.js — Serializable snapshot of a single sampler instance.
// Defaults match the HTML attribute values in index.html.

export class InstanceState {
    constructor(name = 'Untitled') {
        this.name = name;
        this.id = (crypto.randomUUID?.() ??
            (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11)));

        // --- Sample reference (not the AudioBuffer itself) ---
        this.sampleUrl = null;
        this.sampleFileName = null;
        this.sampleDisplayName = 'No sample loaded';

        // --- Grain parameters (mirrors ParameterPanel.getParams()) ---
        this.grainSizeMin = 0.8674;
        this.grainSizeMax = 0.8674;
        this.densityMin = 0.651;
        this.densityMax = 0.651;
        this.spreadMin = 0;
        this.spreadMax = 0;
        this.pan = 0;
        this.volume = 0.7;
        this.envelope = 'custom';
        this.mappings = {
            pressure: 'none',
            contactSize: 'none',
            velocity: 'none',
        };

        // --- Musical parameters (mirrors ParameterPanel.getMusicalParams()) ---
        // Note: BPM is global (master tempo), not per-instance.
        this.rootNote = 0;
        this.scale = 'chromatic';
        this.quantizeGrainSize = false;
        this.quantizeDensity = false;
        this.quantizePitch = false;
        this.randomGrainSize = false;
        this.randomDensity = false;
        this.randomPitch = false;
        this.arpPattern = 'random';   // 'random' or 'arpeggiator'
        this.arpSteps = 4;            // number of notes in arp cycle (3–6)
        this.arpType = 'straight';    // 'straight' or 'looped'
        this.arpStyle = 0;            // permutation index (0..N!-1)
        this.arpCustomPattern = null; // null = use permutation, or { values: number[], muted: boolean[] }
        this.pitchRange = 2;

        // --- ADSR envelope state ---
        this.adsr = { a: 0.2, d: 0.15, s: 0.7, r: 0.2 };
    }

    toJSON() {
        return {
            ...this,
            adsr: { ...this.adsr },
            mappings: { ...this.mappings },
            arpCustomPattern: this.arpCustomPattern ? {
                values: [...this.arpCustomPattern.values],
                muted: [...this.arpCustomPattern.muted],
            } : null,
        };
    }

    static fromJSON(data) {
        const state = new InstanceState();
        return Object.assign(state, data);
    }
}
