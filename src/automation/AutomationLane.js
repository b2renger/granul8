// AutomationLane.js — Stores a sequence of automation events for recording and playback.
// Each event captures the complete voice state (not deltas), making playback
// self-contained and random-access friendly.

/**
 * @typedef {Object} AutomationEvent
 * @property {number} time        - Seconds since recording start
 * @property {number} voiceIndex  - 0-based voice slot
 * @property {'start'|'move'|'stop'} type - Event type
 * @property {Object} [params]    - Voice parameters (omitted for 'stop' events)
 * @property {number} [params.position]
 * @property {number} [params.amplitude]
 * @property {number} [params.pitch]
 * @property {number} [params.grainSize]
 * @property {number} [params.interOnset]
 * @property {number} [params.spread]
 * @property {number} [params.pan]
 * @property {string} [params.envelope]
 */

export class AutomationLane {
    constructor() {
        /** @type {AutomationEvent[]} */
        this.events = [];
    }

    /**
     * Append an event to the lane.
     * @param {AutomationEvent} event
     */
    addEvent(event) {
        this.events.push(event);
    }

    /**
     * Return all events whose time falls within [startTime, endTime).
     * Assumes events are in chronological order (they are, since addEvent
     * is called in real time during recording).
     *
     * @param {number} startTime - Inclusive lower bound (seconds)
     * @param {number} endTime   - Exclusive upper bound (seconds)
     * @returns {AutomationEvent[]}
     */
    getEventsInRange(startTime, endTime) {
        const result = [];
        for (const event of this.events) {
            if (event.time >= endTime) break;
            if (event.time >= startTime) {
                result.push(event);
            }
        }
        return result;
    }

    /**
     * Get the duration of the recording (timestamp of the last event).
     * @returns {number} Duration in seconds, or 0 if empty.
     */
    getDuration() {
        if (this.events.length === 0) return 0;
        return this.events[this.events.length - 1].time;
    }

    /**
     * Get the total number of events.
     * @returns {number}
     */
    get length() {
        return this.events.length;
    }

    /**
     * Remove all events.
     */
    clear() {
        this.events = [];
    }

    /**
     * Serialize to a plain object for JSON export.
     * @returns {Object}
     */
    toJSON() {
        return {
            events: this.events.map(e => ({ ...e })),
        };
    }

    /**
     * Restore from a serialized object.
     * @param {Object} data - Output of toJSON()
     * @returns {AutomationLane}
     */
    static fromJSON(data) {
        const lane = new AutomationLane();
        if (data && Array.isArray(data.events)) {
            lane.events = data.events.map(e => ({ ...e }));
        }
        return lane;
    }

    /**
     * Merge two lanes into one, interleaving events by time.
     * Voice indices in laneB are offset to avoid collisions with laneA.
     * @param {AutomationLane} laneA - Base recording
     * @param {AutomationLane} laneB - Overdub recording
     * @returns {AutomationLane}
     */
    static merge(laneA, laneB) {
        // Find highest voice index in laneA to offset laneB voices
        let maxVoiceA = -1;
        for (const e of laneA.events) {
            if (e.voiceIndex > maxVoiceA) maxVoiceA = e.voiceIndex;
        }
        const voiceOffset = maxVoiceA + 1;

        const merged = new AutomationLane();
        let iA = 0;
        let iB = 0;
        const a = laneA.events;
        const b = laneB.events;

        while (iA < a.length && iB < b.length) {
            if (a[iA].time <= b[iB].time) {
                merged.events.push({ ...a[iA] });
                iA++;
            } else {
                merged.events.push({ ...b[iB], voiceIndex: b[iB].voiceIndex + voiceOffset });
                iB++;
            }
        }
        while (iA < a.length) {
            merged.events.push({ ...a[iA] });
            iA++;
        }
        while (iB < b.length) {
            merged.events.push({ ...b[iB], voiceIndex: b[iB].voiceIndex + voiceOffset });
            iB++;
        }

        return merged;
    }
}
