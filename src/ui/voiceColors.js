// voiceColors.js — Shared color palette for per-voice visual feedback.
// 10 distinct, high-contrast colors on a warm dark background.
// Palette: amber / terracotta / sage / cream / rust.

/** @type {[number, number, number][]} RGB triplets indexed by voiceId */
export const VOICE_COLORS = [
    [232, 168, 124],   // 0: warm amber (primary accent)
    [224, 85, 85],     // 1: warm red
    [122, 191, 160],   // 2: sage green
    [240, 200, 140],   // 3: cream gold
    [200, 110, 90],    // 4: terracotta
    [160, 200, 140],   // 5: muted olive
    [230, 140, 100],   // 6: burnt sienna
    [180, 210, 180],   // 7: pale sage
    [220, 160, 100],   // 8: caramel
    [190, 130, 120],   // 9: dusty rose
];

/**
 * Get the RGB color for a voice slot.
 * @param {number} voiceId
 * @returns {[number, number, number]}
 */
export function getVoiceColor(voiceId) {
    return VOICE_COLORS[voiceId % VOICE_COLORS.length];
}
