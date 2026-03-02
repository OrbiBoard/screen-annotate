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
            
            // Hide minibar while dragging to avoid obstruction
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
            if (rect.width > 5 && rect.height > 5) {
                // If selection exists, position near it
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
                minibar.style.transform = 'none';
            } else {
                // If simple click or tiny selection, restore default position
                minibar.style.top = '80%';
                minibar.style.left = '50%';
                minibar.style.transform = 'translateX(-50%)';
            }
        };
    }

    ui.initScreenshotUI({
        onScreenshotFull: async () => {
            document.getElementById('screenshot-mask').style.display = 'none';
            document.getElementById('screenshot-minibar').style.display = 'none';
            const selectionRectDiv = document.getElementById('screenshot-selection-rect');
            if (selectionRectDiv) selectionRectDiv.style.display = 'none';
            
            await new Promise(r => setTimeout(r, 100));
            
            const dataUrl = await ipcRenderer.invoke('annotate-capture-screen', { full: true, hideWindow: true });
            finishScreenshot(dataUrl, handleToolClick);
        },
        onScreenshotConfirm: async () => {
            const rect = getSelectionRect();
            if (rect.width === 0 || rect.height === 0) return;
            
            document.getElementById('screenshot-mask').style.display = 'none';
            document.getElementById('screenshot-minibar').style.display = 'none';
            const selectionRectDiv = document.getElementById('screenshot-selection-rect');
            if (selectionRectDiv) selectionRectDiv.style.display = 'none';
            
            await new Promise(r => setTimeout(r, 100));
            
            const dataUrl = await ipcRenderer.invoke('annotate-capture-screen', { rect, hideWindow: true });
            finishScreenshot(dataUrl, handleToolClick);
        },
        onScreenshotReselect: () => {
            const selectionRectDiv = document.getElementById('screenshot-selection-rect');
            if (selectionRectDiv) selectionRectDiv.style.display = 'none';
            // Reset position to default
            const minibar = document.getElementById('screenshot-minibar');
            minibar.style.top = '80%';
            minibar.style.left = '50%';
            minibar.style.transform = 'translateX(-50%)';
            minibar.style.display = 'flex';
            
            state.screenshot.start = null;
            state.screenshot.end = null;
        },
        onScreenshotCancel: () => {
             exitScreenshotMode(handleToolClick);
        }
    });
}

function enterScreenshotMode() {
    previousMode = state.MODE;
    state.MODE = 'screenshot';
    
    document.querySelector('.toolbar-container').style.display = 'none';
    if (ui.pageControls) ui.pageControls.style.display = 'none';
    if (ui.leftControls) ui.leftControls.style.display = 'none';
    
    // Remove toasts
    const toast1 = document.getElementById('wb-continue-toast');
    if (toast1) toast1.remove();
    const toast2 = document.getElementById('mode-toast');
    if (toast2) toast2.remove();

    // Enable mouse events for dragging
    ipcRenderer.send('annotate-set-ignore-mouse-events', false);

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
    minibar.style.display = 'flex';
    minibar.style.top = '80%';
    minibar.style.left = '50%';
    minibar.style.transform = 'translateX(-50%)';
    
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
    if (!state.screenshot || !state.screenshot.start || !state.screenshot.end) return { x:0, y:0, w:0, h:0, width: 0, height: 0 };
    const x = Math.min(state.screenshot.start.x, state.screenshot.end.x);
    const y = Math.min(state.screenshot.start.y, state.screenshot.end.y);
    const w = Math.abs(state.screenshot.start.x - state.screenshot.end.x);
    const h = Math.abs(state.screenshot.start.y - state.screenshot.end.y);
    return { x, y, w, h, width: w, height: h };
}

function finishScreenshot(dataUrl, handleToolClick) {
    if (dataUrl) {
        ipcRenderer.send('annotate-screenshot-complete', dataUrl);
    }
    exitScreenshotMode(handleToolClick);
}

function exitScreenshotMode(handleToolClick) {
    state.MODE = previousMode; 
    
    document.querySelector('.toolbar-container').style.display = 'flex';
    canvasModule.canvas.style.display = 'block';

    if (state.MODE === 'annotate') {
         if (ui.pageControls) ui.pageControls.style.display = 'none';
         if (ui.leftControls) ui.leftControls.style.display = 'none';
         document.body.style.backgroundColor = 'transparent';
         document.documentElement.style.backgroundColor = 'transparent';
         
         // Restore ignore mouse events if tool is mouse
         if (state.currentTool === 'mouse') {
             ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
         }
    } else {
         if (ui.pageControls) ui.pageControls.style.display = 'flex';
         if (ui.leftControls) ui.leftControls.style.display = 'flex';
         document.body.style.backgroundColor = 'var(--bg)';
         const currentBg = state.pageBackgrounds[state.currentPageIndex] || '#071a12';
         document.documentElement.style.setProperty('--bg', currentBg);
    }
    
    document.getElementById('screenshot-mask').style.display = 'none';
    document.getElementById('screenshot-minibar').style.display = 'none';
    const selectionRectDiv = document.getElementById('screenshot-selection-rect');
    if (selectionRectDiv) selectionRectDiv.style.display = 'none';
    
    ui.renderToolbar(handleToolClick);
    
    // Trigger interaction update
    require('./objects').updateObjectInteraction(); 
}

module.exports = {
    initScreenshotListeners,
    enterScreenshotMode
};