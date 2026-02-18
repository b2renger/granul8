// math.js — clamp, mapRange, lerp

/**
 * Clamp a value between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

/**
 * Map a value from one range to another.
 * @param {number} val
 * @param {number} inMin
 * @param {number} inMax
 * @param {number} outMin
 * @param {number} outMax
 * @returns {number}
 */
export function mapRange(val, inMin, inMax, outMin, outMax) {
    return outMin + ((val - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Linear interpolation between a and b.
 * @param {number} a
 * @param {number} b
 * @param {number} t - 0–1
 * @returns {number}
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Exponential mapping: normalized 0–1 → value in [min, max].
 * Ideal for perceptual audio parameters where low-end resolution matters
 * more than high-end (e.g. grain durations, frequencies).
 * @param {number} normalized - 0–1
 * @param {number} min - Lower bound (must be > 0)
 * @param {number} max - Upper bound
 * @returns {number}
 */
export function expMap(normalized, min, max) {
    return min * Math.pow(max / min, normalized);
}
