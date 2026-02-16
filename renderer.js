const { ipcRenderer, desktopCapturer } = require('electron');
const { getStroke } = require('perfect-freehand');
const fs = require('fs');
const path = require('path');
const state = require('./modules/state');
const utils = require('./modules/utils');
const canvasModule = require('./modules/canvas');
const selection = require('./modules/selection');
const objects = require('./modules/objects');
const ui = require('./modules/ui');
const shapesModule = require('./modules/shapes');
const history = require('./modules/history');
const themeModule = require('./modules/theme');

let hasVideoBooth = false;

function checkVideoBoothPlugin() {
    try {
        const pluginsDir = path.resolve(__dirname, '..');
        if (fs.existsSync(path.join(pluginsDir, 'video-booth'))) {
            hasVideoBooth = true;
        }
    } catch (e) {
        console.error('Error checking video booth plugin:', e);
    }
}

// --- UI Initialization ---

function initUI() {
  checkVideoBoothPlugin();
  if (hasVideoBooth) {
      ui.enableVideoBooth();
  }

  // Request initial theme
  ipcRenderer.send('annotate-get-theme-config');
  
  canvasModule.resizeCanvas();
  window.addEventListener('resize', canvasModule.resizeCanvas);
  window.addEventListener('pointermove', (e) => {
    state.mousePos = { x: e.clientX, y: e.clientY };
    if (!state.isDrawing && state.currentTool === 'eraser') {
      canvasModule.renderCanvas(); // Redraw cursor
    }
  });

  if (state.MODE === 'annotate') {
    setupAnnotateUI();
    document.getElementById('edge-pan-layer').style.display = 'none';
    // Transparent window needs special mouse handling
    setupMousePassthrough();
    // Fix: Transparent background for annotation mode
    document.body.style.backgroundColor = 'transparent';
    canvasModule.canvas.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
  } else {
    setupWhiteboardUI();
    ui.pageControls.style.display = 'flex';
    ui.leftControls.style.display = 'flex';
    canvasModule.canvas.style.backgroundColor = 'transparent'; 
    // Fix for Issue 1: Set initial background
    if (state.pageBackgrounds[state.currentPageIndex]) {
        document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
    } else {
        document.body.style.backgroundColor = 'var(--bg)'; 
    }
  }

  ui.renderToolbar(handleToolClick);
  canvasModule.renderCanvas();
  
  // Bind UI callbacks
  ui.bindSettingsUI({
      onPrevPage: () => {
        if (state.currentPageIndex > 0) {
            ui.updateCurrentPageSnapshot();
            state.currentPageIndex--;
            state.redoStack = [];
            
            // Fix for Issue 1: Sync background
            if (state.pageBackgrounds[state.currentPageIndex]) {
                document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
                themeModule.applyTheme(state.themeMode, state.themeColor);
            }
            
            ui.updatePageIndicator();
            canvasModule.renderCanvas();
            objects.updateDOMObjects();
            ui.updatePagePreviewIfOpen();
        }
      },
      onNextPage: () => {
        if (state.currentPageIndex === state.pages.length - 1) {
            ui.updateCurrentPageSnapshot();
            state.pages.push([]);
            // Fix for Issue 1: New page inherits current background or default? Usually default or current.
            // Let's inherit current for continuity.
            const currentBg = state.pageBackgrounds[state.currentPageIndex] || 'var(--bg)';
            state.pageBackgrounds.push(currentBg);
        } else {
            ui.updateCurrentPageSnapshot();
        }
        state.currentPageIndex++;
        state.redoStack = [];
        
        // Fix for Issue 1: Sync background
        if (state.pageBackgrounds[state.currentPageIndex]) {
            document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
            themeModule.applyTheme(state.themeMode, state.themeColor);
        }
        
        ui.updatePageIndicator();
        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        ui.updatePagePreviewIfOpen();
      },
      onInsertPage: () => {
        ui.updateCurrentPageSnapshot();
        state.pages.splice(state.currentPageIndex + 1, 0, []);
        state.pageSnapshots.splice(state.currentPageIndex + 1, 0, null);
        
        // Fix for Issue 1: Insert background
        const currentBg = state.pageBackgrounds[state.currentPageIndex] || 'var(--bg)';
        state.pageBackgrounds.splice(state.currentPageIndex + 1, 0, currentBg);
        
        state.currentPageIndex++;
        state.redoStack = [];
        
        // Fix for Issue 1: Sync background
        if (state.pageBackgrounds[state.currentPageIndex]) {
            document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
            themeModule.applyTheme(state.themeMode, state.themeColor);
        }
        
        ui.updatePageIndicator();
        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        ui.updatePagePreviewIfOpen();
      },
      onSave: ui.showSavePopup,
      onDeletePage: deletePage,
      applyAdjustment: applyAdjustment
  });
  
  ui.updatePageIndicator();
  objects.updateObjectInteraction(); 

  // Listen for theme config
  ipcRenderer.on('annotate-theme-config-reply', (event, { mode, color }) => {
      state.themeMode = mode;
      state.themeColor = color;
      themeModule.applyTheme(mode, color);
  });

  // Watch for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.themeMode === 'system') {
          themeModule.applyTheme('system', state.themeColor);
      }
  });
}

function setupAnnotateUI() {
  // Annotation specific logic
}

function setupWhiteboardUI() {
  // Whiteboard specific logic
}

let isMousePassthroughSetup = false;
function setupMousePassthrough() {
  if (isMousePassthroughSetup) {
      // Just reset initial state
      if (state.currentTool === 'mouse') {
        ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
      }
      return;
  }
  isMousePassthroughSetup = true;

  // Only for annotate mode
  const container = document.querySelector('.toolbar-container');
  
  container.addEventListener('mouseenter', () => {
    ipcRenderer.send('annotate-set-ignore-mouse-events', false);
  });
  
  container.addEventListener('mouseleave', () => {
    // If we are in 'mouse' mode, we ignore mouse on the canvas area
    if (state.currentTool === 'mouse') {
      ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
    }
  });

  // Initial state
  if (state.currentTool === 'mouse') {
    ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
  }
}

// Zoom support
window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
        const zoomSpeed = 0.001;
        const delta = -e.deltaY * zoomSpeed;
        const newZoom = Math.min(Math.max(state.camera.z + delta, 0.1), 10);
        
        // Zoom towards mouse
        // World before zoom
        const wx = (e.clientX - state.camera.x) / state.camera.z;
        const wy = (e.clientY - state.camera.y) / state.camera.z;
        
        state.camera.z = newZoom;
        
        // Adjust camera x/y to keep world point under mouse
        state.camera.x = e.clientX - wx * newZoom;
        state.camera.y = e.clientY - wy * newZoom;
        
        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        require('./modules/ui').updateMinimap();
    }
}, { passive: false });

function handleToolClick(toolId) {
  if (toolId === 'close') {
    if (state.MODE === 'booth') {
        exitBoothMode();
    } else {
        ipcRenderer.send('annotate-close');
    }
    return;
  }
  if (toolId === 'booth') {
      enterBoothMode();
      return;
  }
  if (toolId === 'photo') {
      ipcRenderer.send('video-booth-capture');
      return;
  }
  if (toolId === 'gallery') {
      openGallery();
      return;
  }
  if (toolId === 'undo') {
    performUndo();
    return;
  }
  if (toolId === 'redo') {
    performRedo();
    return;
  }
  if (toolId === 'clear') {
    // Clear only current strokes (fullscreen or page)
    if (state.fullscreen.active) {
        state.fullscreen.strokes = [];
    } else {
        state.pages[state.currentPageIndex] = [];
    }
    canvasModule.renderCanvas();
    ui.renderToolbar(handleToolClick); 
    return;
  }
  if (toolId === 'save') {
    ui.showSavePopup();
    return;
  }
  if (toolId === 'whiteboard') {
      switchToWhiteboard();
      return;
  }

  // Clear selection if switching tool
  if (toolId !== 'select') {
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    document.getElementById('selection-toolbar').style.display = 'none';
    document.getElementById('selection-overlay').style.display = 'none';
    ui.adjustPopup.style.display = 'none';
  }
  
  // Double click menu logic
  if (state.currentTool === toolId) {
    if (toolId === 'pen') {
      ui.toggleToolMenu('pen');
      return;
    }
    if (toolId === 'eraser') {
      ui.toggleToolMenu('eraser');
      return;
    }
    if (toolId === 'pan') {
      ui.toggleToolMenu('pan');
      return;
    }
    if (toolId === 'shape') {
      ui.toggleToolMenu('shape');
      return;
    }
    if (toolId === 'select') {
        // Select all strokes
        const strokes = state.getActiveStrokes();
        if (strokes.length > 0) {
            state.selectedStrokeIndices = strokes.map((_, i) => i);
            selection.updateSelectionBounds();
            selection.showSelectionToolbar();
            canvasModule.renderCanvas();
            objects.updateDOMObjects();
        }
        return;
    }
  } else {
    // Switching tools, close menu
    ui.toolSettingsPopup.style.display = 'none';
    state.isMenuOpen = false;
  }

  const prevTool = state.currentTool; // Fix for Issue 1: Capture prev tool
  state.currentTool = toolId;
  
  // Update interaction state for DOM objects
  objects.updateObjectInteraction();

  // Ensure fullscreen browser layer allows events
  const fsBrowser = document.getElementById('fullscreen-browser-layer');
  if (fsBrowser && fsBrowser.style.display !== 'none') {
    fsBrowser.style.pointerEvents = 'auto';
  }

    if (state.MODE === 'annotate' && state.MODE !== 'booth') {
    if (state.currentTool === 'mouse') {
       ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
    } else {
       ipcRenderer.send('annotate-set-ignore-mouse-events', false);
    }
    // Fix: Ensure window is always top when active
    ipcRenderer.send('annotate-set-always-on-top', true);
  }

  ui.renderToolbar(handleToolClick);
  canvasModule.renderCanvas();
  
  // Fix for Issue 1: Open menu if switching to shape
  if (toolId === 'shape') {
      if (prevTool !== 'shape') {
          ui.toggleToolMenu('shape');
      }
  } else {
      ui.updateShapeStatus('', 0); // Hide
      state.pendingShape = null;
  }
}

// --- Window Listener for Selection (Capture Phase) ---
// Handles clicking on Ink through the transparent canvas
window.addEventListener('pointerdown', (e) => {
    if (state.currentTool !== 'select') return;
    
    // Check if we hit a DOM object (which handles its own selection via attachObjectListeners)
    // If e.target is a DOM object or inside one, we let it handle it.
    // Note: Since we use Capture, we see it first.
    // But we want to prioritize Ink (Visual Top) over DOM (Visual Bottom)?
    // User Expectation: Click on what you see.
    // Ink is Z-20. DOM is Z-10. Ink is on top.
    // So if Ink is hit, we should select Ink and STOP DOM selection.
    
    const point = utils.getPoint(e);
    
    // Hit test for Ink / Shapes
    const strokes = state.getActiveStrokes();
    let hitIndex = -1;
    
    for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
        if (stroke.type === 'pen') {
            if (!stroke.points || stroke.points.length < 2) continue;
            
            // Fast Bounds
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of stroke.points) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
            const padding = (stroke.size || 5) / 2 + 10;
            if (point.x < minX - padding || point.x > maxX + padding || 
                point.y < minY - padding || point.y > maxY + padding) {
                continue;
            }
            
            // Precise Check
            const outline = getStroke(stroke.points, {
                size: stroke.size,
                thinning: stroke.taper ? 0.7 : 0,
                smoothing: 0.5,
                streamline: 0.5,
                start: { taper: stroke.taper ? stroke.size : 0, easing: (t) => t },
                end: { taper: stroke.taper ? stroke.size : 0, easing: (t) => t }
            });
            const polygon = outline.map(p => ({ x: p[0], y: p[1] }));
            if (utils.isPointInPolygon(point, polygon)) {
                hitIndex = i;
                break;
            }
        } else if (stroke.type === 'shape') {
            if (utils.isPointInShape(point, stroke)) {
                hitIndex = i;
                break;
            }
        }
    }
    
    if (hitIndex !== -1) {
        // Hit Ink/Shape -> Select it and Stop Propagation (prevent DOM select or Lasso)
        state.selectedStrokeIndices = [hitIndex];
        selection.updateSelectionBounds();
        selection.showSelectionToolbar();
        state.isMovingSelection = true; 
        state.dragStart = point;
        state.originalSelectionStrokes = selection.cloneStrokes(state.selectedStrokeIndices);
        state.isDrawing = true;
        
        canvasModule.renderCanvas();
        e.stopPropagation();
        e.preventDefault(); // Prevent focus change?
        
        // We need to attach move listeners here because we are "stealing" the event
        const onMove = (em) => {
            if (!state.isMovingSelection) return;
            canvasModule.autoPanOnEdge(em.clientX, em.clientY);
            const cm = state.getActiveCamera();
            const p = { x: (em.clientX - cm.x) / cm.z, y: (em.clientY - cm.y) / cm.z };
            const dx = p.x - state.dragStart.x;
            const dy = p.y - state.dragStart.y;
            selection.moveSelection(dx, dy);
            canvasModule.renderCanvas();
            objects.updateDOMObjects();
            selection.updateSelectionToolbarPosition();
        };
        
        const onUp = () => {
            state.isMovingSelection = false;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return;
    }
    
    // If no Ink hit, let it bubble. 
    // If it hits a DOM object, the DOM object's listener (pointerdown) will fire.
    // If it hits nothing (body), it will bubble to the Window Bubble Listener (Lasso).
    
}, { capture: true });

// --- Canvas Interaction ---

canvasModule.canvas.addEventListener('pointerdown', (e) => {
  if (state.currentTool === 'mouse') return;
  if (e.button !== 0) return; // Only left click
  
  // Close menu if clicking on canvas
  if (state.isMenuOpen) {
    ui.toolSettingsPopup.style.display = 'none';
    state.isMenuOpen = false;
  }
  
  // Hide Edge Pan Buttons
  document.querySelectorAll('.edge-pan-btn').forEach(b => b.classList.remove('visible'));
  
  if (ui.adjustPopup.style.display !== 'none') {
    ui.adjustPopup.style.display = 'none';
  }
  if (ui.insertMenuPopup.style.display !== 'none') {
    ui.insertMenuPopup.style.display = 'none';
  }

  canvasModule.canvas.setPointerCapture(e.pointerId);
  const point = utils.getPoint(e);
  
  if (state.currentTool === 'pan') {
    state.isPanning = true;
    state.panStart = { x: e.clientX, y: e.clientY };
    state.panStartCamera = { ...state.getActiveCamera() }; // Capture start state for Undo
    state.isDrawing = true;
    return;
  }
  
  if (state.currentTool === 'shape') {
    state.isDrawing = true;
    // For pending shape, we keep the start/end from step 1
    if (!state.pendingShape) {
        state.shapeStart = point;
    }
    return;
  }
  
  if (state.currentTool === 'select') {
    // Check if hitting selection handles or body
    if (state.selectionBounds) {
      const handle = utils.getHitHandle(point);
      if (handle !== -1) {
        state.isResizingSelection = true;
        state.resizeHandleIndex = handle;
        state.dragStart = point;
        state.originalSelectionStrokes = selection.cloneStrokes(state.selectedStrokeIndices);
        state.isDrawing = true;
        return;
      }
      if (utils.isPointInRect(point, state.selectionBounds)) {
        state.isMovingSelection = true;
        state.dragStart = point;
        state.originalSelectionStrokes = selection.cloneStrokes(state.selectedStrokeIndices);
        state.isDrawing = true;
        return;
      }
    }

    // Hit test for Single Click Selection (Images/Objects/Strokes)
    // NOTE: This logic is now partially handled by the Window Capture Listener for Ink
    // and DOM objects handle themselves.
    // BUT, if we are here, it means we clicked on Canvas (which has pointer-events: auto in some cases?)
    // In 'select' mode, we set canvas to 'none' in objects.js.
    // So this listener SHOULD NOT FIRE for clicks on canvas in select mode!
    // However, if we click on Selection Box (which is DOM), this listener doesn't fire.
    // If we click on Handles, they have their own listeners.
    // So this block is largely redundant if canvas is none.
    // EXCEPT if we decide to keep canvas auto for some reason.
    // For now, let's keep it but it might not be reached.
    
    // ... (Existing hit test logic removed as it's moved to window listener or redundant)
    
    // Start new selection (Lasso) - Moved to Window Bubble Listener (below)
    // state.lassoPoints = [point]; 
    // ...
    // return;
  }

  if (state.currentTool === 'pen' || (state.currentTool === 'eraser' && state.eraserType === 'point')) {
    state.isDrawing = true;
    state.drawStartTime = Date.now();
    state.drawStartPoint = point;
    if (state.currentTool === 'eraser') {
        canvasModule.performEraserAction(point);
    } else {
        state.currentPoints = [point];
    }
    canvasModule.renderCanvas(); // Fix for Issue 4: Render immediately on click
  }
});

canvasModule.canvas.addEventListener('pointermove', (e) => {
  // Update mousePos for smooth preview
  state.mousePos = { x: e.clientX, y: e.clientY };
  
  if (!state.isDrawing && !state.pendingShape) {
      // Just hover logic
      // ...
  }
  
  if (!state.isDrawing && !state.pendingShape) return;
  
  if (state.currentTool === 'pan' && state.isPanning) {
    const dx = e.clientX - state.panStart.x;
    const dy = e.clientY - state.panStart.y;
    
    const camera = state.getActiveCamera();
    camera.x += dx;
    camera.y += dy;
    
    state.panStart = { x: e.clientX, y: e.clientY };
    canvasModule.renderCanvas();
    objects.updateDOMObjects(); 
    require('./modules/ui').updateMinimap();
    return;
  }

  if (state.currentTool === 'shape') {
      canvasModule.renderCanvas();
      return;
  }

  if (state.currentTool === 'select') {
    const point = utils.getPoint(e);
    
    if (state.isMovingSelection) {
      // Auto-Pan
      const panned = canvasModule.autoPanOnEdge(e.clientX, e.clientY);
      
      // If panned, we need to re-calculate dx/dy relative to NEW camera position
      // moveSelection uses state.dragStart (world pos at start) and current mouse world pos.
      // If camera moves, current mouse world pos changes, so moveSelection logic still holds.
      // But we need to ensure renderCanvas happens.
      // moveSelection calls renderCanvas.
      
      const dx = point.x - state.dragStart.x;
      const dy = point.y - state.dragStart.y;
      selection.moveSelection(dx, dy);
      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      
      // Fix: Update media controls position during drag
      if (state.activeMedia) {
          const wrapper = document.querySelector(`.dom-object-wrapper[data-id="obj-${state.activeMedia.index}"]`);
          if (wrapper) {
               // We need to call updateMediaControlsPosition from objects module
               // But it's not exported directly? It is not.
               // It is called inside updateDOMObjects, so it should be fine?
               // updateDOMObjects calls updateMediaControlsPosition(wrapper).
               // So if updateDOMObjects is called, controls should move.
               // Let's double check objects.js
          }
      }
      
      selection.updateSelectionToolbarPosition();
      return;
    }
    
    if (state.isResizingSelection) {
      // Auto-Pan for resize too? User only asked for "move canvas when dragging". 
      // Usually dragging resize handle to edge should also pan.
      // Let's enable it for resize too.
      canvasModule.autoPanOnEdge(e.clientX, e.clientY);
      
      selection.resizeSelection(point);
      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      selection.updateSelectionToolbarPosition();
      return;
    }

    state.lassoPoints.push(point);
    canvasModule.renderCanvas();
    
    // Check Edge Pan Buttons for Lasso or just moving mouse?
    // User said "Select, Eraser also use canvas auxiliary move".
    // "Auxiliary move" means the buttons.
    // So we should call checkEdgePan(point) here if NOT drawing/dragging?
    // If we are drawing lasso, we are 'drawing'. checkEdgePan returns if isDrawing?
    // checkEdgePan checks isPanning/isMovingSelection. It doesn't check isDrawing explicitly.
    // But we should probably not show buttons while lassoing.
    // But if just moving mouse (hover), show buttons.
    return;
  }
  
  // Show Edge Pan Buttons for Select Tool (Hover)
  if (state.currentTool === 'select' && !state.isDrawing && !state.isMovingSelection && !state.isResizingSelection) {
      const point = utils.getPoint(e);
      checkEdgePan(point);
  }

  if (state.currentTool === 'pen' || state.currentTool === 'eraser') {
    if (state.currentTool === 'eraser') {
        const point = utils.getPoint(e);
        canvasModule.performEraserAction(point);
        checkEdgePan(point); // Enable for Eraser
    } else {
        const point = utils.getPoint(e);
        state.currentPoints.push(point);
        
        // Edge Pan Assist Check
        checkEdgePan(point);
    }
    canvasModule.renderCanvas();
  }
});

// Edge Pan Logic
function checkEdgePan(point) {
    // Only if not dragging something else?
    if (state.isPanning || state.isMovingSelection) return;

    // Convert world point to screen point
    const camera = state.getActiveCamera();
    const sx = (point.x * camera.z) + camera.x;
    const sy = (point.y * camera.z) + camera.y;
    
    // Expand trigger area to 100px
    const edgeThreshold = 100; // px
    const w = window.innerWidth;
    
    // Exclude bottom toolbar area from height calculation
    // Toolbar is at bottom ~100px? (Bottom controls)
    // Actually, let's just trigger above the toolbar.
    // Toolbar height is approx 80px (including padding/margin)
    const toolbarHeight = 100;
    const h = window.innerHeight - toolbarHeight;
    
    const isTop = sy < edgeThreshold;
    const isBottom = sy > h - edgeThreshold && sy < window.innerHeight; // Still valid if below virtual bottom but above real bottom?
    // Wait, if I write near toolbar, I want to pan down.
    // So "bottom edge" is effectively moved up.
    
    const isLeft = sx < edgeThreshold;
    const isRight = sx > w - edgeThreshold;
    
    // Reset all
    document.querySelectorAll('.edge-pan-btn').forEach(btn => {
        btn.classList.remove('visible');
        // Reset dynamic positions
        btn.style.top = '';
        btn.style.left = '';
        btn.style.bottom = '';
        btn.style.right = '';
        btn.style.transform = '';
    });
    
    let activeBtn = null;
    
    if (isTop && isLeft) activeBtn = document.querySelector('.edge-pan-btn.corner.tl');
    else if (isTop && isRight) activeBtn = document.querySelector('.edge-pan-btn.corner.tr');
    else if (isBottom && isLeft) activeBtn = document.querySelector('.edge-pan-btn.corner.bl');
    else if (isBottom && isRight) activeBtn = document.querySelector('.edge-pan-btn.corner.br');
    else if (isTop) activeBtn = document.querySelector('.edge-pan-btn.top');
    else if (isBottom) activeBtn = document.querySelector('.edge-pan-btn.bottom');
    else if (isLeft) activeBtn = document.querySelector('.edge-pan-btn.left');
    else if (isRight) activeBtn = document.querySelector('.edge-pan-btn.right');
    
    if (activeBtn) {
        activeBtn.classList.add('visible');
        
        // Dynamic Positioning near cursor
        // We want the button to be close to cursor but not under it.
        // Offset 60px from cursor?
        const offset = 60;
        
        // We need to override CSS positioning
        activeBtn.style.position = 'absolute';
        activeBtn.style.transform = 'translate(-50%, -50%)'; // Center anchor
        
        // Constrain to screen bounds?
        let targetX = sx;
        let targetY = sy;
        
        if (activeBtn.classList.contains('top')) {
            targetY = sy + offset;
        } else if (activeBtn.classList.contains('bottom')) {
            targetY = sy - offset;
        } else if (activeBtn.classList.contains('left')) {
            targetX = sx + offset;
        } else if (activeBtn.classList.contains('right')) {
            targetX = sx - offset;
        } else if (activeBtn.classList.contains('tl')) {
            targetX = sx + offset/1.4;
            targetY = sy + offset/1.4;
        } else if (activeBtn.classList.contains('tr')) {
            targetX = sx - offset/1.4;
            targetY = sy + offset/1.4;
        } else if (activeBtn.classList.contains('bl')) {
            targetX = sx + offset/1.4;
            targetY = sy - offset/1.4;
        } else if (activeBtn.classList.contains('br')) {
            targetX = sx - offset/1.4;
            targetY = sy - offset/1.4;
        }
        
        // Ensure button doesn't go off screen
        targetX = Math.max(30, Math.min(w - 30, targetX));
        targetY = Math.max(30, Math.min(window.innerHeight - 30, targetY)); // Use full height for clamping
        
        activeBtn.style.left = `${targetX}px`;
        activeBtn.style.top = `${targetY}px`;
        activeBtn.style.bottom = 'auto';
        activeBtn.style.right = 'auto';
    }
}

// Edge Pan Button Click Handlers
document.querySelectorAll('.edge-pan-btn').forEach(btn => {
    // Use pointerdown to avoid breaking the drawing flow?
    // Actually user has to click it. If they click it, they stop drawing?
    // "点击后向相应区域漫游一块（保持书写状态）" -> "Click to pan ... (maintain writing state)"
    // If they click the button, pointerdown fires on button.
    // If they are currently drawing (pointerdown on canvas), they can't click the button without releasing pointer first?
    // UNLESS the button appears under the pen? 
    // "在当前视图边缘书写时显示...点击后..."
    // If I am writing at the edge, I lift the pen, click the button, and the canvas moves?
    // "保持书写状态" might mean "Don't exit Pen tool".
    // Or it means "Move canvas, but let me continue the SAME stroke"? 
    // If I lift pen, the stroke ends.
    // Maybe they mean "Don't switch to Pan tool".
    
    btn.onclick = (e) => {
        e.stopPropagation(); // Don't trigger canvas click
        const dir = btn.dataset.direction;
        const panAmount = 200; // px
        const camera = state.getActiveCamera();
        
        // Move camera in opposite direction to show new area
        if (dir.includes('up') || dir === 'tl' || dir === 'tr') camera.y += panAmount;
        if (dir.includes('down') || dir === 'bl' || dir === 'br') camera.y -= panAmount;
        if (dir.includes('left') || dir === 'tl' || dir === 'bl') camera.x += panAmount;
        if (dir.includes('right') || dir === 'tr' || dir === 'br') camera.x -= panAmount;
        
        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        require('./modules/ui').updateMinimap();
        
        // Hide buttons after click? Or keep them if mouse is still there?
        // Mouse is there.
        // Let's re-check?
        // But point is relative to screen. If camera moves, world point under mouse changes.
        // Screen point stays same. So buttons should stay visible?
    };
    
    // Prevent button click from stealing focus or changing tool?
    // Default click behavior is fine.
});

canvasModule.canvas.addEventListener('pointerup', (e) => {
  if (!state.isDrawing) return;
  const wasDrawingWithPen = state.currentTool === 'pen' && state.currentPoints.length > 0;

  state.isDrawing = false;
  
  if (wasDrawingWithPen) {
    const drawEndTime = Date.now();
    const drawDuration = drawEndTime - state.drawStartTime;
    const lastPoint = state.currentPoints[state.currentPoints.length - 1];
    const dx = lastPoint.x - state.drawStartPoint.x;
    const dy = lastPoint.y - state.drawStartPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (drawDuration < 200 && distance < 10) {
        const cam = state.getActiveCamera();
        const screenPos = {
            x: state.drawStartPoint.x * cam.z + cam.x,
            y: state.drawStartPoint.y * cam.z + cam.y
        };
        ui.showModeToast(state.currentTool, screenPos);
    }
  }
  
  if (state.isPanning) {
      state.isPanning = false;
      const cam = state.getActiveCamera();
      // Check if actually moved
      if (state.panStartCamera && (cam.x !== state.panStartCamera.x || cam.y !== state.panStartCamera.y)) {
          history.pushAction({
              type: 'pan',
              before: state.panStartCamera,
              after: { ...cam }
          });
      }
  }

  state.isMovingSelection = false;
  state.isResizingSelection = false;
  canvasModule.canvas.releasePointerCapture(e.pointerId);
  
  if (state.currentTool === 'select') {
    if (state.lassoPoints.length > 0) {
      selection.performLassoSelection();
      state.lassoPoints = [];
    }
    if (state.selectedStrokeIndices.length > 0) {
      selection.updateSelectionBounds();
      selection.showSelectionToolbar();
    }
    canvasModule.renderCanvas();
    objects.updateDOMObjects();
    return;
  }

  if (state.currentTool === 'shape') {
      const point = utils.getPoint(e);
      // Wait for user to select a shape if currentShape is null
      if (!state.currentShape) return;
      
      const isComplex = shapesModule.isComplexShape(state.currentShape);
      
      const shape = {
          type: 'shape',
          shapeType: state.currentShape,
          color: state.penColor,
          size: state.penSize
      };
      
      if (!state.pendingShape) {
          // Step 1 finished
          shape.start = state.shapeStart;
          shape.end = point;
          
          // Auto-adjust for Square/Circle
          shape.end = shapesModule.adjustShapePoints(state.currentShape, shape.start, shape.end);
          
          if (isComplex) {
              state.pendingShape = { start: shape.start, end: shape.end };
              // Update UI to Step 2
              ui.updateShapeStatus(state.currentShape, 2);
          } else {
              const strokes = state.getActiveStrokes();
              strokes.push(shape);
              history.pushAction({ type: 'add', strokes: [shape] });
              
              // Finish Single Step Shape
              if (!state.isShapePinned) {
                  // Switch back to Pen
                  handleToolClick('pen');
              }
          }
      } else {
          // Step 2 finished
          let dEnd = point;
          
          if (state.currentShape === 'axis-xy' || state.currentShape === 'axis-xyz') {
              dEnd = shapesModule.snapToPerpendicular(state.pendingShape.start, state.pendingShape.end, dEnd);
          } else if (state.currentShape === 'cuboid') {
              const ref = { x: state.pendingShape.start.x + 1, y: state.pendingShape.start.y };
              dEnd = shapesModule.snapToPerpendicular(state.pendingShape.start, ref, dEnd);
          }
          
          shape.start = state.pendingShape.start;
          shape.end = state.pendingShape.end;
          shape.depthEnd = dEnd;
          shape.step = 2;
          
          const strokes = state.getActiveStrokes();
          strokes.push(shape);
          history.pushAction({ type: 'add', strokes: [shape] });
          state.pendingShape = null;
          
          // Finish Multi Step Shape
          if (!state.isShapePinned) {
              handleToolClick('pen');
          } else {
              // Reset status to step 1
              ui.updateShapeStatus(state.currentShape, 1);
          }
      }
      
      canvasModule.renderCanvas();
      if (state.currentTool === 'shape') { // Only render toolbar if still in shape mode
          ui.renderToolbar(handleToolClick);
      }
      return;
  }

  if (state.currentTool === 'pen') {
    const stroke = {
      type: state.currentTool,
      points: state.currentPoints,
      color: state.penColor,
      size: state.penSize,
      taper: state.penTaper
    };
    
    const strokes = state.getActiveStrokes();
    strokes.push(stroke);
    
    history.pushAction({ type: 'add', strokes: [stroke] });
    
    canvasModule.renderCanvas();
    ui.renderToolbar(handleToolClick);
  }
});

function performUndo() {
  history.undo();
}

function performRedo() {
  history.redo();
}

function deletePage(index) {
    if (state.pages.length <= 1) {
        state.pages[0] = [];
        state.pageSnapshots[0] = null;
        canvasModule.renderCanvas();
        ui.renderPagePreview(deletePage);
        return;
    }
    
    state.pages.splice(index, 1);
    state.pageSnapshots.splice(index, 1);
    // Fix for Issue 1: Remove background
    state.pageBackgrounds.splice(index, 1);
    
    if (state.currentPageIndex >= state.pages.length) {
        state.currentPageIndex = state.pages.length - 1;
    } else if (state.currentPageIndex > index) {
        state.currentPageIndex--;
    }
    
    // Fix for Issue 1: Sync background
    if (state.pageBackgrounds[state.currentPageIndex]) {
        document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
        themeModule.applyTheme(state.themeMode, state.themeColor);
    }
    
    canvasModule.renderCanvas();
    ui.updatePageIndicator();
    ui.renderPagePreview(deletePage);
    objects.updateDOMObjects();
}

function exportImage() {
    const dataUrl = canvasModule.canvas.toDataURL('image/png');
    ipcRenderer.send('annotate-save-image', dataUrl);
}

// --- Whiteboard Integration ---

async function captureScreen(hideStrokes = false) {
    // Hide UI elements to capture clean screen
    const toolbar = document.getElementById('main-toolbar');
    toolbar.style.display = 'none';
    
    // Temporarily hide strokes if requested (to get clean background)
    let savedStrokes = null;
    if (hideStrokes) {
        const activeStrokes = state.getActiveStrokes();
        savedStrokes = [...activeStrokes];
        activeStrokes.length = 0; // Clear in place
        canvasModule.renderCanvas();
    }
    
    // Wait for UI update
    await new Promise(r => setTimeout(r, 100));
    
    try {
        const sources = await desktopCapturer.getSources({ 
            types: ['screen'], 
            thumbnailSize: { 
                width: window.screen.width, 
                height: window.screen.height 
            } 
        });
        
        // Restore UI
        toolbar.style.display = 'flex';
        
        if (hideStrokes && savedStrokes) {
            const activeStrokes = state.getActiveStrokes();
            activeStrokes.push(...savedStrokes);
            canvasModule.renderCanvas();
        }
        
        // Find primary display or current display? Assuming primary/first for now.
        return sources[0].thumbnail.toDataURL();
    } catch (e) {
        console.error('Screen capture failed:', e);
        toolbar.style.display = 'flex';
        if (hideStrokes && savedStrokes) {
            const activeStrokes = state.getActiveStrokes();
            activeStrokes.push(...savedStrokes);
            canvasModule.renderCanvas();
        }
        return null;
    }
}

async function switchToWhiteboard(importContent) {
    if (state.MODE !== 'whiteboard') {
        // Show Toast first, stay in Annotate Mode visually
        ui.showContinueWhiteboardToast(
            () => importBackgroundAndContinue(),
            () => {
                // No: Just switch to Whiteboard (fresh or existing)
                enterWhiteboardMode();
                updateWhiteboardUI();
            }
        );
    }
}

function enterWhiteboardMode() {
    state.MODE = 'whiteboard';
    
    // Set up Whiteboard UI defaults
    document.body.style.backgroundColor = 'var(--bg)';
    
    // Ensure we have a valid page index
    if (state.currentPageIndex < 0 || state.currentPageIndex >= state.pages.length) {
        state.currentPageIndex = 0;
    }
    
    const currentBg = state.pageBackgrounds[state.currentPageIndex];
    if (!currentBg || currentBg === 'var(--bg)' || currentBg === 'transparent') {
        state.pageBackgrounds[state.currentPageIndex] = '#071a12';
    }
    document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
    
    ui.pageControls.style.display = 'flex';
    ui.leftControls.style.display = 'flex';
    
    ipcRenderer.send('annotate-set-ignore-mouse-events', false);
    
    state.currentTool = 'pen';
    ui.renderToolbar(handleToolClick);
    
    // Update Theme for Whiteboard Mode
    themeModule.applyTheme(state.themeMode, state.themeColor);
    
    // Update Collapse Button
    const collapseBtn = document.getElementById('btn-collapse');
    if (collapseBtn) {
        collapseBtn.onclick = () => { switchToAnnotate(); };
        const icon = collapseBtn.querySelector('i');
        if (icon) icon.className = 'ri-arrow-go-back-line'; 
        collapseBtn.title = '返回批注模式';
    }
}

function updateWhiteboardUI() {
    ui.updatePageIndicator();
    canvasModule.renderCanvas();
    objects.updateDOMObjects();
    ui.updatePagePreviewIfOpen();
}

async function importBackgroundAndContinue() {
    // 1. Capture Screen (Current Annotate State)
    // We are still in 'annotate' mode (implied), so captureScreen will hide annotate strokes.
    const dataUrl = await captureScreen(true);
    
    // 2. Clone current strokes (Annotate strokes)
    const annotationStrokes = [...state.annotate.strokes];
    
    // 3. Switch Mode
    enterWhiteboardMode();
    
    // 4. Create NEW page for Whiteboard
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
        
        // Switch to new page
        state.currentPageIndex = state.pages.length - 1;
    }
    
    updateWhiteboardUI();
}

function switchToAnnotate() {
    state.MODE = 'annotate';
    state.currentTool = 'mouse';
    
    // Restore Theme for Annotate Mode
    themeModule.applyTheme(state.themeMode, state.themeColor);

    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    
    ui.pageControls.style.display = 'none';
    ui.leftControls.style.display = 'none';
    
    // No need to restore page index, getActiveStrokes handles it.

    setupMousePassthrough();
    
    ui.renderToolbar(handleToolClick);
    canvasModule.renderCanvas();
    
    // Restore Collapse Button
    const collapseBtn = document.getElementById('btn-collapse');
    if (collapseBtn) {
        collapseBtn.onclick = () => ipcRenderer.send('annotate-minimize');
        const icon = collapseBtn.querySelector('i');
        if (icon) icon.className = 'ri-subtract-line'; 
        collapseBtn.title = '收起';
    }
    
    // Remove Toast if exists
    const toast = document.getElementById('wb-continue-toast');
    if (toast) toast.remove();
}

// --- IPC Handling for Media ---
ipcRenderer.on('annotate-insert-media-reply', (event, { type, path, dataUrl }) => {
    // If fullscreen, we probably shouldn't allow inserting media (as per user implication of 'separate layer')
    // But if we did, it would go into fullscreen strokes. 
    // For now, let's assume it goes to the current active layer (which IS fullscreen strokes if active).
    const strokes = state.getActiveStrokes();
    const camera = state.getActiveCamera();
    
    if (type === 'image-data' && dataUrl) {
        // Insert captured screenshot
        const img = new Image();
        img.onload = () => {
            const center = utils.getScreenCenterWorld(); 
            // utils.getScreenCenterWorld reads state.camera directly. 
            // We should update utils or manually calculate center.
            const cx = (window.innerWidth / 2 - camera.x) / camera.z;
            const cy = (window.innerHeight / 2 - camera.y) / camera.z;
            
            const { w, h } = utils.getFittedSize(img.width, img.height);
            
            const obj = {
                type: 'image',
                img: img,
                src: dataUrl, // Use dataUrl as source
                x: cx - w / 2,
                y: cy - h / 2,
                w: w,
                h: h
            };
            strokes.push(obj);
            history.pushAction({ type: 'add', strokes: [obj] });
            canvasModule.renderCanvas();
        };
        img.src = dataUrl;
        return;
    }
    
    if (type === 'file' && path) {
        const ext = path.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            const img = new Image();
            img.onload = () => {
                const center = utils.getScreenCenterWorld(); // Uses state.camera, need to ensure it uses active camera?
                // utils.getScreenCenterWorld reads state.camera directly. 
                // We should update utils or manually calculate center.
                // Let's assume utils uses state.camera which we haven't patched.
                // We should patch utils.getScreenCenterWorld to use getActiveCamera() or just handle it here.
                
                // Let's manually calc center based on active camera
                const cx = (window.innerWidth / 2 - camera.x) / camera.z;
                const cy = (window.innerHeight / 2 - camera.y) / camera.z;
                
                const { w, h } = utils.getFittedSize(img.width, img.height);
                
                const obj = {
                    type: 'image',
                    img: img,
                    src: path,
                    x: cx - w / 2,
                    y: cy - h / 2,
                    w: w,
                    h: h
                };
                strokes.push(obj);
                history.pushAction({ type: 'add', strokes: [obj] });
                canvasModule.renderCanvas();
            };
            img.src = path;
        } else if (['mp4', 'webm', 'ogg'].includes(ext)) {
            generateVideoThumbnail(path).then((thumbData) => {
                // Use active camera center
                const cx = (window.innerWidth / 2 - camera.x) / camera.z;
                const cy = (window.innerHeight / 2 - camera.y) / camera.z;

                let w = 400, h = 300;
                if (thumbData) {
                    const fitted = utils.getFittedSize(thumbData.w, thumbData.h);
                    w = fitted.w;
                    h = fitted.h;
                }
                
                const obj = {
                    type: 'video',
                    src: path,
                    thumb: thumbData ? thumbData.dataUrl : null,
                    name: path.split(/[\\/]/).pop(),
                    x: cx - w / 2,
                    y: cy - h / 2,
                    w: w,
                    h: h
                };
                strokes.push(obj);
                history.pushAction({ type: 'add', strokes: [obj] });
                objects.updateDOMObjects();
            });
        } else if (['mp3', 'wav'].includes(ext)) {
             const cx = (window.innerWidth / 2 - camera.x) / camera.z;
             const cy = (window.innerHeight / 2 - camera.y) / camera.z;
             
             // Issue 2: Use fixed width instead of adaptive
             const name = path.split(/[\\/]/).pop();
             const estimatedWidth = 300; // Fixed width (was 200 before, now 300 for icon+text)
             
             const obj = {
                 type: 'audio',
                 src: path,
                 name: name,
                 x: cx - estimatedWidth / 2,
                 y: cy - 30,
                 w: estimatedWidth,
                 h: 60
             };
             strokes.push(obj);
             history.pushAction({ type: 'add', strokes: [obj] });
             objects.updateDOMObjects();
        }
    } else if (type === 'browser') {
        ui.showModal('请输入网页地址', [
            { label: '地址', value: 'https://orbiboard.3r60.top/' }
        ], (values) => {
            if (values && values[0]) {
                const url = values[0];
                const cx = (window.innerWidth / 2 - camera.x) / camera.z;
                const cy = (window.innerHeight / 2 - camera.y) / camera.z;
                const w = 200;
                const h = 150;
                
                const obj = {
                    type: 'browser',
                    src: url,
                    name: new URL(url).hostname,
                    x: cx - w / 2,
                    y: cy - h / 2,
                    w: w,
                    h: h
                };
                strokes.push(obj);
                history.pushAction({ type: 'add', strokes: [obj] });
                objects.updateDOMObjects();
            }
        });
    } else if (type === 'link') {
        ui.showModal('请输入超链接信息', [
            { label: '链接名称', value: '打开链接' },
            { label: '链接地址', value: 'https://orbiboard.3r60.top/' }
        ], (values) => {
            if (values && values[1]) {
                const name = values[0] || '打开链接';
                const url = values[1];
                
                const btn = document.createElement('button');
                btn.textContent = name;
                btn.className = 'link-object-btn dom-object-wrapper'; 
                btn.onclick = () => {
                    if (!state.isMovingSelection) {
                        require('electron').shell.openExternal(url);
                    }
                };
                
                const cx = (window.innerWidth / 2 - camera.x) / camera.z;
                const cy = (window.innerHeight / 2 - camera.y) / camera.z;

                const obj = {
                    type: 'link',
                    el: btn,
                    src: url,
                    name: name,
                    x: cx - 60,
                    y: cy - 20,
                    w: 120,
                    h: 40
                };
                strokes.push(obj);
                history.pushAction({ type: 'add', strokes: [obj] });
                document.body.appendChild(btn);
                
                selection.attachObjectListeners(btn, obj);
                objects.updateDOMObjects();
                objects.updateObjectInteraction();
            }
        });
    }
});

function generateVideoThumbnail(path) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.src = path;
        video.currentTime = 1; 
        video.muted = true;
        video.onloadeddata = () => {
             // wait
        };
        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg');
            resolve({ dataUrl, w: video.videoWidth, h: video.videoHeight });
        };
        video.onerror = () => resolve(null);
    });
}

function applyAdjustment(props) {
  state.selectedStrokeIndices.forEach(idx => {
    const stroke = state.getActiveStrokes()[idx];
    if (props.color) stroke.color = props.color;
    if (props.size) stroke.size = props.size;
  });
  canvasModule.renderCanvas();
}

// --- Window Listener for Lasso (Empty Space Click) ---
window.addEventListener('pointerdown', (e) => {
    // Check if clicking outside adjust popup to close it
    if (ui.adjustPopup.style.display !== 'none') {
        if (!e.target.closest('#adjust-popup') && !e.target.closest('#btn-sel-adjust')) {
             ui.adjustPopup.style.display = 'none';
        }
    }
    // Auto-close Insert Menu
    if (ui.insertMenuPopup.style.display !== 'none') {
        if (!e.target.closest('#insert-menu-popup') && !e.target.closest('#btn-insert-media')) {
             ui.insertMenuPopup.style.display = 'none';
        }
    }
    // Auto-close Page Preview (if clicking outside it and outside the toggle button)
    // The page preview is toggled by page-indicator-btn (which is in page-controls)
    const pagePreview = document.getElementById('page-preview-popup'); // ui.pagePreviewPopup is not exported directly? 
    // ui.js exports 'pageControls', 'leftControls', 'toolSettingsPopup', 'insertMenuPopup', 'adjustPopup'.
    // It does NOT export pagePreviewPopup explicitly in the list I read?
    // Let's check ui.js exports.
    // It DOES NOT export pagePreviewPopup. But I can access it via ID.
    if (pagePreview && pagePreview.style.display !== 'none') {
        if (!e.target.closest('#page-preview-popup') && !e.target.closest('#page-indicator-btn')) {
             pagePreview.style.display = 'none';
        }
    }

    // Only if Select tool and clicking on empty space (Canvas is pointer-events: none)
    if (state.currentTool !== 'select') return;
    
    // Check if we clicked on toolbar or popups (should be handled by their own listeners/z-index, but just in case)
    if (e.target.closest('.toolbar') || 
        e.target.closest('#tool-settings-popup') || 
        e.target.closest('.bottom-controls') || 
        e.target.closest('#page-preview-popup') || 
        e.target.closest('#selection-toolbar') || 
        e.target.closest('.modal-overlay') ||
        e.target.closest('#insert-menu-popup') || 
        e.target.closest('#adjust-popup')) { // Also check adjust popup here to prevent lasso start
        return;
    }
    
    // Start Lasso
    const point = utils.getPoint(e);
    state.lassoPoints = [point]; 
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    document.getElementById('selection-toolbar').style.display = 'none';
    document.getElementById('selection-overlay').style.display = 'none';
    state.isDrawing = true;
    canvasModule.renderCanvas();
    
    // We need to track move on window because canvas is none
    const onMove = (em) => {
        if (!state.isDrawing) return;
        const p = utils.getPoint(em);
        state.lassoPoints.push(p);
        canvasModule.renderCanvas(); // Canvas is z-index 20, so it draws over everything
    };
    
    const onUp = () => {
        state.isDrawing = false;
        if (state.lassoPoints.length > 0) {
            selection.performLassoSelection();
            state.lassoPoints = [];
        }
        if (state.selectedStrokeIndices.length > 0) {
            selection.updateSelectionBounds();
            selection.showSelectionToolbar();
        }
        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
    };
    
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
});

// --- Screenshot Mode Integration ---

let previousMode = 'annotate'; // Default

ipcRenderer.on('annotate-enter-screenshot-mode', () => {
    enterScreenshotMode();
});

function enterScreenshotMode() {
    previousMode = state.MODE;
    state.MODE = 'screenshot';
    
    // Hide main UI
    document.querySelector('.toolbar-container').style.display = 'none';
    ui.pageControls.style.display = 'none';
    ui.leftControls.style.display = 'none';
    
    // Hide Canvas Content & Background
    canvasModule.canvas.style.display = 'none';
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    
    const mask = document.getElementById('screenshot-mask');
    mask.style.display = 'block';
    
    // Reset selection state
    state.screenshot = {
        start: null,
        end: null,
        active: false
    };
    
    // Hide minibar initially
    const minibar = document.getElementById('screenshot-minibar');
    minibar.style.display = 'none';
    
    // Create or show selection rect div
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

const mask = document.getElementById('screenshot-mask');

mask.onpointerdown = (e) => {
    state.screenshot.active = true;
    state.screenshot.start = { x: e.clientX, y: e.clientY };
    state.screenshot.end = { x: e.clientX, y: e.clientY };
    
    const selectionRectDiv = document.getElementById('screenshot-selection-rect');
    if (selectionRectDiv) {
        selectionRectDiv.style.display = 'block';
        updateSelectionRect();
    }
    
    // Hide minibar while dragging
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
    
    // Show minibar at bottom left of rect
    const minibar = document.getElementById('screenshot-minibar');
    minibar.style.display = 'flex';
    
    const rect = getSelectionRect();
    // Position: bottom left of rect
    let top = rect.y + rect.h + 10;
    let left = rect.x;
    
    // Keep inside screen
    if (top + minibar.offsetHeight > window.innerHeight) {
        top = rect.y - minibar.offsetHeight - 10;
    }
    if (left + minibar.offsetWidth > window.innerWidth) {
        left = window.innerWidth - minibar.offsetWidth - 10;
    }
    
    minibar.style.top = `${top}px`;
    minibar.style.left = `${left}px`;
};

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

// Initialize UI Callbacks
ui.initScreenshotUI({
    onScreenshotFull: async () => {
        // Temporarily hide UI for full screenshot
        document.getElementById('screenshot-mask').style.display = 'none';
        document.getElementById('screenshot-minibar').style.display = 'none';
        const selectionRectDiv = document.getElementById('screenshot-selection-rect');
        if (selectionRectDiv) selectionRectDiv.style.display = 'none';
        
        // Wait a bit for render
        await new Promise(r => setTimeout(r, 100));
        
        const dataUrl = await ipcRenderer.invoke('annotate-capture-screen', { full: true });
        finishScreenshot(dataUrl);
    },
    onScreenshotConfirm: async () => {
        const rect = getSelectionRect();
        if (rect.w === 0 || rect.h === 0) return;
        
        // Hide UI
        document.getElementById('screenshot-mask').style.display = 'none';
        document.getElementById('screenshot-minibar').style.display = 'none';
        const selectionRectDiv = document.getElementById('screenshot-selection-rect');
        if (selectionRectDiv) selectionRectDiv.style.display = 'none';
        
        await new Promise(r => setTimeout(r, 100));
        
        const dataUrl = await ipcRenderer.invoke('annotate-capture-screen', { rect });
        finishScreenshot(dataUrl);
    },
    onScreenshotReselect: () => {
        const selectionRectDiv = document.getElementById('screenshot-selection-rect');
        if (selectionRectDiv) selectionRectDiv.style.display = 'none';
        document.getElementById('screenshot-minibar').style.display = 'none';
        state.screenshot.start = null;
        state.screenshot.end = null;
    }
});

function finishScreenshot(dataUrl) {
    ipcRenderer.send('annotate-screenshot-complete', dataUrl);
    
    // Restore UI
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
}

// --- Booth Mode ---

function enterBoothMode() {
    state.lastMode = state.MODE; // Save previous mode
    state.MODE = 'booth';
    
    // UI Updates
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    canvasModule.canvas.style.backgroundColor = 'transparent';
    
    ui.pageControls.style.display = 'none';
    ui.leftControls.style.display = 'none';
    
    // Show Video Booth Window (Behind)
    ipcRenderer.send('video-booth-show');
    
    // Switch to Pen
    state.currentTool = 'pen';
    ui.renderToolbar(handleToolClick);
    canvasModule.renderCanvas();
    
    // Allow mouse events everywhere (not passthrough)
    ipcRenderer.send('annotate-set-ignore-mouse-events', false);
}

function exitBoothMode() {
    state.MODE = state.lastMode || 'annotate';
    
    // Hide Video Booth
    ipcRenderer.send('video-booth-hide');
    
    if (state.MODE === 'annotate') {
        ui.pageControls.style.display = 'none';
        ui.leftControls.style.display = 'none';
        state.currentTool = 'mouse';
        ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
    } else {
        // Whiteboard
        ui.pageControls.style.display = 'flex';
        ui.leftControls.style.display = 'flex';
        document.body.style.backgroundColor = 'var(--bg)';
        const currentBg = state.pageBackgrounds[state.currentPageIndex] || '#071a12';
        document.documentElement.style.setProperty('--bg', currentBg);
        state.currentTool = 'pen';
    }
    
    ui.renderToolbar(handleToolClick);
    canvasModule.renderCanvas();
}

// --- Gallery Logic ---
// We need to implement gallery logic or delegate to a module.
// Since we don't have a gallery module, I'll add minimal logic here.

function openGallery() {
    const galleryView = document.getElementById('gallery-view');
    if (!galleryView) return;
    
    galleryView.style.display = 'flex';
    loadGalleryImages();
}

async function loadGalleryImages() {
    const galleryGrid = document.getElementById('gallery-grid');
    if (!galleryGrid) return;
    
    galleryGrid.innerHTML = '<div style="color:white; padding:20px;">加载中...</div>';
    
    try {
        const images = await ipcRenderer.invoke('video-booth-get-images');
        renderGalleryGrid(images);
    } catch (e) {
        galleryGrid.innerHTML = '<div style="color:white; padding:20px;">加载失败</div>';
    }
}

let selectedGalleryIds = new Set();
let isGallerySelectionMode = false;

function renderGalleryGrid(images) {
    const galleryGrid = document.getElementById('gallery-grid');
    galleryGrid.innerHTML = '';
    
    if (!images || images.length === 0) {
        galleryGrid.innerHTML = '<div style="color:white; padding:20px;">暂无图片</div>';
        return;
    }
    
    images.forEach(img => {
        const div = document.createElement('div');
        div.className = `gallery-item ${selectedGalleryIds.has(img.id) ? 'selected' : ''}`;
        div.innerHTML = `
          <img src="${img.src}">
          <div class="gallery-item-check"><i class="ri-check-line"></i></div>
        `;
        div.onclick = () => toggleGallerySelection(img.id, div);
        galleryGrid.appendChild(div);
    });
}

function toggleGallerySelection(id, element) {
    if (!isGallerySelectionMode) return;
    
    if (selectedGalleryIds.has(id)) {
        selectedGalleryIds.delete(id);
        element.classList.remove('selected');
    } else {
        selectedGalleryIds.add(id);
        element.classList.add('selected');
    }
}

function initGalleryListeners() {
    const closeBtn = document.getElementById('btn-close-gallery');
    if (closeBtn) closeBtn.onclick = () => {
        document.getElementById('gallery-view').style.display = 'none';
        setGallerySelectionMode(false);
    };
    
    document.getElementById('btn-gallery-delete').onclick = () => setGallerySelectionMode(true, 'delete');
    document.getElementById('btn-gallery-save').onclick = () => setGallerySelectionMode(true, 'save');
    
    document.getElementById('btn-confirm-delete').onclick = () => {
        const ids = Array.from(selectedGalleryIds);
        ipcRenderer.send('video-booth-delete', ids);
        setGallerySelectionMode(false);
        loadGalleryImages();
    };
    
    document.getElementById('btn-continue-save').onclick = () => {
        const ids = Array.from(selectedGalleryIds);
        ipcRenderer.send('video-booth-save', ids);
        setGallerySelectionMode(false);
    };
}

function setGallerySelectionMode(active, type) {
    isGallerySelectionMode = active;
    selectedGalleryIds.clear();
    loadGalleryImages(); // Reload to clear visuals
    
    const defActions = document.getElementById('gallery-actions-default');
    const selActions = document.getElementById('gallery-actions-selection');
    
    if (active) {
        defActions.style.display = 'none';
        selActions.style.display = 'flex';
        
        const btnConfirm = document.getElementById('btn-confirm-delete');
        const btnContinue = document.getElementById('btn-continue-save');
        
        if (type === 'delete') {
            btnConfirm.style.display = 'block';
            btnContinue.style.display = 'none';
        } else {
            btnConfirm.style.display = 'none';
            btnContinue.style.display = 'block';
        }
    } else {
        defActions.style.display = 'flex';
        selActions.style.display = 'none';
    }
}

// Start
initUI();
initGalleryListeners();
