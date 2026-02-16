// voiceColors.js — Shared color palette for per-voice visual feedback.
// 10 distinct, high-contrast colors on a dark background.

/** @type {[number, number, number][]} RGB triplets indexed by voiceId */
export const VOICE_COLORS = [
    [0, 200, 255],     // 0: cyan
    [255, 100, 200],   // 1: pink
    [100, 255, 150],   // 2: green
    [255, 200, 60],    // 3: amber
    [180, 120, 255],   // 4: purple
    [255, 130, 80],    // 5: orange
    [80, 220, 220],    // 6: teal
    [255, 80, 80],     // 7: red
    [160, 255, 80],    // 8: lime
    [220, 160, 255],   // 9: lavender
];

/**
 * Get the RGB color for a voice slot.
 * @param {number} voiceId
 * @returns {[number, number, number]}
 */
export function getVoiceColor(voiceId) {
    return VOICE_COLORS[voiceId % VOICE_COLORS.length];
}
