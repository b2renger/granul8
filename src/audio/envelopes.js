// envelopes.js — Window functions: Hann, Tukey, Triangle
// Returns Float32Array curves for use with GainNode.setValueCurveAtTime()

/**
 * Cache for pre-computed envelopes.
 * Key: "type:length", Value: Float32Array
 * @type {Map<string, Float32Array>}
 */
const cache = new Map();

// Pre-cache common lengths on module load
const COMMON_LENGTHS = [64, 128, 256];
for (const len of COMMON_LENGTHS) {
    cache.set(`hann:${len}`, _computeHann(len));
    cache.set(`tukey:${len}`, _computeTukey(len, 0.5));
    cache.set(`triangle:${len}`, _computeTriangle(len));
}

/**
 * Get a Hann window (raised cosine) of the given length.
 * w(t) = 0.5 * (1 - cos(2*PI*t / (N-1)))
 *
 * @param {number} length - Number of samples in the curve
 * @returns {Float32Array}
 */
export function hannWindow(length) {
    const key = `hann:${length}`;
    let curve = cache.get(key);
    if (!curve) {
        curve = _computeHann(length);
        cache.set(key, curve);
    }
    return curve;
}

/**
 * Get a Tukey window (tapered cosine) of the given length.
 * Flat top in the middle, cosine tapers on both ends.
 *
 * @param {number} length - Number of samples in the curve
 * @param {number} [alpha=0.5] - Taper ratio (0 = rectangular, 1 = Hann)
 * @returns {Float32Array}
 */
export function tukeyWindow(length, alpha = 0.5) {
    const key = `tukey:${length}:${alpha}`;
    let curve = cache.get(key);
    if (!curve) {
        curve = _computeTukey(length, alpha);
        cache.set(key, curve);
    }
    return curve;
}

/**
 * Get a Triangle window of the given length.
 * Linear ramp up to center, linear ramp down.
 *
 * @param {number} length - Number of samples in the curve
 * @returns {Float32Array}
 */
export function triangleWindow(length) {
    const key = `triangle:${length}`;
    let curve = cache.get(key);
    if (!curve) {
        curve = _computeTriangle(length);
        cache.set(key, curve);
    }
    return curve;
}

/**
 * Get an envelope by name.
 *
 * @param {'hann'|'tukey'|'triangle'} type
 * @param {number} length
 * @returns {Float32Array}
 */
export function getEnvelope(type, length) {
    switch (type) {
        case 'tukey':    return tukeyWindow(length);
        case 'triangle': return triangleWindow(length);
        case 'hann':
        default:         return hannWindow(length);
    }
}

// --- Internal computation functions ---

/**
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeHann(length) {
    const curve = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        curve[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
    }
    return curve;
}

/**
 * @param {number} length
 * @param {number} alpha - Taper ratio 0–1
 * @returns {Float32Array}
 */
function _computeTukey(length, alpha) {
    const curve = new Float32Array(length);
    const N = length - 1;
    const taperSamples = Math.floor(alpha * N / 2);

    for (let i = 0; i < length; i++) {
        if (taperSamples > 0 && i < taperSamples) {
            // Rising cosine taper
            curve[i] = 0.5 * (1 - Math.cos(Math.PI * i / taperSamples));
        } else if (taperSamples > 0 && i > N - taperSamples) {
            // Falling cosine taper
            curve[i] = 0.5 * (1 - Math.cos(Math.PI * (N - i) / taperSamples));
        } else {
            // Flat top
            curve[i] = 1.0;
        }
    }
    return curve;
}

/**
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeTriangle(length) {
    const curve = new Float32Array(length);
    const mid = (length - 1) / 2;
    for (let i = 0; i < length; i++) {
        curve[i] = 1.0 - Math.abs((i - mid) / mid);
    }
    return curve;
}
