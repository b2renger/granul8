// SessionPersistence.js — localStorage auto-save with debouncing + file I/O utilities.

const STORAGE_KEY = 'granul8-session';
const DEBOUNCE_MS = 500;

export class SessionPersistence {
    /**
     * @param {() => Object} getSessionFn - Returns the current session JSON
     */
    constructor(getSessionFn) {
        this._getSession = getSessionFn;
        this._timerId = null;
        this._enabled = true;
    }

    /** Disable auto-save (e.g., during session restore). */
    disable() { this._enabled = false; }

    /** Re-enable auto-save. */
    enable() { this._enabled = true; }

    /**
     * Schedule a debounced save. Multiple calls within DEBOUNCE_MS
     * collapse into a single write.
     */
    scheduleSave() {
        if (!this._enabled) return;
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
        }
        this._timerId = setTimeout(() => {
            this._timerId = null;
            this._writeToLocalStorage();
        }, DEBOUNCE_MS);
    }

    /** Force an immediate save (e.g., on beforeunload). */
    saveNow() {
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
        this._writeToLocalStorage();
    }

    /**
     * Load a session from localStorage.
     * @returns {Object|null} Parsed session JSON, or null if none/invalid.
     */
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn('Failed to parse saved session:', e);
            return null;
        }
    }

    /** Clear stored session from localStorage. */
    clear() {
        localStorage.removeItem(STORAGE_KEY);
    }

    /** @private */
    _writeToLocalStorage() {
        try {
            const session = this._getSession();
            const json = JSON.stringify(session);
            localStorage.setItem(STORAGE_KEY, json);
        } catch (e) {
            console.warn('Failed to save session:', e);
        }
    }
}

/**
 * Export session as a downloadable .json file.
 * @param {Object} session - The session JSON object
 */
export function exportSessionFile(session) {
    const json = JSON.stringify(session, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `granul8-session-${_formatDateForFilename()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Read an imported .json file and parse it.
 * @param {File} file
 * @returns {Promise<Object>} Parsed JSON
 */
export function readSessionFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                resolve(JSON.parse(reader.result));
            } catch (e) {
                reject(new Error('Invalid JSON file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

/** @private */
function _formatDateForFilename() {
    const d = new Date();
    return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
