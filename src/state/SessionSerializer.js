// SessionSerializer.js — Pure functions for serializing / validating session state.

/**
 * Gather the full session state from the InstanceManager.
 * Captures the active instance's current panel state first,
 * so the serialized data reflects the live UI, not stale saved state.
 *
 * @param {import('./InstanceManager.js').InstanceManager} instanceManager
 * @param {import('../ui/ParameterPanel.js').ParameterPanel} panel
 * @param {number} masterBpm - Global master BPM value
 * @param {number} [masterVolume=0.7] - Global master volume value
 * @param {Object} [loopStationState] - Loop station state (time sig, metronome)
 * @returns {Object} Session JSON object
 */
export function serializeSession(instanceManager, panel, masterBpm, masterVolume = 0.7, loopStationState = {}) {
    // Save the active panel state into the active instance's state
    const active = instanceManager.getActive();
    if (active) {
        const fullState = panel.getFullState();
        Object.assign(active.state, fullState);
    }

    // Collect all instance states in insertion order (Map preserves order)
    const instances = [];
    for (const [, entry] of instanceManager.instances) {
        instances.push(entry.state.toJSON());
    }

    return {
        granul8: true,
        version: 2,
        masterBpm: masterBpm || 120,
        masterVolume: masterVolume ?? 0.7,
        timeSignature: loopStationState.timeSignature || { numerator: 4, denominator: 4 },
        metronome: loopStationState.metronome || { enabled: false, volume: 0.5, muted: false },
        // loopStationMode is now per-instance (stored in each instance's state)
        savedAt: new Date().toISOString(),
        activeInstanceId: instanceManager.activeId,
        instances,
    };
}

/**
 * Validate a parsed JSON object as a valid Granul8 session.
 * @param {any} json
 * @returns {{ valid: boolean, data?: Object, error?: string }}
 */
export function validateSession(json) {
    if (!json || typeof json !== 'object') {
        return { valid: false, error: 'Not a valid JSON object' };
    }
    if (json.granul8 !== true) {
        return { valid: false, error: 'Not a Granul8 session file' };
    }
    if (typeof json.version !== 'number') {
        return { valid: false, error: 'Missing version number' };
    }
    if (!Array.isArray(json.instances) || json.instances.length === 0) {
        return { valid: false, error: 'Session contains no instances' };
    }
    for (let i = 0; i < json.instances.length; i++) {
        const inst = json.instances[i];
        if (!inst || typeof inst.id !== 'string' || typeof inst.name !== 'string') {
            return { valid: false, error: `Instance ${i} is missing id or name` };
        }
    }
    return { valid: true, data: json };
}

/**
 * Build a set of bundled sample URLs from the sample selector dropdown.
 * Used to determine which samples can be auto-reloaded on restore.
 *
 * @param {HTMLSelectElement} sampleSelectEl
 * @returns {Set<string>}
 */
export function getBundledSampleUrls(sampleSelectEl) {
    const urls = new Set();
    for (const option of sampleSelectEl.options) {
        if (option.value && option.value.startsWith('samples/')) {
            urls.add(option.value);
        }
    }
    return urls;
}
