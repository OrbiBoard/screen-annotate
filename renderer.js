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
const booth = require('./modules/booth');
const ppt = require('./modules/ppt');
const screenshot = require('./modules/screenshot');
const whiteboard = require('./modules/whiteboard');

// --- IPC Forwarding Logic for Separate Windows ---
const urlParams = new URLSearchParams(window.location.search);
const currentRole = urlParams.get('role'); // 'canvas' or 'controls'

if (currentRole === 'controls') {
    // Forward events to main process to be sent to canvas
    // We override ipcRenderer.send for specific channels or create a wrapper
    const originalSend = ipcRenderer.send;
    // ... logic to forward tool clicks etc. handled by handleToolClick mainly
}

let boothMinimapStream = null;

async function initBoothMinimapStream(deviceId) {
    if (boothMinimapStream) {
        boothMinimapStream.getTracks().forEach(track => track.stop());
    }
    
    // Create or get video element
    let video = document.getElementById('booth-minimap-video');
    if (!video) {
        video = document.createElement('video');
        video.id = 'booth-minimap-video';
        video.style.display = 'none'; // Hidden
        video.autoplay = true;
        video.muted = true;
        document.body.appendChild(video);
    }
    
    try {
        const constraints = {
            video: { width: 320, height: 240 }, // Low res for minimap
            audio: false
        };
        if (deviceId) {
            constraints.video.deviceId = { exact: deviceId };
        }
        
        boothMinimapStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = boothMinimapStream;
    } catch (e) {
        console.error('Minimap camera init failed:', e);
    }
}

function stopBoothMinimapStream() {
    if (boothMinimapStream) {
        boothMinimapStream.getTracks().forEach(track => track.stop());
        boothMinimapStream = null;
    }
}

ipcRenderer.on('booth-minimap-camera-switch', (event, deviceId) => {
    initBoothMinimapStream(deviceId);
});

ipcRenderer.on('booth-freeze', (event, freeze) => {
    const video = document.getElementById('booth-minimap-video');
    if (video) {
        if (freeze) video.pause(); else video.play();
    }
});

// --- UI Initialization ---

function initUI() {
    
  // --- Window Role Separation ---
  if (currentRole === 'canvas') {
      document.body.classList.add('role-canvas');
      // Hide UI elements in canvas window
      const style = document.createElement('style');
      style.textContent = `
          .toolbar-container, .bottom-controls, .tool-popup, .tool-settings-popup, #page-preview-popup, #selection-toolbar, #selection-overlay, .edge-pan-btn {
              display: none !important;
          }
          /* Ensure canvas is visible and interactive for drawing */
          #drawing-canvas {
              pointer-events: auto !important;
          }
      `;
      document.head.appendChild(style);
  } else if (currentRole === 'controls') {
      document.body.classList.add('role-controls');
      // Controls window shows toolbar and canvas (canvas is hidden only in desktop-toolbar window)
      const style = document.createElement('style');
      style.textContent = `
          /* Hide booth layer in controls window - only used in booth mode */
          #booth-layer {
              display: none !important; 
          }
          /* Background is controlled by CSS variable --bg and body.style.backgroundColor */
          /* In whiteboard mode, background will be set via JS */
      `;
      document.head.appendChild(style);
  } else if (currentRole === 'desktop-toolbar') {
      document.body.classList.add('role-desktop-toolbar');
      
      // Force MODE to 'annotate' for desktop toolbar
      state.MODE = 'annotate';
      state.currentTool = 'mouse';
      
      const style = document.createElement('style');
      style.textContent = `
          #drawing-canvas, .dom-object-wrapper, #booth-layer, #whiteboard-background,
          .bottom-controls, #page-preview-popup, 
          #selection-toolbar, #selection-overlay, .edge-pan-btn, #left-controls, #page-controls,
          #settings-layer {
              display: none !important;
          }
          body {
              background: transparent !important;
              overflow: hidden;
              margin: 0;
              padding: 0;
              width: 100vw;
              height: 100vh;
          }
          .toolbar-container {
              position: relative !important;
              width: 100% !important;
              height: 100% !important;
              pointer-events: none !important;
              display: flex !important;
              align-items: flex-end !important;
              justify-content: center !important;
              padding-bottom: 10px !important;
          }
          #main-toolbar {
              position: relative !important;
              margin: 0 !important;
              transform: none !important;
              display: flex;
              width: fit-content;
              pointer-events: auto !important;
          }
          /* Popups should be positioned above toolbar, not fixed at top */
          .tool-settings-popup, #more-popup, #save-popup {
              position: fixed !important;
              bottom: auto !important;
              transform: translateX(-50%) !important;
              left: 50% !important;
          }
      `;
      document.head.appendChild(style);
      
      // Desktop toolbar window should always be interactable
      ipcRenderer.send('annotate-set-ignore-mouse-events', false);
      state.lastIgnoreMouseEvents = false;
      
      // Function to calculate and update shape based on actual toolbar position
      const updateToolbarShape = () => {
          const tb = document.getElementById('main-toolbar');
          if (tb) {
              const rect = tb.getBoundingClientRect();
              // Calculate shape based on toolbar position with padding
              // Use rect values directly as they are relative to viewport
              const padding = 10;
              const shapeRect = {
                  x: padding,
                  y: padding,
                  width: Math.ceil(rect.width + padding),
                  height: Math.ceil(rect.height + padding)
              };
              ipcRenderer.send('annotate-update-shape', [shapeRect]);
          }
      };
      
      // Function to calculate and resize window based on toolbar
      const resizeToToolbar = () => {
          const tb = document.getElementById('main-toolbar');
          if (tb) {
              const rect = tb.getBoundingClientRect();
              // Calculate window size based on toolbar with padding
              const w = Math.ceil(rect.width + 20);
              const h = Math.ceil(rect.height + 20);
              ipcRenderer.send('resize-window', { width: w, height: h });
              
              // Update shape after resize
              setTimeout(updateToolbarShape, 50);
          }
      };
      
      // Wait for toolbar to render
      setTimeout(() => {
          const tb = document.getElementById('main-toolbar');
          if (tb) {
              // Ensure toolbar is visible
              tb.style.display = 'flex';
              tb.style.visibility = 'visible';
              tb.style.opacity = '1';
              
              // Initial resize and shape
              setTimeout(() => {
                  resizeToToolbar();
              }, 100);
          }
      }, 300);
      
      // Update shape when window is resized
      window.addEventListener('resize', () => {
          setTimeout(updateToolbarShape, 50);
      });
  }
  
  // Listen for forwarded events from controls
  if (currentRole === 'canvas') {
      ipcRenderer.on('tool-click', (e, toolId) => {
          handleToolClick(toolId, true); // true = internal call
      });
      ipcRenderer.on('update-state', (e, newState) => {
           // Complex state sync might be needed
           Object.assign(state, newState);
           canvasModule.renderCanvas();
      });
  } else if (currentRole === 'controls') {
      ipcRenderer.on('toggle-toolbar-visibility', (e, visible) => {
          const tb = document.getElementById('main-toolbar');
          if (tb) tb.style.display = visible ? 'flex' : 'none';
          
          // Also hide drag handle if toolbar hidden
          if (!visible) {
              const handle = tb.querySelector('.toolbar-drag-handle');
              if (handle) handle.style.display = 'none';
          }
      });
      
      // Handle request to open desktop toolbar
      ipcRenderer.on('request-open-desktop-toolbar', () => {
          ipcRenderer.send('annotate-open-desktop-toolbar');
      });
  }

  booth.checkVideoBoothPlugin();
  ppt.checkPPTPlugin();
  if (booth.getHasVideoBooth()) {
      ui.enableVideoBooth();
      booth.initBoothListeners(handleToolClick);
      // Init minimap stream with default camera
      if (state.MODE === 'booth') {
          initBoothMinimapStream();
      }
  }
  
  booth.setHandleToolClick(handleToolClick);
  ppt.setHandleToolClick(handleToolClick);
  screenshot.initScreenshotListeners(handleToolClick);
  booth.initGalleryListeners();

  // Request initial theme
  ipcRenderer.send('annotate-get-theme-config');
  // Request initial config
  ipcRenderer.invoke('annotate-get-config').then(ui.applyConfig);
  
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
    // Removed setupMousePassthrough(); // No longer needed with separate windows
    document.body.style.backgroundColor = 'transparent';
    canvasModule.canvas.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
  } else {
    setupWhiteboardUI();
    if (currentRole !== 'canvas') {
        ui.pageControls.style.display = 'flex';
        ui.leftControls.style.display = 'flex';
    }
    canvasModule.canvas.style.backgroundColor = 'transparent';
    if (state.pageBackgrounds[state.currentPageIndex]) {
        document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
    } else {
        document.body.style.backgroundColor = 'var(--bg)';
    }
  }

  ui.renderToolbar(handleToolClick);
  canvasModule.renderCanvas();

  // Fix: Update mouse passthrough AFTER toolbar is rendered
  if (state.MODE === 'annotate') {
    updateMousePassthrough(true);
  }
  
  // Bind UI callbacks
  ui.bindSettingsUI({
      onPrevPage: () => {
        if (state.currentPageIndex > 0) {
            ui.updateCurrentPageSnapshot();
            state.currentPageIndex--;
            state.redoStack = [];
            
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
            const currentBg = state.pageBackgrounds[state.currentPageIndex] || 'var(--bg)';
            state.pageBackgrounds.push(currentBg);
        } else {
            ui.updateCurrentPageSnapshot();
        }
        state.currentPageIndex++;
        state.redoStack = [];
        
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
        
        const currentBg = state.pageBackgrounds[state.currentPageIndex] || 'var(--bg)';
        state.pageBackgrounds.splice(state.currentPageIndex + 1, 0, currentBg);
        
        state.currentPageIndex++;
        state.redoStack = [];
        
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
  
  // Listen for external actions
  ipcRenderer.on('action-whiteboard', () => handleToolClick('action-whiteboard'));
  ipcRenderer.on('action-booth', () => handleToolClick('action-booth'));
  ipcRenderer.on('action-annotate', () => whiteboard.switchToAnnotate(handleToolClick));

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

// Zoom support
window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
        const zoomSpeed = 0.001;
        const delta = -e.deltaY * zoomSpeed;
        
        const newZoom = Math.min(Math.max(state.camera.z + delta, 0.1), 10);
        
        const wx = (e.clientX - state.camera.x) / state.camera.z;
        const wy = (e.clientY - state.camera.y) / state.camera.z;
        
        state.camera.z = newZoom;
        state.camera.x = e.clientX - wx * newZoom;
        state.camera.y = e.clientY - wy * newZoom;
        
        if (state.MODE === 'booth') {
            ipcRenderer.send('video-booth-zoom', { 
                zoom: newZoom, 
                x: state.camera.x, 
                y: state.camera.y,
                delta: delta,
                clientX: e.clientX,
                clientY: e.clientY
            });
            booth.updateBackgroundTransform(state.camera);
        }

        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        ui.updateMinimap();
    }
}, { passive: false });

function updateMousePassthrough(force = false) {
  // Desktop toolbar window should always be interactable
  if (currentRole === 'desktop-toolbar') {
      if (state.lastIgnoreMouseEvents !== false || force) {
          ipcRenderer.send('annotate-set-ignore-mouse-events', false);
          state.lastIgnoreMouseEvents = false;
      }
      return;
  }
  
  if (state.MODE === 'annotate' && state.MODE !== 'booth') {
      if (state.currentTool === 'mouse') {
          // Controls window: Always interactable (UI), but background transparent
          // Canvas window: Should be click-through
          
          if (currentRole === 'canvas') {
              if (state.lastIgnoreMouseEvents !== true || force) {
                  ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
                  state.lastIgnoreMouseEvents = true;
              }
          } else if (currentRole === 'controls') {
               // Check if any popup is open or hovering controls
               const popups = [
                   ...document.querySelectorAll('.tool-popup'),
                   ...document.querySelectorAll('.tool-settings-popup'),
                   ...document.querySelectorAll('.save-popup'),
                   document.getElementById('shape-status-popup'),
                   document.getElementById('page-preview-popup'),
                   document.getElementById('volume-popup'),
                   document.getElementById('media-controls'),
                   document.getElementById('settings-layer')
               ];
               
               const anyPopupOpen = popups.some(el => el && el.style.display !== 'none');
               
               const isHoveringControls = 
                    (document.getElementById('main-toolbar')?.matches(':hover')) ||
                    (document.getElementById('left-controls')?.matches(':hover')) ||
                    (document.getElementById('page-controls')?.matches(':hover')) ||
                    (document.getElementById('booth-controls')?.matches(':hover'));
                                    
               const shouldIgnore = !anyPopupOpen && !isHoveringControls;
               if (state.lastIgnoreMouseEvents !== shouldIgnore || force) {
                    ipcRenderer.send('annotate-set-ignore-mouse-events', shouldIgnore, shouldIgnore ? { forward: true } : undefined);
                    state.lastIgnoreMouseEvents = shouldIgnore;
               }
           }
      } else {
          // Drawing tools:
          // Controls window: Interactable for drawing
          if (currentRole === 'controls') {
              if (state.lastIgnoreMouseEvents !== false || force) {
                  ipcRenderer.send('annotate-set-ignore-mouse-events', false);
                  state.lastIgnoreMouseEvents = false;
              }
          } else if (currentRole === 'canvas') {
              // Canvas window should also be interactable for drawing
              if (state.lastIgnoreMouseEvents !== false || force) {
                  ipcRenderer.send('annotate-set-ignore-mouse-events', false);
                  state.lastIgnoreMouseEvents = false;
              }
          }
      }
      ipcRenderer.send('annotate-set-always-on-top', true);
  } else if (state.MODE === 'booth') {
      if (state.lastIgnoreMouseEvents !== false || force) {
          ipcRenderer.send('annotate-set-ignore-mouse-events', false);
          state.lastIgnoreMouseEvents = false;
      }
  } else {
      // Whiteboard mode - always interactable
      if (state.lastIgnoreMouseEvents !== false || force) {
          ipcRenderer.send('annotate-set-ignore-mouse-events', false);
          state.lastIgnoreMouseEvents = false;
      }
  }
}

function handleToolClick(toolId, isInternal) {
  if ((currentRole === 'controls' || currentRole === 'desktop-toolbar') && !isInternal) {
      // Forward to canvas window
      ipcRenderer.send('annotate-forward-event', { channel: 'tool-click', args: [toolId] });
      
      // Also handle locally for UI updates (active state etc)
  }

  if (toolId === 'more') {
      ui.toggleMorePopup();
      return;
  }

  if (toolId === 'settings') {
      ipcRenderer.send('annotate-open-settings');
      return;
  }

  if (toolId === 'close') {
    if (state.MODE === 'booth') {
        stopBoothMinimapStream();
        booth.exitBoothMode(handleToolClick, () => whiteboard.switchToAnnotate(handleToolClick));
    } else if (state.MODE === 'whiteboard') {
        whiteboard.switchToAnnotate(handleToolClick);
    } else {
        ipcRenderer.send('annotate-close');
    }
    return;
  }
  if (toolId === 'booth') {
      // Desktop toolbar should close when switching to booth
      if (currentRole === 'desktop-toolbar') {
          ipcRenderer.send('annotate-close-desktop-toolbar');
      }
      ipcRenderer.send('annotate-mode-change', 'booth');
      ipcRenderer.send('annotate-close-desktop-toolbar');
      booth.enterBoothMode(handleToolClick);
      initBoothMinimapStream();
      return;
  }
  if (toolId === 'photo') {
      ipcRenderer.send('video-booth-capture');
      return;
  }
  if (toolId === 'gallery') {
      booth.openGallery();
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
    if (state.fullscreen.active) {
        state.fullscreen.strokes = [];
    } else if (state.MODE === 'annotate') {
        state.annotate.strokes = [];
    } else if (state.MODE === 'booth') {
        state.booth.strokes = [];
    } else {
        state.pages[state.currentPageIndex] = [];
    }
    canvasModule.renderCanvas();
    ui.renderToolbar(handleToolClick); 
    return;
  }
  if (toolId === 'rotate') {
      if (state.MODE === 'booth') {
          // 1. Calculate Center (World Coordinates of Screen Center)
          const cam = state.getActiveCamera();
          const center = {
              x: (window.innerWidth / 2 - cam.x) / cam.z,
              y: (window.innerHeight / 2 - cam.y) / cam.z
          };

          // 2. Rotate Background (Video/Image)
          // Increment rotation state
          state.booth.bgRotation = (state.booth.bgRotation || 0) + 90;
          if (state.booth.bgRotation >= 360) state.booth.bgRotation = 0;
          
          // Update Video Origin (World Space)
          if (!state.booth.videoOrigin) state.booth.videoOrigin = { x: 0, y: 0 };
          state.booth.videoOrigin = utils.rotatePoint(state.booth.videoOrigin, center, 90);
          
          ipcRenderer.send('video-booth-rotate', { 
              angle: state.booth.bgRotation,
              originX: state.booth.videoOrigin.x,
              originY: state.booth.videoOrigin.y
          });
          
          // 3. Transform Ink (Rotate 90deg around Center)
          const strokes = state.getActiveStrokes();
          if (strokes.length > 0) {
              
              const historyItems = [];
              
              strokes.forEach((stroke, i) => {
                  const oldStroke = JSON.parse(JSON.stringify(stroke)); // Deep copy
                  
                  if (stroke.type === 'pen' && stroke.points) {
                      stroke.points = stroke.points.map(p => utils.rotatePoint(p, center, 90));
                  } else if (stroke.type === 'shape') {
                      if (stroke.start) stroke.start = utils.rotatePoint(stroke.start, center, 90);
                      if (stroke.end) stroke.end = utils.rotatePoint(stroke.end, center, 90);
                      // TODO: Rotate vertices for polygon/complex shapes if cached
                  } else if (['image', 'video', 'browser', 'link'].includes(stroke.type)) {
                      // Rotate position around center
                      const p = { x: stroke.x + stroke.w/2, y: stroke.y + stroke.h/2 }; // Object Center
                      const newP = utils.rotatePoint(p, center, 90);
                      
                      // Also rotate the object itself?
                      stroke.rotation = (stroke.rotation || 0) + (90 * Math.PI / 180);
                      
                      // Update position to new center
                      stroke.x = newP.x - stroke.w/2;
                      stroke.y = newP.y - stroke.h/2;
                  }
                  
                  historyItems.push({ index: i, before: oldStroke, after: JSON.parse(JSON.stringify(stroke)) });
              });
              
              // Push to History
              history.pushAction({ type: 'transform', items: historyItems });
          }
          
          canvasModule.renderCanvas();
          objects.updateDOMObjects(); // Update DOM positions
      }
      return;
  }
  if (toolId === 'save') {
    ui.showSavePopup();
    return;
  }
  if (toolId === 'whiteboard') {
      // Desktop toolbar should close when switching to whiteboard
      if (currentRole === 'desktop-toolbar') {
          ipcRenderer.send('annotate-close-desktop-toolbar');
      }
      whiteboard.switchToWhiteboard(handleToolClick);
      return;
  }

  // Handle external actions
  if (toolId === 'action-whiteboard') {
      whiteboard.switchToWhiteboard(handleToolClick);
      return;
  }
  if (toolId === 'action-booth') {
      ipcRenderer.send('annotate-mode-change', 'booth');
      ipcRenderer.send('annotate-close-desktop-toolbar');
      booth.enterBoothMode(handleToolClick);
      initBoothMinimapStream();
      return;
  }

  if (toolId !== 'select') {
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    document.getElementById('selection-toolbar').style.display = 'none';
    document.getElementById('selection-overlay').style.display = 'none';
    ui.adjustPopup.style.display = 'none';
  }
  
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
    if (toolId === 'select' || toolId === 'lasso') {
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
    ui.toolSettingsPopup.style.display = 'none';
    state.isMenuOpen = false;
  }

  const prevTool = state.currentTool;
  state.currentTool = toolId;

  objects.updateObjectInteraction();

  const fsBrowser = document.getElementById('fullscreen-browser-layer');
  if (fsBrowser && fsBrowser.style.display !== 'none') {
    fsBrowser.style.pointerEvents = 'auto';
  }

  // --- MOUSE PASSTHROUGH LOGIC FOR SEPARATE WINDOWS ---
  updateMousePassthrough();

  ui.renderToolbar(handleToolClick);
  canvasModule.renderCanvas();

  if (toolId === 'shape') {
    if (prevTool !== 'shape') {
        state.currentShape = null; // Fix: Reset shape on entry
        ui.updateShapeSelection();
        // Fix: Use setTimeout to ensure UI is updated and menu opens correctly
        setTimeout(() => {
            ui.toggleToolMenu('shape');
        }, 10);
    }
  } else {
    ui.updateShapeStatus('', 0);
    state.pendingShape = null;
  }
}

// --- Window Listener for Selection (Capture Phase) ---
window.addEventListener('pointerdown', (e) => {
  // Desktop toolbar window should not handle selection events
  if (currentRole === 'desktop-toolbar') return;
  
  // Fix: Ignore clicks on UI elements (Selection handles, toolbars, popups)
  if (e.target.closest('#selection-overlay') || 
      e.target.closest('#selection-toolbar') || 
      e.target.closest('.tool-popup') ||
      e.target.closest('.tool-settings-popup') ||
      e.target.closest('.toolbar') ||
      e.target.closest('.bottom-controls')) {
      return;
  }

  if (state.currentTool === 'select' || state.currentTool === 'lasso') {
    
    if (state.MODE === 'booth' && state.currentTool === 'select') return;
    
    const point = utils.getPoint(e);
    
    const strokes = state.getActiveStrokes();
    let hitIndex = -1;
    
    for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
        if (stroke.type === 'pen') {
            if (!stroke.points || stroke.points.length < 2) continue;
            
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
        state.selectedStrokeIndices = [hitIndex];
        selection.updateSelectionBounds();
        selection.showSelectionToolbar();
        state.isMovingSelection = true; 
        state.dragStart = point;
        state.originalSelectionStrokes = selection.cloneStrokes(state.selectedStrokeIndices);
        state.isDrawing = true;
        
        canvasModule.renderCanvas();
        e.stopPropagation();
        e.preventDefault();
        
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
    
  }
}, { capture: true });

// --- Canvas Interaction ---

canvasModule.canvas.addEventListener('pointerdown', (e) => {
  // Desktop toolbar window should not handle drawing events
  if (currentRole === 'desktop-toolbar') return;
  
  if (state.currentTool === 'mouse') return;
  if (e.button !== 0) return;
  
  if (state.isMenuOpen) {
    ui.toolSettingsPopup.style.display = 'none';
    state.isMenuOpen = false;
  }
  
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
    state.panStartCamera = { ...state.getActiveCamera() };
    state.isDrawing = true;
    return;
  }
  
  if (state.currentTool === 'shape') {
    if (!state.currentShape) return; // Fix: Require shape selection
    state.isDrawing = true;
    if (!state.pendingShape) {
        state.shapeStart = point;
    }
    return;
  }
  
  if (state.currentTool === 'select' || state.currentTool === 'lasso') {
        if (state.MODE === 'booth' && state.currentTool === 'select') {
            state.isBoothPanning = true;
            state.boothPanStart = { x: e.clientX, y: e.clientY };
            return;
        }

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
    canvasModule.renderCanvas();
  }
});

canvasModule.canvas.addEventListener('pointermove', (e) => {
  // Desktop toolbar window should not handle drawing events
  if (currentRole === 'desktop-toolbar') return;
  
  state.mousePos = { x: e.clientX, y: e.clientY };
  
  if (!state.isDrawing && !state.pendingShape) return;
  
  if (state.currentTool === 'pan' && state.isPanning) {
    const dx = e.clientX - state.panStart.x;
    const dy = e.clientY - state.panStart.y;
    
    state.panStart = { x: e.clientX, y: e.clientY };

    const camera = state.getActiveCamera();
    camera.x += dx;
    camera.y += dy;
    
    if (state.MODE === 'booth') {
         ipcRenderer.send('video-booth-move', { 
            dx, 
            dy,
            x: camera.x,
            y: camera.y,
            zoom: camera.z,
            delta: 0,
            clientX: e.clientX,
            clientY: e.clientY
        });
        booth.updateBackgroundTransform(camera);
    }
    
    canvasModule.renderCanvas();
    objects.updateDOMObjects(); 
    ui.updateMinimap();
    return;
  }

  if (state.currentTool === 'shape') {
      canvasModule.renderCanvas();
      return;
  }

  if (state.currentTool === 'select' || state.currentTool === 'lasso') {
    const point = utils.getPoint(e);
    
    if (state.MODE === 'booth' && state.currentTool === 'select') return;
    
    if (state.isMovingSelection) {
      const panned = canvasModule.autoPanOnEdge(e.clientX, e.clientY);
      
      const dx = point.x - state.dragStart.x;
      const dy = point.y - state.dragStart.y;
      selection.moveSelection(dx, dy);
      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      
      if (state.activeMedia) {
          const wrapper = document.querySelector(`.dom-object-wrapper[data-id="obj-${state.activeMedia.index}"]`);
          if (wrapper) {
               // update media controls position handled in updateDOMObjects
          }
      }
      
      selection.updateSelectionToolbarPosition();
      return;
    }
    
    if (state.isResizingSelection) {
      canvasModule.autoPanOnEdge(e.clientX, e.clientY);
      
      selection.resizeSelection(point);
      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      selection.updateSelectionToolbarPosition();
      return;
    }

    state.lassoPoints.push(point);
    canvasModule.renderCanvas();
    return;
  }
  
  if (state.currentTool === 'select' && !state.isDrawing && !state.isMovingSelection && !state.isResizingSelection) {
      const point = utils.getPoint(e);
      checkEdgePan(point);
  }

  if (state.currentTool === 'pen' || state.currentTool === 'eraser') {
    if (state.currentTool === 'eraser') {
        const point = utils.getPoint(e);
        canvasModule.performEraserAction(point);
        checkEdgePan(point);
    } else {
        const point = utils.getPoint(e);
        state.currentPoints.push(point);
        checkEdgePan(point);
    }
    canvasModule.renderCanvas();
  }
});

function checkEdgePan(point) {
    if (state.isPanning || state.isMovingSelection) return;

    const camera = state.getActiveCamera();
    const sx = (point.x * camera.z) + camera.x;
    const sy = (point.y * camera.z) + camera.y;
    
    const edgeThreshold = 100;
    const w = window.innerWidth;
    
    const toolbarHeight = 100;
    const h = window.innerHeight - toolbarHeight;
    
    const isTop = sy < edgeThreshold;
    const isBottom = sy > h - edgeThreshold && sy < window.innerHeight;
    
    const isLeft = sx < edgeThreshold;
    const isRight = sx > w - edgeThreshold;
    
    document.querySelectorAll('.edge-pan-btn').forEach(btn => {
        btn.classList.remove('visible');
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
        
        const offset = 60;
        
        activeBtn.style.position = 'absolute';
        activeBtn.style.transform = 'translate(-50%, -50%)';
        
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
        
        targetX = Math.max(30, Math.min(w - 30, targetX));
        targetY = Math.max(30, Math.min(window.innerHeight - 30, targetY));
        
        activeBtn.style.left = `${targetX}px`;
        activeBtn.style.top = `${targetY}px`;
        activeBtn.style.bottom = 'auto';
        activeBtn.style.right = 'auto';
    }
}

document.querySelectorAll('.edge-pan-btn').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        const dir = btn.dataset.direction;
        const panAmount = 200;
        const camera = state.getActiveCamera();
        
        if (dir.includes('up') || dir === 'tl' || dir === 'tr') camera.y += panAmount;
        if (dir.includes('down') || dir === 'bl' || dir === 'br') camera.y -= panAmount;
        if (dir.includes('left') || dir === 'tl' || dir === 'bl') camera.x += panAmount;
        if (dir.includes('right') || dir === 'tr' || dir === 'br') camera.x -= panAmount;
        
        canvasModule.renderCanvas();
        objects.updateDOMObjects();
        ui.updateMinimap();
    };
});

canvasModule.canvas.addEventListener('pointerup', (e) => {
  // Desktop toolbar window should not handle drawing events
  if (currentRole === 'desktop-toolbar') return;
  
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
  
  if (state.currentTool === 'select' || state.currentTool === 'lasso') {
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
      if (!state.currentShape) return;
      
      const isComplex = shapesModule.isComplexShape(state.currentShape);
      
      const shape = {
          type: 'shape',
          shapeType: state.currentShape,
          color: state.penColor,
          size: state.penSize
      };
      
      if (!state.pendingShape) {
          shape.start = state.shapeStart;
          shape.end = point;
          
          shape.end = shapesModule.adjustShapePoints(state.currentShape, shape.start, shape.end);
          
          if (isComplex) {
              state.pendingShape = { start: shape.start, end: shape.end };
              ui.updateShapeStatus(state.currentShape, 2);
          } else {
              const strokes = state.getActiveStrokes();
              strokes.push(shape);
              history.pushAction({ type: 'add', strokes: [shape] });
              
              if (!state.isShapePinned) {
                  // Switch to Select Mode and Select the new shape
                  const newStrokeIndex = strokes.length - 1;
                  state.selectedStrokeIndices = [newStrokeIndex];
                  selection.updateSelectionBounds();
                  selection.showSelectionToolbar();
                  
                  handleToolClick('select');
                  
                  // Reset shape status
                  state.currentShape = null;
                  ui.updateShapeStatus('', 0);
              }
          }
      } else {
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
          
          if (!state.isShapePinned) {
              // Switch to Select Mode and Select the new shape
              const newStrokeIndex = strokes.length - 1;
              state.selectedStrokeIndices = [newStrokeIndex];
              selection.updateSelectionBounds();
              selection.showSelectionToolbar();
              
              handleToolClick('select');
              
              // Reset shape status
              state.currentShape = null;
              ui.updateShapeStatus('', 0);
          } else {
              ui.updateShapeStatus(state.currentShape, 1);
          }
      }
      
      canvasModule.renderCanvas();
      if (state.currentTool === 'shape') {
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
    state.pageBackgrounds.splice(index, 1);
    
    if (state.currentPageIndex >= state.pages.length) {
        state.currentPageIndex = state.pages.length - 1;
    } else if (state.currentPageIndex > index) {
        state.currentPageIndex--;
    }
    
    if (state.pageBackgrounds[state.currentPageIndex]) {
        document.documentElement.style.setProperty('--bg', state.pageBackgrounds[state.currentPageIndex]);
        themeModule.applyTheme(state.themeMode, state.themeColor);
    }
    
    canvasModule.renderCanvas();
    ui.updatePageIndicator();
    ui.renderPagePreview(deletePage);
    objects.updateDOMObjects();
}

// --- IPC Handling for Media ---
ipcRenderer.on('annotate-insert-media-reply', (event, { type, path, dataUrl }) => {
    const strokes = state.getActiveStrokes();
    const camera = state.getActiveCamera();
    
    if (type === 'image-data' && dataUrl) {
        const img = new Image();
        img.onload = () => {
            const cx = (window.innerWidth / 2 - camera.x) / camera.z;
            const cy = (window.innerHeight / 2 - camera.y) / camera.z;
            
            const { w, h } = utils.getFittedSize(img.width, img.height);
            
            const obj = {
                type: 'image',
                img: img,
                src: dataUrl, 
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
             
             const name = path.split(/[\\/]/).pop();
             const estimatedWidth = 300; 
             
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
                
                const cx = (window.innerWidth / 2 - camera.x) / camera.z;
                const cy = (window.innerHeight / 2 - camera.y) / camera.z;

                const obj = {
                    type: 'link',
                    src: url,
                    name: name,
                    x: cx - 60,
                    y: cy - 20,
                    w: 120,
                    h: 40
                };
                strokes.push(obj);
                history.pushAction({ type: 'add', strokes: [obj] });
                
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
    if (ui.adjustPopup.style.display !== 'none') {
        if (!e.target.closest('#adjust-popup') && !e.target.closest('#btn-sel-adjust')) {
             ui.adjustPopup.style.display = 'none';
        }
    }
    if (ui.insertMenuPopup.style.display !== 'none') {
        if (!e.target.closest('#insert-menu-popup') && !e.target.closest('#btn-insert-media')) {
             ui.insertMenuPopup.style.display = 'none';
        }
    }
    const pagePreview = document.getElementById('page-preview-popup');
    if (pagePreview && pagePreview.style.display !== 'none') {
        if (!e.target.closest('#page-preview-popup') && !e.target.closest('#page-indicator-btn')) {
             pagePreview.style.display = 'none';
        }
    }

    if (state.currentTool !== 'select' && state.currentTool !== 'lasso') return;
    
    if (state.MODE === 'booth' && state.currentTool === 'select') return;
    
    if (e.target.closest('.toolbar') || 
        e.target.closest('#tool-settings-popup') || 
        e.target.closest('.bottom-controls') || 
        e.target.closest('#page-preview-popup') || 
        e.target.closest('#selection-toolbar') || 
        e.target.closest('.modal-overlay') ||
        e.target.closest('#insert-menu-popup') || 
        e.target.closest('#adjust-popup')) {
        return;
    }
    
    const point = utils.getPoint(e);
    state.lassoPoints = [point]; 
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    document.getElementById('selection-toolbar').style.display = 'none';
    document.getElementById('selection-overlay').style.display = 'none';
    state.isDrawing = true;
    canvasModule.renderCanvas();
    
    const onMove = (em) => {
        if (!state.isDrawing) return;
        const p = utils.getPoint(em);
        state.lassoPoints.push(p);
        canvasModule.renderCanvas();
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

// Listen for settings closed event from ui.js
ipcRenderer.on('settings-closed-internal', () => {
    updateMousePassthrough(true);
});

initUI();
