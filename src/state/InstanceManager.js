// InstanceManager.js — Orchestrates creation, destruction, and switching of
// sampler instances. Each instance owns a GranularEngine, GrainOverlay, buffer,
// and serializable state. A single ParameterPanel is swapped between instances.

import { GranularEngine } from '../audio/GranularEngine.js';
import { GrainOverlay } from '../ui/GrainOverlay.js';
import { InstanceState } from './InstanceState.js';

export class InstanceManager {
    /**
     * @param {import('../audio/MasterBus.js').MasterBus} masterBus
     * @param {import('../ui/ParameterPanel.js').ParameterPanel} panel
     * @param {import('../ui/WaveformDisplay.js').WaveformDisplay} waveform
     */
    constructor(masterBus, panel, waveform) {
        this.masterBus = masterBus;
        this.panel = panel;
        this.waveform = waveform;

        /** @type {Map<string, { state: InstanceState, engine: GranularEngine, grainOverlay: GrainOverlay, buffer: AudioBuffer|null }>} */
        this.instances = new Map();

        /** @type {string|null} */
        this.activeId = null;

        /** Called when the tab list changes (add, remove, rename, switch). */
        this.onTabsChanged = null;

        /** Instance counter for default naming. */
        this._counter = 0;
    }

    /**
     * Create a new instance with default state.
     * @param {string} [name] - Tab label (auto-generated if omitted)
     * @returns {string} The new instance's ID
     */
    createInstance(name) {
        this._counter++;
        const state = new InstanceState(name || `Sampler ${this._counter}`);
        const engine = new GranularEngine(this.masterBus.audioContext, this.masterBus.masterGain);
        const grainOverlay = new GrainOverlay();

        this.instances.set(state.id, { state, engine, grainOverlay, buffer: null });

        // If this is the first instance, make it active
        if (this.instances.size === 1) {
            this.activeId = state.id;
            engine.onGrain = (info) => grainOverlay.addGrain(info);
        }

        if (this.onTabsChanged) this.onTabsChanged();
        return state.id;
    }

    /**
     * Switch to a different instance. Saves current panel state, restores target.
     * @param {string} instanceId
     */
    switchTo(instanceId) {
        if (instanceId === this.activeId) return;

        const target = this.instances.get(instanceId);
        if (!target) return;

        // Save current instance's panel state
        if (this.activeId) {
            const current = this.instances.get(this.activeId);
            if (current) {
                const fullState = this.panel.getFullState();
                Object.assign(current.state, fullState);
                // Disconnect grain visualization
                current.engine.onGrain = null;
            }
        }

        // Restore target instance's state into the panel
        this.panel.setFullState(target.state);

        // Swap waveform display
        if (target.buffer) {
            this.waveform.setBuffer(target.buffer);
        } else {
            this.waveform.setBuffer(null);
        }

        // Wire grain visualization to the new active instance
        target.engine.onGrain = (info) => target.grainOverlay.addGrain(info);

        // Update master volume from the restored instance
        this.masterBus.setMasterVolume(target.state.volume);

        this.activeId = instanceId;
        if (this.onTabsChanged) this.onTabsChanged();
    }

    /**
     * Remove an instance. Cannot remove the last one.
     * @param {string} instanceId
     * @returns {boolean} True if removed
     */
    removeInstance(instanceId) {
        if (this.instances.size <= 1) return false;

        const entry = this.instances.get(instanceId);
        if (!entry) return false;

        // If removing the active instance, switch to another first
        if (instanceId === this.activeId) {
            const ids = [...this.instances.keys()];
            const idx = ids.indexOf(instanceId);
            const nextId = ids[idx === 0 ? 1 : idx - 1];
            this.switchTo(nextId);
        }

        // Stop voices and disconnect
        entry.engine.stopAllVoices();
        entry.engine.dispose();
        this.instances.delete(instanceId);

        if (this.onTabsChanged) this.onTabsChanged();
        return true;
    }

    /**
     * Get the active instance's data.
     * @returns {{ state: InstanceState, engine: GranularEngine, grainOverlay: GrainOverlay, buffer: AudioBuffer|null }|null}
     */
    getActive() {
        if (!this.activeId) return null;
        return this.instances.get(this.activeId) || null;
    }

    /**
     * Store a loaded sample buffer in the active instance.
     * @param {AudioBuffer} buffer
     * @param {string} displayName
     * @param {string|null} url - Preset URL (null if file-loaded)
     * @param {string|null} fileName - File name (null if URL-loaded)
     */
    setActiveSample(buffer, displayName, url, fileName) {
        const active = this.getActive();
        if (!active) return;

        active.buffer = buffer;
        active.state.sampleDisplayName = displayName;
        active.state.sampleUrl = url;
        active.state.sampleFileName = fileName;
    }

    /**
     * Get the tab list for the TabBar to render.
     * @returns {Array<{ id: string, name: string, isActive: boolean }>}
     */
    getTabList() {
        const tabs = [];
        for (const [id, entry] of this.instances) {
            tabs.push({
                id,
                name: entry.state.name,
                isActive: id === this.activeId,
            });
        }
        return tabs;
    }

    /**
     * Rename an instance.
     * @param {string} instanceId
     * @param {string} newName
     */
    renameInstance(instanceId, newName) {
        const entry = this.instances.get(instanceId);
        if (entry) {
            entry.state.name = newName;
            if (this.onTabsChanged) this.onTabsChanged();
        }
    }

    /**
     * Replace the entire workspace from a serialized session.
     * Destroys all current instances, creates new ones from the session data.
     *
     * @param {Object} sessionData - Validated session JSON (from validateSession)
     * @param {(state: InstanceState, entry: Object) => Promise<void>} onInstanceCreated
     *   - Callback fired for each instance after creation, for sample loading.
     * @returns {Promise<void>}
     */
    async restoreFromSession(sessionData, onInstanceCreated) {
        // 1. Destroy all existing instances
        for (const [, entry] of this.instances) {
            entry.engine.stopAllVoices();
            entry.engine.dispose();
        }
        this.instances.clear();
        this.activeId = null;

        // 2. Recreate instances from saved state
        for (const savedState of sessionData.instances) {
            const state = InstanceState.fromJSON(savedState);
            const engine = new GranularEngine(
                this.masterBus.audioContext,
                this.masterBus.masterGain
            );
            const grainOverlay = new GrainOverlay();

            this.instances.set(state.id, { state, engine, grainOverlay, buffer: null });
        }

        // 3. Determine which tab to activate
        const targetId = sessionData.activeInstanceId &&
                         this.instances.has(sessionData.activeInstanceId)
            ? sessionData.activeInstanceId
            : this.instances.keys().next().value;

        // 4. Activate the target instance
        this.activeId = targetId;
        const target = this.instances.get(targetId);
        this.panel.setFullState(target.state);
        target.engine.onGrain = (info) => target.grainOverlay.addGrain(info);
        this.masterBus.setMasterVolume(target.state.volume);

        // 5. Update counter so new tabs get sensible names
        this._counter = this.instances.size;

        // 6. Fire callback for sample loading on each instance
        if (onInstanceCreated) {
            for (const [, entry] of this.instances) {
                await onInstanceCreated(entry.state, entry);
            }
        }

        // 7. Notify tab bar to re-render
        if (this.onTabsChanged) this.onTabsChanged();
    }
}
