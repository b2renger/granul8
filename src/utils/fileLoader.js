// fileLoader.js — Drag-and-drop + file picker → AudioBuffer

/**
 * Set up drag-and-drop on a container element.
 * Shows/hides the overlay and calls onFile when a valid audio file is dropped.
 *
 * @param {HTMLElement} container - The drop zone element
 * @param {HTMLElement} overlay - The visual drop overlay element
 * @param {(file: File) => void} onFile - Callback when a valid audio file is dropped
 */
export function setupDragAndDrop(container, overlay, onFile) {
    container.addEventListener('dragenter', (e) => {
        e.preventDefault();
        overlay.hidden = false;
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    container.addEventListener('dragleave', (e) => {
        // Only hide when the pointer actually leaves the container
        if (!container.contains(e.relatedTarget)) {
            overlay.hidden = true;
        }
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.hidden = true;

        const file = e.dataTransfer.files[0];
        if (file) {
            onFile(file);
        }
    });
}

/**
 * Set up a file picker button that triggers a hidden file input.
 *
 * @param {HTMLButtonElement} button - The visible "Load Sample" button
 * @param {HTMLInputElement} input - The hidden file input (accept="audio/*")
 * @param {(file: File) => void} onFile - Callback when a file is selected
 */
export function setupFilePicker(button, input, onFile) {
    button.addEventListener('click', () => input.click());

    input.addEventListener('change', () => {
        const file = input.files[0];
        if (file) {
            onFile(file);
        }
        // Reset so the same file can be re-selected
        input.value = '';
    });
}

/**
 * Check if a File object looks like an audio file.
 * @param {File} file
 * @returns {boolean}
 */
export function isAudioFile(file) {
    if (file.type.startsWith('audio/')) return true;
    // Fallback: check extension for common audio formats
    const ext = file.name.split('.').pop().toLowerCase();
    return ['wav', 'mp3', 'ogg', 'aac', 'flac', 'webm', 'm4a'].includes(ext);
}
