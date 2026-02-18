// musicalQuantizer.js — Musical pitch quantization and BPM subdivision utilities.

/** Note names for display (sharps notation). */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Scale intervals in semitones from root. */
export const SCALES = {
    chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major:      [0, 2, 4, 5, 7, 9, 11],
    minor:      [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
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
