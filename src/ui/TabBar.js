// TabBar.js — Horizontal tab strip for switching between sampler instances.
// Renders dynamically from a tab list array. Supports switch, close, rename, add.

export class TabBar {
    /**
     * @param {HTMLElement} listEl - The #tab-list container
     * @param {HTMLButtonElement} addBtn - The #tab-add button
     * @param {Object} callbacks
     * @param {(id: string) => void} callbacks.onSwitch
     * @param {(id: string) => void} callbacks.onClose
     * @param {(id: string, name: string) => void} callbacks.onRename
     * @param {() => void} callbacks.onAdd
     */
    constructor(listEl, addBtn, callbacks) {
        this._listEl = listEl;
        this._addBtn = addBtn;
        this._callbacks = callbacks;
        this._tabCount = 0;

        addBtn.addEventListener('click', () => callbacks.onAdd());
    }

    /**
     * Re-render all tabs from the provided list.
     * @param {Array<{ id: string, name: string, isActive: boolean }>} tabs
     */
    render(tabs) {
        this._tabCount = tabs.length;
        this._listEl.innerHTML = '';

        for (const tab of tabs) {
            const btn = document.createElement('button');
            btn.className = 'tab-item' + (tab.isActive ? ' tab-active' : '');
            btn.type = 'button';
            btn.dataset.tabId = tab.id;

            // Tab label
            const label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = tab.name;
            btn.appendChild(label);

            // Close button (hidden when only 1 tab)
            if (tabs.length > 1) {
                const close = document.createElement('span');
                close.className = 'tab-close';
                close.textContent = '\u00D7'; // ×
                close.title = 'Close';
                close.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._callbacks.onClose(tab.id);
                });
                btn.appendChild(close);
            }

            // Click to switch
            btn.addEventListener('click', () => {
                this._callbacks.onSwitch(tab.id);
            });

            // Double-click to rename
            btn.addEventListener('dblclick', (e) => {
                e.preventDefault();
                const newName = prompt('Rename instance:', tab.name);
                if (newName && newName.trim()) {
                    this._callbacks.onRename(tab.id, newName.trim());
                }
            });

            this._listEl.appendChild(btn);
        }
    }
}
