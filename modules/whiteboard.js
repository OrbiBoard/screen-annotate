const { ipcRenderer, desktopCapturer } = require('electron');
const state = require('./state');
const ui = require('./ui');
const canvasModule = require('./canvas');
const themeModule = require('./theme');
const objects = require('./objects');
const utils = require('./utils');
const booth = require('./booth'); // Require booth properly

async function captureScreen(hideStrokes = false) {
    const uiElementsToHide = [
        'main-toolbar', 'page-controls', 'left-controls', 'selection-toolbar', 
        'pan-overlay', 'fullscreen-browser-layer', 'tool-settings-popup', 
        'save-popup', 'adjust-popup', 'insert-menu-popup', 'page-preview-popup',
        'mode-toast', 'wb-continue-toast', 'shape-status-popup', 'gallery-view',
        'camera-popup', 'text-edit-popup', 'modal-dialog', 'media-controls',
        'volume-popup', 'edge-pan-layer', 'screenshot-mask', 'screenshot-minibar',
        'booth-controls'
    ];

    const hiddenElements = [];
    uiElementsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
             const computedStyle = window.getComputedStyle(el);
             if (computedStyle.display !== 'none') {
                 hiddenElements.push({ el, originalDisplay: el.style.display });
                 el.style.display = 'none';
             }
        }
    });
    
    let savedStrokes = null;
    if (hideStrokes) {
        const activeStrokes = state.getActiveStrokes();
        savedStrokes = [...activeStrokes];
        activeStrokes.length = 0;
        canvasModule.renderCanvas();
    }
    
    await new Promise(r => setTimeout(r, 100));
    
    try {
        const shouldHideWindow = hideStrokes || state.MODE === 'whiteboard';
        const dataUrl = await ipcRenderer.invoke('annotate-capture-screen', { 
            full: true, 
            hideWindow: shouldHideWindow 
        });
        
        hiddenElements.forEach(item => {
            if (item.originalDisplay) {
                item.el.style.display = item.originalDisplay;
            } else {
                item.el.style.removeProperty('display');
            }
        });
        
        if (hideStrokes && savedStrokes) {
            const activeStrokes = state.getActiveStrokes();
            activeStrokes.push(...savedStrokes);
            canvasModule.renderCanvas();
        }
        
        return dataUrl;
    } catch (e) {
        console.error('Screen capture failed:', e);
        hiddenElements.forEach(item => {
            if (item.originalDisplay) {
                item.el.style.display = item.originalDisplay;
            } else {
                item.el.style.removeProperty('display');
            }
        });

        if (hideStrokes && savedStrokes) {
            const activeStrokes = state.getActiveStrokes();
            activeStrokes.push(...savedStrokes);
            canvasModule.renderCanvas();
        }
        return null;
    }
}

async function switchToWhiteboard(handleToolClick) {
    const previousMode = state.MODE;
    if (state.MODE === 'booth') {
        booth.exitBoothMode(handleToolClick, () => {});
    }
    
    state.MODE = 'whiteboard';
    enterWhiteboardMode(handleToolClick);
    
    updateWhiteboardUI();
    
    if (previousMode === 'annotate') {
        ui.showContinueWhiteboardToast(
            () => {
                importBackgroundAndContinue(handleToolClick);
                ui.showModeToast('桌面批注已流转到白板', null, 1500);
            },
            () => { /* No action, just close */ }
        );
    } else if (previousMode !== 'whiteboard') {
        ui.showModeToast('当前页面为白板页面', null, 1500);
    }
}

function enterWhiteboardMode(handleToolClick, previousMode) {
    if (state.fullscreen.active) {
        objects.exitFullscreen();
    }
    state.MODE = 'whiteboard';
    ipcRenderer.send('annotate-mode-change', 'whiteboard');
    
    // Close Desktop Toolbar Window
    ipcRenderer.send('annotate-close-desktop-toolbar');

    // Ensure Booth UI is hidden
    const boothControls = document.getElementById('booth-controls');
    if (boothControls) boothControls.style.display = 'none';
    
    // Ensure Booth Video is hidden
    ipcRenderer.send('video-booth-hide');

    // Restore Booth Button in Whiteboard
    const boothBtn = document.getElementById('btn-booth-wb');
    if (boothBtn) boothBtn.style.display = '';

    // Fix: Remove temporary Whiteboard button added by Booth
    const btnToWb = document.getElementById('btn-booth-to-wb');
    if (btnToWb) btnToWb.style.display = 'none';

    state.currentTool = 'pen';
    state.isDrawing = false;
    state.lassoPoints = [];
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    
    document.getElementById('selection-toolbar').style.display = 'none';
    document.getElementById('selection-overlay').style.display = 'none';
    ui.adjustPopup.style.display = 'none';
    
    canvasModule.canvas.style.pointerEvents = 'auto';
    
    document.body.style.backgroundColor = 'var(--bg)';
    
    if (state.currentPageIndex < 0 || state.currentPageIndex >= state.pages.length) {
        state.currentPageIndex = 0;
    }
    
    const currentBg = state.pageBackgrounds[state.currentPageIndex];
    if (!currentBg || currentBg === 'var(--bg)' || currentBg === 'transparent') {
        state.pageBackgrounds[state.currentPageIndex] = '#071a12';
    }
    const bgColor = state.pageBackgrounds[state.currentPageIndex];
    document.documentElement.style.setProperty('--bg', bgColor);
    
    // Set window background color for transparent windows
    ipcRenderer.send('annotate-set-background-color', bgColor);
    
    ui.pageControls.style.display = 'flex';
    ui.leftControls.style.display = 'flex';
    
    ipcRenderer.send('annotate-set-ignore-mouse-events', false);
    
    state.currentTool = 'pen';
    ui.renderToolbar(handleToolClick);
    
    themeModule.applyTheme(state.themeMode, state.themeColor);
    
    const collapseBtn = document.getElementById('btn-collapse');
    if (collapseBtn) {
        collapseBtn.onclick = () => { ipcRenderer.send('annotate-minimize'); };
        const icon = collapseBtn.querySelector('i');
        if (icon) icon.className = 'ri-subtract-line'; 
        const span = collapseBtn.querySelector('span');
        if (span) span.textContent = '最小化';
        collapseBtn.title = '最小化';
    }
}

function updateWhiteboardUI() {
    ui.updatePageIndicator();
    canvasModule.renderCanvas();
    objects.updateDOMObjects();
    ui.updatePagePreviewIfOpen();
}

async function importBackgroundAndContinue(handleToolClick) {
    const dataUrl = await captureScreen(true);
    
    const annotationStrokes = [...state.annotate.strokes];
    
    enterWhiteboardMode(handleToolClick);
    
    if (dataUrl) {
        const imgObj = {
            type: 'image',
            src: dataUrl,
            x: 0, 
            y: 0,
            w: window.innerWidth,
            h: window.innerHeight,
            locked: true,
            isBackground: true
        };

        const img = new Image();
        img.onload = () => {
            imgObj.img = img;
            canvasModule.renderCanvas();
        };
        img.src = dataUrl;
        
        const newPageStrokes = [imgObj, ...annotationStrokes];
        
        state.pages.push(newPageStrokes);
        state.pageBackgrounds.push('#071a12'); 
        state.pageSnapshots.push(null);
        
        state.currentPageIndex = state.pages.length - 1;
    }
    
    updateWhiteboardUI();
}

function switchToAnnotate(handleToolClick) {
    state.MODE = 'annotate';
    ipcRenderer.send('annotate-mode-change', 'annotate');
    state.currentTool = 'mouse';
    
    themeModule.applyTheme(state.themeMode, state.themeColor);

    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    
    // Set window background to transparent for annotation mode
    ipcRenderer.send('annotate-set-background-color', '#00000000');
    
    ui.pageControls.style.display = 'none';
    ui.leftControls.style.display = 'none';
    
    // Switch to Desktop Toolbar Window
    ipcRenderer.send('annotate-open-desktop-toolbar');
    
    // In current window (Canvas Layer), ensure mouse passthrough if tool is mouse
    ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
    
    ui.renderToolbar(handleToolClick);
    canvasModule.renderCanvas();
    objects.updateDOMObjects();
    
    const collapseBtn = document.getElementById('btn-collapse');
    if (collapseBtn) {
        collapseBtn.onclick = () => ipcRenderer.send('annotate-minimize');
        const icon = collapseBtn.querySelector('i');
        if (icon) icon.className = 'ri-subtract-line'; 
        collapseBtn.title = '收起';
    }
    
    const toast = document.getElementById('wb-continue-toast');
    if (toast) toast.remove();
}

module.exports = {
    switchToWhiteboard,
    enterWhiteboardMode,
    switchToAnnotate,
    captureScreen
};
