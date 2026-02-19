// musicalQuantizer.js — Musical pitch quantization and BPM subdivision utilities.

/** Note names for display (sharps notation). */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Scale intervals in semitones from root. */
export const SCALES = {
    chromatic:      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major:          [0, 2, 4, 5, 7, 9, 11],
    minor:          [0, 2, 3, 5, 7, 8, 10],
    dorian:         [0, 2, 3, 5, 7, 9, 10],
    phrygian:       [0, 1, 3, 5, 7, 8, 10],
    lydian:         [0, 2, 4, 6, 7, 9, 11],
    mixolydian:     [0, 2, 4, 5, 7, 9, 10],
    locrian:        [0, 1, 3, 5, 6, 8, 10],
    harmonicMinor:  [0, 2, 3, 5, 7, 8, 11],
    melodicMinor:   [0, 2, 3, 5, 7, 9, 11],
    pentatonic:     [0, 2, 4, 7, 9],
    minorPentatonic:[0, 3, 5, 7, 10],
    blues:          [0, 3, 5, 6, 7, 10],
    wholeTone:      [0, 2, 4, 6, 8, 10],
};

/**
 * Available rhythmic subdivisions as [label, divisor] pairs.
 * divisor = how many of this note fit in a whole note (4 beats).
 * interOnset = (60 / bpm) * (4 / divisor)
 *
 * Sorted slowest → fastest so normalizedToSubdivision maps 0→slow, 1→fast.
 * Triplets: 3 notes in the time of 2 (divisor × 1.5).
 * Sixth (sextuplet): 6 notes in the time of 4 (divisor × 1.5, same ratio).
 */
export const SUBDIVISIONS = [
    { label: '1/1',   divisor: 1 },
    { label: '1/2',   divisor: 2 },
    { label: '1/2T',  divisor: 3 },     // half-note triplet
    { label: '1/4',   divisor: 4 },
    { label: '1/4T',  divisor: 6 },     // quarter triplet (= sextuplet of half)
    { label: '1/8',   divisor: 8 },
    { label: '1/8T',  divisor: 12 },    // eighth triplet (= sextuplet of quarter)
    { label: '1/16',  divisor: 16 },
    { label: '1/16T', divisor: 24 },    // sixteenth triplet (= sextuplet of eighth)
    { label: '1/32',  divisor: 32 },
];

/**
 * Convert a playback rate to semitones relative to unity (rate=1 → 0 semitones).
 * @param {number} rate
 * @returns {number}
 */
export function rateToSemitones(rate) {
    return 12 * Math.log2(rate);
}

/**
 * Convert semitones (relative to unity) to a playback rate.
 * @param {number} semitones
 * @returns {number}
 */
export function semitonesToRate(semitones) {
    return Math.pow(2, semitones / 12);
}

/**
 * Snap a semitone value to the nearest degree in the given scale.
 * The root note offsets the scale so that scale degrees align with the chosen root.
 *
 * @param {number} semitones - Raw semitone value (e.g. from rateToSemitones)
 * @param {number[]} scaleIntervals - Array of intervals from SCALES
 * @param {number} rootNote - Root note as semitone offset (0=C, 1=C#, ..., 11=B)
 * @returns {number} Snapped semitone value
 */
export function quantizePitch(semitones, scaleIntervals, rootNote) {
    // Shift so the root becomes 0
    const relative = semitones - rootNote;

    // Find octave and position within the octave
    // Use Math.floor for correct negative handling
    const octave = Math.floor(relative / 12);
    let withinOctave = relative - octave * 12;

    // Find the nearest scale degree
    let bestDist = Infinity;
    let bestDegree = 0;
    for (const degree of scaleIntervals) {
        const dist = Math.abs(withinOctave - degree);
        if (dist < bestDist) {
            bestDist = dist;
            bestDegree = degree;
        }
    }

    // Also check wrapping: distance to next octave's root might be closer
    const distToNextRoot = 12 - withinOctave;
    if (distToNextRoot < bestDist) {
        return (octave + 1) * 12 + rootNote;
    }

    return octave * 12 + bestDegree + rootNote;
}

/**
 * Get a display-friendly note name for a semitone value.
 * Reference: 0 semitones = C4 (middle C, playback rate = 1).
 * @param {number} semitones
 * @returns {string} e.g. "C4", "Eb3", "F#5"
 */
export function semitonesToNoteName(semitones) {
    // 0 semitones = C4
    const midi = Math.round(semitones) + 60; // MIDI 60 = C4
    const noteIndex = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Compute inter-onset time in seconds for a given BPM and subdivision.
 * @param {number} bpm
 * @param {number} divisor - From SUBDIVISIONS (1=whole, 4=quarter, 16=sixteenth, etc.)
 * @returns {number} Inter-onset time in seconds
 */
export function getSubdivisionSeconds(bpm, divisor) {
    return (60 / bpm) * (4 / divisor);
}

/**
 * Snap an inter-onset time (in seconds) to the nearest subdivision of the given BPM.
 * @param {number} interOnset - Raw inter-onset in seconds
 * @param {number} bpm
 * @returns {{ seconds: number, label: string, divisor: number }}
 */
export function quantizeDensity(interOnset, bpm) {
    let bestDist = Infinity;
    let best = SUBDIVISIONS[0];

    for (const sub of SUBDIVISIONS) {
        const subSeconds = getSubdivisionSeconds(bpm, sub.divisor);
        const dist = Math.abs(interOnset - subSeconds);
        if (dist < bestDist) {
            bestDist = dist;
            best = sub;
        }
    }

    return {
        seconds: getSubdivisionSeconds(bpm, best.divisor),
        label: best.label,
        divisor: best.divisor,
    };
}

/**
 * Map a normalized slider value (0–1) to a subdivision index.
 * Used when density sliders are in quantized mode.
 * @param {number} normalized - 0–1
 * @returns {{ label: string, divisor: number }}
 */
export function normalizedToSubdivision(normalized) {
    const index = Math.round(normalized * (SUBDIVISIONS.length - 1));
    return SUBDIVISIONS[index];
}

/**
 * Build a sorted array of all valid semitone values for a given scale
 * within a semitone range. Used as the note table for arpeggiator patterns.
 *
 * @param {number[]} scaleIntervals - Array of intervals from SCALES (e.g. [0,2,4,5,7,9,11])
 * @param {number} rootNote - Root note as semitone offset (0=C, 1=C#, ..., 11=B)
 * @param {number} [minSemitones=-24] - Lower bound (inclusive), ±2 octaves from unity
 * @param {number} [maxSemitones=24] - Upper bound (inclusive)
 * @returns {number[]} Sorted array of semitone values
 */
export function buildNoteTable(scaleIntervals, rootNote, minSemitones = -24, maxSemitones = 24) {
    const notes = [];
    const minOctave = Math.floor((minSemitones - rootNote) / 12) - 1;
    const maxOctave = Math.ceil((maxSemitones - rootNote) / 12) + 1;

    for (let oct = minOctave; oct <= maxOctave; oct++) {
        for (const interval of scaleIntervals) {
            const semitone = oct * 12 + interval + rootNote;
            if (semitone >= minSemitones && semitone <= maxSemitones) {
                notes.push(semitone);
            }
        }
    }

    notes.sort((a, b) => a - b);
    return notes;
}

// --- Arpeggiator permutation utilities ---

/** Cache for permutation arrays, keyed by step count. */
const _permutationCache = new Map();

/**
 * Generate all permutations of [0..n-1] using Heap's algorithm.
 * @param {number} n - Number of elements (3–6 typical)
 * @returns {number[][]} Array of all n! permutations
 */
export function generatePermutations(n) {
    const result = [];
    const arr = Array.from({ length: n }, (_, i) => i);
    const c = new Array(n).fill(0);

    result.push([...arr]);

    let i = 0;
    while (i < n) {
        if (c[i] < i) {
            if (i % 2 === 0) {
                [arr[0], arr[i]] = [arr[i], arr[0]];
            } else {
                [arr[c[i]], arr[i]] = [arr[i], arr[c[i]]];
            }
            result.push([...arr]);
            c[i]++;
            i = 0;
        } else {
            c[i] = 0;
            i++;
        }
    }

    return result;
}

/**
 * Get all permutations for a given step count (cached).
 * @param {number} n - Number of steps (3–6)
 * @returns {number[][]} All n! permutations
 */
export function getPermutations(n) {
    if (!_permutationCache.has(n)) {
        _permutationCache.set(n, generatePermutations(n));
    }
    return _permutationCache.get(n);
}

/**
 * Pick N evenly spaced notes from a note table.
 * If the table has fewer notes than steps, returns all available notes.
 * @param {number[]} noteTable - Sorted array of semitone values
 * @param {number} steps - Number of notes to pick
 * @returns {number[]} Array of selected semitone values
 */
export function selectArpNotes(noteTable, steps) {
    const len = noteTable.length;
    if (len <= steps) return [...noteTable];

    const notes = [];
    for (let i = 0; i < steps; i++) {
        const index = Math.round(i * (len - 1) / (steps - 1));
        notes.push(noteTable[index]);
    }
    return notes;
}

/**
 * Apply arp type to a permutation pattern.
 * 'straight' returns the pattern as-is (repeating cycle).
 * 'looped' returns a palindrome minus the endpoints (bounce).
 * e.g. [0,1,2] straight → [0,1,2], looped → [0,1,2,1]
 * @param {number[]} pattern - Permutation array
 * @param {string} type - 'straight' or 'looped'
 * @returns {number[]} Sequence to cycle through
 */
export function applyArpType(pattern, type) {
    if (type === 'looped' && pattern.length > 2) {
        const reversed = pattern.slice(1, -1).reverse();
        return [...pattern, ...reversed];
    }
    return [...pattern];
}

/**
 * Snap a time value (seconds) to the nearest beat boundary at the given BPM.
 * Used for loop point quantization to keep multi-layer loops in sync.
 * Snaps to the nearest beat (quarter note) by default.
 * @param {number} time - Time in seconds
 * @param {number} bpm - Beats per minute
 * @param {number} [divisor=4] - Subdivision divisor (4=beat, 8=eighth, 16=sixteenth)
 * @returns {number} Snapped time in seconds
 */
export function quantizeTimeToGrid(time, bpm, divisor = 4) {
    const gridSize = (60 / bpm) * (4 / divisor); // seconds per grid unit
    return Math.round(time / gridSize) * gridSize;
}
