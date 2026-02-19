// envelopes.js — Window functions for grain amplitude shaping.
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
    cache.set(`gaussian:${len}`, _computeGaussian(len));
    cache.set(`sigmoid:${len}`, _computeSigmoid(len));
    cache.set(`blackman:${len}`, _computeBlackman(len));
    cache.set(`expodec:${len}`, _computeExpodec(len));
    cache.set(`rexpodec:${len}`, _computeRexpodec(len));
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
 * @param {'hann'|'tukey'|'triangle'|'gaussian'|'sigmoid'|'blackman'|'expodec'|'rexpodec'} type
 * @param {number} length
 * @returns {Float32Array}
 */
export function getEnvelope(type, length) {
    switch (type) {
        case 'custom':   return _getCached('custom', length, _computeCustomADSR);
        case 'tukey':    return tukeyWindow(length);
        case 'triangle': return triangleWindow(length);
        case 'gaussian':  return _getCached('gaussian', length, _computeGaussian);
        case 'sigmoid':   return _getCached('sigmoid', length, _computeSigmoid);
        case 'blackman':  return _getCached('blackman', length, _computeBlackman);
        case 'expodec':   return _getCached('expodec', length, _computeExpodec);
        case 'rexpodec':  return _getCached('rexpodec', length, _computeRexpodec);
        case 'hann':
        default:          return hannWindow(length);
    }
}

/**
 * Generic cache lookup + compute helper.
 * @param {string} type
 * @param {number} length
 * @param {(length: number) => Float32Array} computeFn
 * @returns {Float32Array}
 */
function _getCached(type, length, computeFn) {
    const key = `${type}:${length}`;
    let curve = cache.get(key);
    if (!curve) {
        curve = computeFn(length);
        cache.set(key, curve);
    }
    return curve;
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

/**
 * Gaussian bell curve — smooth, concentrated energy in the center.
 * sigma controls width; 0.4 gives a nice taper to near-zero at edges.
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeGaussian(length) {
    const curve = new Float32Array(length);
    const sigma = 0.4;
    const mid = (length - 1) / 2;
    for (let i = 0; i < length; i++) {
        const t = (i - mid) / mid; // -1 to 1
        curve[i] = Math.exp(-0.5 * (t / sigma) ** 2);
    }
    return curve;
}

/**
 * Sigmoid — smooth S-curve attack and mirrored S-curve decay.
 * Steeper transitions than Hann, flatter sustain in the middle.
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeSigmoid(length) {
    const curve = new Float32Array(length);
    const steepness = 7;
    const mid = (length - 1) / 2;
    for (let i = 0; i < length; i++) {
        const t = (i - mid) / mid; // -1 to 1
        // Sigmoid: 1/(1+e^(-k*t)), normalized so edges → 0, center → 1
        const sig = 1 / (1 + Math.exp(-steepness * t));
        // Mirror around center: rise then fall
        if (i <= mid) {
            curve[i] = 1 / (1 + Math.exp(-steepness * (2 * i / mid - 1)));
        } else {
            curve[i] = 1 / (1 + Math.exp(-steepness * (2 * (length - 1 - i) / mid - 1)));
        }
    }
    return curve;
}

/**
 * Blackman window — narrower main lobe than Hann, better sidelobe suppression.
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeBlackman(length) {
    const curve = new Float32Array(length);
    const N = length - 1;
    for (let i = 0; i < length; i++) {
        curve[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N)
                        + 0.08 * Math.cos(4 * Math.PI * i / N);
    }
    return curve;
}

/**
 * Exponential decay — percussive attack, gradual tail.
 * Starts at 1, decays exponentially to near-zero.
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeExpodec(length) {
    const curve = new Float32Array(length);
    const decay = 5; // higher = faster decay
    for (let i = 0; i < length; i++) {
        const t = i / (length - 1);
        curve[i] = Math.exp(-decay * t);
    }
    return curve;
}

/**
 * Reverse exponential — slow build, sharp cutoff.
 * Mirror of expodec: near-zero at start, peaks at end.
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeRexpodec(length) {
    const curve = new Float32Array(length);
    const decay = 5;
    for (let i = 0; i < length; i++) {
        const t = (length - 1 - i) / (length - 1);
        curve[i] = Math.exp(-decay * t);
    }
    return curve;
}

// --- Custom ADSR envelope ---

/** @type {{a: number, d: number, s: number, r: number}} */
let _customADSRParams = { a: 0.2, d: 0.15, s: 0.7, r: 0.2 };

/**
 * Set the custom ADSR parameters. Clears cached custom entries so the next
 * getEnvelope('custom', ...) recomputes with the new values.
 * @param {number} a - Attack fraction (0–0.5)
 * @param {number} d - Decay fraction (0–0.5)
 * @param {number} s - Sustain level (0–1)
 * @param {number} r - Release fraction (0–0.5)
 */
export function setCustomADSR(a, d, s, r) {
    _customADSRParams = { a, d, s, r };
    for (const key of cache.keys()) {
        if (key.startsWith('custom:')) cache.delete(key);
    }
}

/**
 * Get the current custom ADSR parameters.
 * @returns {{a: number, d: number, s: number, r: number}}
 */
export function getCustomADSR() {
    return { ..._customADSRParams };
}

/**
 * Compute an ADSR envelope from explicit parameters (for per-instance ADSR).
 * Includes caching based on rounded ADSR values.
 * @param {{a: number, d: number, s: number, r: number}} adsr
 * @param {number} length
 * @returns {Float32Array}
 */
export function computeADSREnvelope(adsr, length) {
    // Round to 3 decimal places for cache key stability
    const key = `adsr:${adsr.a.toFixed(3)}:${adsr.d.toFixed(3)}:${adsr.s.toFixed(3)}:${adsr.r.toFixed(3)}:${length}`;
    let curve = cache.get(key);
    if (!curve) {
        curve = _computeADSRFromParams(adsr.a, adsr.d, adsr.s, adsr.r, length);
        cache.set(key, curve);
    }
    return curve;
}

/**
 * Compute an ADSR polyline envelope from given values.
 * 0 → 1 over attack, 1 → S over decay, hold S, S → 0 over release.
 * @param {number} a - Attack fraction
 * @param {number} d - Decay fraction
 * @param {number} s - Sustain level
 * @param {number} r - Release fraction
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeADSRFromParams(a, d, s, r, length) {
    const curve = new Float32Array(length);
    const N = length - 1;

    const aEnd  = Math.floor(a * N);
    const dEnd  = Math.floor((a + d) * N);
    const rStart = Math.floor((1 - r) * N);

    for (let i = 0; i < length; i++) {
        if (i <= aEnd) {
            curve[i] = aEnd > 0 ? i / aEnd : 1;
        } else if (i <= dEnd) {
            const t = (i - aEnd) / (dEnd - aEnd);
            curve[i] = 1 - t * (1 - s);
        } else if (i < rStart) {
            curve[i] = s;
        } else {
            const rLen = N - rStart;
            const t = rLen > 0 ? (i - rStart) / rLen : 1;
            curve[i] = s * (1 - t);
        }
    }
    return curve;
}

/**
 * Compute an ADSR polyline envelope.
 * 0 → 1 over attack, 1 → S over decay, hold S, S → 0 over release.
 * @param {number} length
 * @returns {Float32Array}
 */
function _computeCustomADSR(length) {
    const { a, d, s, r } = _customADSRParams;
    const curve = new Float32Array(length);
    const N = length - 1;

    const aEnd  = Math.floor(a * N);
    const dEnd  = Math.floor((a + d) * N);
    const rStart = Math.floor((1 - r) * N);

    for (let i = 0; i < length; i++) {
        if (i <= aEnd) {
            curve[i] = aEnd > 0 ? i / aEnd : 1;
        } else if (i <= dEnd) {
            const t = (i - aEnd) / (dEnd - aEnd);
            curve[i] = 1 - t * (1 - s);
        } else if (i < rStart) {
            curve[i] = s;
        } else {
            const rLen = N - rStart;
            const t = rLen > 0 ? (i - rStart) / rLen : 1;
            curve[i] = s * (1 - t);
        }
    }
    return curve;
}
