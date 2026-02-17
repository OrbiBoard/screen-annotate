const { ipcRenderer } = require('electron');
const state = require('./state');
const ui = require('./ui');
const canvasModule = require('./canvas');

let previousMode = 'annotate';

function initScreenshotListeners(handleToolClick) {
    ipcRenderer.on('annotate-enter-screenshot-mode', () => {
        enterScreenshotMode();
    });

    const mask = document.getElementById('screenshot-mask');
    if (mask) {
        mask.onpointerdown = (e) => {
            state.screenshot.active = true;
            state.screenshot.start = { x: e.clientX, y: e.clientY };
            state.screenshot.end = { x: e.clientX, y: e.clientY };
            
            const selectionRectDiv = document.getElementById('screenshot-selection-rect');
            if (selectionRectDiv) {
                selectionRectDiv.style.display = 'block';
                updateSelectionRect();
            }
            
            document.getElementById('screenshot-minibar').style.display = 'none';
        };

        mask.onpointermove = (e) => {
            if (!state.screenshot || !state.screenshot.active) return;
            state.screenshot.end = { x: e.clientX, y: e.clientY };
            updateSelectionRect();
        };

        mask.onpointerup = (e) => {
            if (!state.screenshot || !state.screenshot.active) return;
            state.screenshot.active = false;
            
            const minibar = document.getElementById('screenshot-minibar');
            minibar.style.display = 'flex';
            
            const rect = getSelectionRect();
            let top = rect.y + rect.h + 10;
            let left = rect.x;
            
            if (top + minibar.offsetHeight > window.innerHeight) {
                top = rect.y - minibar.offsetHeight - 10;
            }
            if (left + minibar.offsetWidth > window.innerWidth) {
                left = window.innerWidth - minibar.offsetWidth - 10;
            }
            
            minibar.style.top = `${top}px`;
            minibar.style.left = `${left}px`;
        };
    }

    ui.initScreenshotUI({
        onScreenshotFull: async () => {
            document.getElementById('screenshot-mask').style.display = 'none';
            document.getElementById('screenshot-minibar').style.display = 'none';
            const selectionRectDiv = document.getElementById('screenshot-selection-rect');
            if (selectionRectDiv) selectionRectDiv.style.display = 'none';
            
            await new Promise(r => setTimeout(r, 100));
            
            const dataUrl = await ipcRenderer.invoke('annotate-capture-screen', { full: true });
            finishScreenshot(dataUrl, handleToolClick);
        },
        onScreenshotConfirm: async () => {
            const rect = getSelectionRect();
            if (rect.w === 0 || rect.h === 0) return;
            
            document.getElementById('screenshot-mask').style.display = 'none';
            document.getElementById('screenshot-minibar').style.display = 'none';
            const selectionRectDiv = document.getElementById('screenshot-selection-rect');
            if (selectionRectDiv) selectionRectDiv.style.display = 'none';
            
            await new Promise(r => setTimeout(r, 100));
            
            const dataUrl = await ipcRenderer.invoke('annotate-capture-screen', { rect });
            finishScreenshot(dataUrl, handleToolClick);
        },
        onScreenshotReselect: () => {
            const selectionRectDiv = document.getElementById('screenshot-selection-rect');
            if (selectionRectDiv) selectionRectDiv.style.display = 'none';
            document.getElementById('screenshot-minibar').style.display = 'none';
            state.screenshot.start = null;
            state.screenshot.end = null;
        }
    });
}

function enterScreenshotMode() {
    previousMode = state.MODE;
    state.MODE = 'screenshot';
    
    document.querySelector('.toolbar-container').style.display = 'none';
    ui.pageControls.style.display = 'none';
    ui.leftControls.style.display = 'none';
    
    canvasModule.canvas.style.display = 'none';
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    
    const mask = document.getElementById('screenshot-mask');
    mask.style.display = 'block';
    
    state.screenshot = {
        start: null,
        end: null,
        active: false
    };
    
    const minibar = document.getElementById('screenshot-minibar');
    minibar.style.display = 'none';
    
    let selectionRectDiv = document.getElementById('screenshot-selection-rect');
    if (!selectionRectDiv) {
        selectionRectDiv = document.createElement('div');
        selectionRectDiv.id = 'screenshot-selection-rect';
        selectionRectDiv.style.position = 'fixed';
        selectionRectDiv.style.border = '2px dashed #1890ff';
        selectionRectDiv.style.backgroundColor = 'rgba(24, 144, 255, 0.1)';
        selectionRectDiv.style.pointerEvents = 'none';
        selectionRectDiv.style.display = 'none';
        selectionRectDiv.style.zIndex = '9999';
        document.body.appendChild(selectionRectDiv);
    }
    selectionRectDiv.style.display = 'none';
}

function updateSelectionRect() {
    const selectionRectDiv = document.getElementById('screenshot-selection-rect');
    if (!selectionRectDiv) return;
    
    const r = getSelectionRect();
    selectionRectDiv.style.left = `${r.x}px`;
    selectionRectDiv.style.top = `${r.y}px`;
    selectionRectDiv.style.width = `${r.w}px`;
    selectionRectDiv.style.height = `${r.h}px`;
}

function getSelectionRect() {
    if (!state.screenshot || !state.screenshot.start || !state.screenshot.end) return { x:0, y:0, w:0, h:0 };
    const x = Math.min(state.screenshot.start.x, state.screenshot.end.x);
    const y = Math.min(state.screenshot.start.y, state.screenshot.end.y);
    const w = Math.abs(state.screenshot.start.x - state.screenshot.end.x);
    const h = Math.abs(state.screenshot.start.y - state.screenshot.end.y);
    return { x, y, w, h };
}

function finishScreenshot(dataUrl, handleToolClick) {
    ipcRenderer.send('annotate-screenshot-complete', dataUrl);
    
    state.MODE = previousMode; 
    
    document.querySelector('.toolbar-container').style.display = 'flex';
    canvasModule.canvas.style.display = 'block';

    if (state.MODE === 'annotate') {
         ui.pageControls.style.display = 'none';
         ui.leftControls.style.display = 'none';
         document.body.style.backgroundColor = 'transparent';
         document.documentElement.style.backgroundColor = 'transparent';
    } else {
         ui.pageControls.style.display = 'flex';
         ui.leftControls.style.display = 'flex';
         document.body.style.backgroundColor = 'var(--bg)';
         const currentBg = state.pageBackgrounds[state.currentPageIndex] || '#071a12';
         document.documentElement.style.setProperty('--bg', currentBg);
    }
    
    document.getElementById('screenshot-mask').style.display = 'none';
    document.getElementById('screenshot-minibar').style.display = 'none';
    const selectionRectDiv = document.getElementById('screenshot-selection-rect');
    if (selectionRectDiv) selectionRectDiv.style.display = 'none';
    
    ui.renderToolbar(handleToolClick);
}

module.exports = {
    initScreenshotListeners,
    enterScreenshotMode
};
