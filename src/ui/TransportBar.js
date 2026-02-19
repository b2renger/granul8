// TransportBar.js — Manages transport control state and visual feedback.
// Handles record/play/stop/loop button states and the time/progress display.

/**
 * Transport states:
 *   'idle'      — No recording or playback active
 *   'armed'     — Record button pressed, waiting for first touch to start recording
 *   'recording' — Actively capturing gestures
 *   'playing'   — Playing back a recorded automation
 */

export class TransportBar {
    /**
     * @param {Object} els - DOM element references
     * @param {HTMLButtonElement} els.recordBtn
     * @param {HTMLButtonElement} els.playBtn
     * @param {HTMLButtonElement} els.stopBtn
     * @param {HTMLButtonElement} els.loopBtn
     * @param {HTMLElement} els.timeDisplay
     * @param {HTMLElement} els.progressBar
     */
    constructor(els) {
        this._els = els;

        /** @type {'idle'|'armed'|'recording'|'playing'} */
        this.state = 'idle';

        /** @type {boolean} */
        this.looping = false;

        /** @type {boolean} */
        this._hasRecording = false;

        // --- Callbacks (set by main.js) ---

        /** Called when the user clicks Record (to start or stop recording). */
        this.onRecord = null;

        /** Called when the user clicks Play. */
        this.onPlay = null;

        /** Called when the user clicks Stop. */
        this.onStop = null;

        /** Called when the user toggles Loop. */
        this.onLoopToggle = null;

        // --- Button event listeners ---

        els.recordBtn.addEventListener('click', () => {
            if (this.onRecord) this.onRecord();
        });

        els.playBtn.addEventListener('click', () => {
            if (this.onPlay) this.onPlay();
        });

        els.stopBtn.addEventListener('click', () => {
            if (this.onStop) this.onStop();
        });

        els.loopBtn.addEventListener('click', () => {
            this.looping = !this.looping;
            if (this.onLoopToggle) this.onLoopToggle(this.looping);
            this._updateLoopVisual();
        });
    }

    /**
     * Transition to a new transport state and update all button visuals.
     * @param {'idle'|'armed'|'recording'|'playing'} newState
     */
    setState(newState) {
        this.state = newState;
        this._updateButtons();
    }

    /**
     * Mark whether a recording exists (enables play/loop buttons in idle).
     * @param {boolean} has
     */
    setHasRecording(has) {
        this._hasRecording = has;
        this._updateButtons();
    }

    /**
     * Update the time display.
     * @param {number} seconds
     */
    setTime(seconds) {
        this._els.timeDisplay.textContent = formatTime(seconds);
    }

    /**
     * Update the progress bar (0 to 1).
     * @param {number} fraction
     */
    setProgress(fraction) {
        this._els.progressBar.style.width = `${(fraction * 100).toFixed(2)}%`;
    }

    /** Reset time and progress to zero. */
    resetDisplay() {
        this.setTime(0);
        this.setProgress(0);
    }

    /** @private */
    _updateButtons() {
        const { recordBtn, playBtn, stopBtn, loopBtn } = this._els;

        // Clear all state classes first
        recordBtn.classList.remove('recording', 'armed');
        playBtn.classList.remove('playing');

        switch (this.state) {
            case 'idle':
                stopBtn.disabled = true;
                recordBtn.disabled = false;
                playBtn.disabled = !this._hasRecording;
                loopBtn.disabled = !this._hasRecording;
                break;

            case 'armed':
                recordBtn.classList.add('armed');
                stopBtn.disabled = false;
                recordBtn.disabled = false;
                playBtn.disabled = true;
                loopBtn.disabled = true;
                break;

            case 'recording':
                recordBtn.classList.add('recording');
                stopBtn.disabled = false;
                recordBtn.disabled = false;
                playBtn.disabled = true;
                loopBtn.disabled = true;
                break;

            case 'playing':
                playBtn.classList.add('playing');
                stopBtn.disabled = false;
                recordBtn.disabled = true;
                loopBtn.disabled = false;
                break;
        }
    }

    /** @private */
    _updateLoopVisual() {
        const { loopBtn } = this._els;
        if (this.looping) {
            loopBtn.classList.add('loop-active');
        } else {
            loopBtn.classList.remove('loop-active');
        }
    }
}

/**
 * Format seconds as MM:SS.mmm
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const whole = Math.floor(secs);
    const ms = Math.floor((secs - whole) * 1000);
    return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
