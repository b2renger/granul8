// TransportBar.js — Manages transport control state and visual feedback.
// Handles record/play/stop/loop button states and the time/progress display.
// Includes draggable loop start/end handles on the progress bar.

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

        // --- Loop point handles ---
        this._progressContainer = els.progressBar.parentElement; // #transport-progress
        this._loopRegion = document.getElementById('loop-region');
        this._loopStartHandle = document.getElementById('loop-start-handle');
        this._loopEndHandle = document.getElementById('loop-end-handle');

        /** Loop start as fraction (0–1) of recording duration */
        this._loopStartFrac = 0;
        /** Loop end as fraction (0–1) */
        this._loopEndFrac = 1;
        /** Which handle is being dragged */
        this._draggingHandle = null;

        // --- Callbacks (set by main.js) ---

        /** Called when the user clicks Record (to start or stop recording). */
        this.onRecord = null;

        /** Called when the user clicks Play. */
        this.onPlay = null;

        /** Called when the user clicks Stop. */
        this.onStop = null;

        /** Called when the user toggles Loop. */
        this.onLoopToggle = null;

        /**
         * Called when loop start/end points change.
         * @type {((startFrac: number, endFrac: number) => void)|null}
         */
        this.onLoopRangeChange = null;

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

        // --- Loop handle drag ---
        this._onHandlePointerMove = this._onHandlePointerMove.bind(this);
        this._onHandlePointerUp = this._onHandlePointerUp.bind(this);

        this._loopStartHandle.addEventListener('pointerdown', (e) => {
            this._draggingHandle = 'start';
            this._beginDrag(e);
        });
        this._loopEndHandle.addEventListener('pointerdown', (e) => {
            this._draggingHandle = 'end';
            this._beginDrag(e);
        });
    }

    // --- Loop handle drag methods ---

    /** @private */
    _beginDrag(e) {
        e.preventDefault();
        e.target.setPointerCapture(e.pointerId);
        document.addEventListener('pointermove', this._onHandlePointerMove);
        document.addEventListener('pointerup', this._onHandlePointerUp);
    }

    /** @private */
    _onHandlePointerMove(e) {
        if (!this._draggingHandle) return;
        const rect = this._progressContainer.getBoundingClientRect();
        let frac = (e.clientX - rect.left) / rect.width;
        frac = Math.max(0, Math.min(1, frac));

        if (this._draggingHandle === 'start') {
            this._loopStartFrac = Math.min(frac, this._loopEndFrac - 0.01);
        } else {
            this._loopEndFrac = Math.max(frac, this._loopStartFrac + 0.01);
        }

        this._updateLoopHandlePositions();
        if (this.onLoopRangeChange) {
            this.onLoopRangeChange(this._loopStartFrac, this._loopEndFrac);
        }
    }

    /** @private */
    _onHandlePointerUp() {
        this._draggingHandle = null;
        document.removeEventListener('pointermove', this._onHandlePointerMove);
        document.removeEventListener('pointerup', this._onHandlePointerUp);
    }

    /** Update visual positions of loop handles and region. @private */
    _updateLoopHandlePositions() {
        const startPct = (this._loopStartFrac * 100).toFixed(2);
        const endPct = (this._loopEndFrac * 100).toFixed(2);

        this._loopStartHandle.style.left = `${startPct}%`;
        this._loopEndHandle.style.left = `${endPct}%`;

        this._loopRegion.style.left = `${startPct}%`;
        this._loopRegion.style.width = `${(this._loopEndFrac - this._loopStartFrac) * 100}%`;
    }

    /**
     * Get loop range as fractions.
     * @returns {{ startFrac: number, endFrac: number }}
     */
    getLoopRange() {
        return { startFrac: this._loopStartFrac, endFrac: this._loopEndFrac };
    }

    /**
     * Set loop range from fractions (e.g. when restoring state).
     * @param {number} startFrac
     * @param {number} endFrac
     */
    setLoopRange(startFrac, endFrac) {
        this._loopStartFrac = startFrac;
        this._loopEndFrac = endFrac;
        this._updateLoopHandlePositions();
    }

    /** Reset loop range to full recording. */
    resetLoopRange() {
        this._loopStartFrac = 0;
        this._loopEndFrac = 1;
        this._updateLoopHandlePositions();
    }

    // --- Existing methods ---

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

        // Show/hide loop handles when a recording exists and loop is active
        const showHandles = this._hasRecording && this.looping;
        this._progressContainer.classList.toggle('loop-handles-visible', showHandles);

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
        // Update handle visibility
        this._updateButtons();
        if (this.looping) {
            this._updateLoopHandlePositions();
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
