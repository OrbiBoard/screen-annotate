const { ipcRenderer } = require('electron');
const { getStroke } = require('perfect-freehand');
const state = require('./modules/state');
const utils = require('./modules/utils');
const canvasModule = require('./modules/canvas');
const selection = require('./modules/selection');
const objects = require('./modules/objects');
const ui = require('./modules/ui');

// --- UI Initialization ---

function initUI() {
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
    // Transparent window needs special mouse handling
    setupMousePassthrough();
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
        }
        
        ui.updatePageIndicator();
        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        ui.updatePagePreviewIfOpen();
      },
      onSave: exportImage,
      onDeletePage: deletePage,
      applyAdjustment: applyAdjustment
  });
  
  ui.updatePageIndicator();
  objects.updateObjectInteraction(); 
}

function setupAnnotateUI() {
  // Annotation specific logic
}

function setupWhiteboardUI() {
  // Whiteboard specific logic
}

function setupMousePassthrough() {
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
    ipcRenderer.send('annotate-close');
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
    exportImage();
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
  } else {
    // Switching tools, close menu
    ui.toolSettingsPopup.style.display = 'none';
    state.isMenuOpen = false;
  }

  state.currentTool = toolId;
  
  // Update interaction state for DOM objects
  objects.updateObjectInteraction();

  // Ensure fullscreen browser layer allows events
  const fsBrowser = document.getElementById('fullscreen-browser-layer');
  if (fsBrowser && fsBrowser.style.display !== 'none') {
    fsBrowser.style.pointerEvents = 'auto';
  }

  // Handle Mouse/Annotate switching for Transparent Window
  if (state.MODE === 'annotate') {
    if (state.currentTool === 'mouse') {
       ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
    } else {
       ipcRenderer.send('annotate-set-ignore-mouse-events', false);
    }
  }

  ui.renderToolbar(handleToolClick);
  canvasModule.renderCanvas();
}

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
    // Check in reverse order (topmost first)
    const strokes = state.getActiveStrokes();
    let hitIndex = -1;
    
    for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
        if (['image', 'video', 'audio', 'browser', 'link'].includes(stroke.type)) {
            // In fullscreen, video is not selectable this way (it's background)
            // But if we support images on top of fullscreen video, this works.
            if (point.x >= stroke.x && point.x <= stroke.x + stroke.w &&
                point.y >= stroke.y && point.y <= stroke.y + stroke.h) {
                hitIndex = i;
                break;
            }
        } else if (stroke.type === 'pen') {
            // Hit test for ink
            if (!stroke.points || stroke.points.length < 2) continue;
            
            // 1. Fast Bounds Check
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of stroke.points) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
            
            // Add thickness padding
            const padding = (stroke.size || 5) / 2 + 10; // Half size + extra buffer
            if (point.x < minX - padding || point.x > maxX + padding || 
                point.y < minY - padding || point.y > maxY + padding) {
                continue;
            }
            
            // 2. Precise Check
            const outline = getStroke(stroke.points, {
                size: stroke.size,
                thinning: stroke.taper ? 0.7 : 0,
                smoothing: 0.5,
                streamline: 0.5,
                start: { taper: stroke.taper ? stroke.size : 0, easing: (t) => t },
                end: { taper: stroke.taper ? stroke.size : 0, easing: (t) => t }
            });
            
            // Convert to {x,y} for isPointInPolygon
            const polygon = outline.map(p => ({ x: p[0], y: p[1] }));
            
            if (utils.isPointInPolygon(point, polygon)) {
                hitIndex = i;
                break;
            }
        }
    }
    
    if (hitIndex !== -1) {
        state.selectedStrokeIndices = [hitIndex];
        selection.updateSelectionBounds();
        selection.showSelectionToolbar();
        state.isMovingSelection = true; 
        state.dragStart = point;
        state.originalSelectionStrokes = selection.cloneStrokes(state.selectedStrokeIndices);
        state.isDrawing = true;
        
        canvasModule.renderCanvas();
        return;
    }

    // Start new selection (Lasso)
    state.lassoPoints = [point]; 
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    document.getElementById('selection-toolbar').style.display = 'none';
    state.isDrawing = true;
    canvasModule.renderCanvas();
    return;
  }

  if (state.currentTool === 'pen' || (state.currentTool === 'eraser' && state.eraserType === 'point')) {
    state.isDrawing = true;
    if (state.currentTool === 'eraser') {
        canvasModule.performEraserAction(point);
    } else {
        state.currentPoints = [point];
    }
    canvasModule.renderCanvas(); // Fix for Issue 4: Render immediately on click
  }
});

canvasModule.canvas.addEventListener('pointermove', (e) => {
  if (!state.isDrawing) return;
  
  if (state.currentTool === 'pan' && state.isPanning) {
    const dx = e.clientX - state.panStart.x;
    const dy = e.clientY - state.panStart.y;
    
    const camera = state.getActiveCamera();
    camera.x += dx;
    camera.y += dy;
    
    state.panStart = { x: e.clientX, y: e.clientY };
    canvasModule.renderCanvas();
    objects.updateDOMObjects(); 
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
  state.isDrawing = false;
  state.isPanning = false;
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
      const complexShapes = ['cuboid', 'cone', 'axis-xy', 'axis-xyz'];
      const isComplex = complexShapes.includes(state.currentShape);
      
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
          if (state.currentShape === 'square' || state.currentShape === 'circle') {
              const w = shape.end.x - shape.start.x;
              const h = shape.end.y - shape.start.y;
              const s = Math.max(Math.abs(w), Math.abs(h));
              shape.end.x = shape.start.x + (w < 0 ? -s : s);
              shape.end.y = shape.start.y + (h < 0 ? -s : s);
          }
          
          if (isComplex) {
              state.pendingShape = { start: shape.start, end: shape.end };
          } else {
              const strokes = state.getActiveStrokes();
              strokes.push(shape);
              state.redoStack = [];
          }
      } else {
          // Step 2 finished
          shape.start = state.pendingShape.start;
          shape.end = state.pendingShape.end;
          shape.depthEnd = point;
          shape.step = 2;
          
          const strokes = state.getActiveStrokes();
          strokes.push(shape);
          state.pendingShape = null;
          state.redoStack = [];
      }
      
      canvasModule.renderCanvas();
      ui.renderToolbar(handleToolClick);
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
    
    // Clear Redo
    if (state.fullscreen.active) {
        state.fullscreen.redoStack = [];
    } else {
        state.redoStack = [];
    }
    
    canvasModule.renderCanvas();
    ui.renderToolbar(handleToolClick);
  }
});

function performUndo() {
  const strokes = state.getActiveStrokes();
  const redoStack = state.getActiveRedoStack();
  
  if (strokes.length === 0) return;
  const stroke = strokes.pop();
  redoStack.push(stroke);
  
  canvasModule.renderCanvas();
  ui.renderToolbar(handleToolClick);
}

function performRedo() {
  const strokes = state.getActiveStrokes();
  const redoStack = state.getActiveRedoStack();
  
  if (redoStack.length === 0) return;
  const stroke = redoStack.pop();
  strokes.push(stroke);
  
  canvasModule.renderCanvas();
  ui.renderToolbar(handleToolClick);
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

// --- IPC Handling for Media ---
ipcRenderer.on('annotate-insert-media-reply', (event, { type, path }) => {
    // If fullscreen, we probably shouldn't allow inserting media (as per user implication of 'separate layer')
    // But if we did, it would go into fullscreen strokes. 
    // For now, let's assume it goes to the current active layer (which IS fullscreen strokes if active).
    const strokes = state.getActiveStrokes();
    const camera = state.getActiveCamera();
    
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

// Start
initUI();
