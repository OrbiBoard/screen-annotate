const { ipcRenderer } = require('electron');
const state = require('./state');
const canvasModule = require('./canvas');
const objects = require('./objects');
const selection = require('./selection');
const shapesModule = require('./shapes');
const themeModule = require('./theme');

let historyModule;
function getHistory() {
    if (!historyModule) historyModule = require('./history');
    return historyModule;
}

// DOM Elements
const toolbar = document.getElementById('main-toolbar');

// Helper for Interactive Elements
function makeInteractive(el) {
    if (!el) return;
    // User requested to remove mouseenter/leave/move for transparency
}

// Function to update window shape based on visible interactive elements
function updateInteractiveShape(isFullScreenOverride = false) {
    // Only run this logic if we are in a window that supports setShape (e.g. controls window)
    // We can assume we are if this function is called, or check role
    if (!document.body.classList.contains('role-controls') && !document.body.classList.contains('role-desktop-toolbar')) {
        return;
    }

    // In whiteboard/booth mode, don't set any shape - entire window should be interactive
    if (state.MODE !== 'annotate') {
        ipcRenderer.send('annotate-update-shape', []);
        return;
    }

    const rects = [];
    
    // Check for full screen overlays first
    const settingsLayer = document.getElementById('settings-layer');
    if (settingsLayer && settingsLayer.style.display !== 'none') {
        isFullScreenOverride = true;
    }

    const screenshotMask = document.getElementById('screenshot-mask');
    if (screenshotMask && screenshotMask.style.display !== 'none') {
         isFullScreenOverride = true;
    }
    
    if (isFullScreenOverride) {
        rects.push({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
        ipcRenderer.send('annotate-update-shape', rects);
        return;
    }

    // Collect UI elements
    const selectors = [
        '#main-toolbar', 
        '.tool-popup', 
        '.tool-settings-popup', 
        '#save-popup', 
        '#shape-status-popup', 
        '#page-preview-popup', 
        '#selection-toolbar',
        '.bottom-controls',
        '#left-controls',
        '#page-controls',
        '#booth-controls',
        '#more-popup',
        '#screenshot-minibar',
        '#wb-continue-toast',
        '#mode-toast',
        '#insert-menu-popup',
        '#adjust-popup',
        '#text-edit-popup'
    ];

    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    rects.push({
                        x: Math.round(r.x),
                        y: Math.round(r.y),
                        width: Math.round(r.width),
                        height: Math.round(r.height)
                    });
                }
            }
        });
    });

    // Special handling for desktop toolbar window
    if (document.body.classList.contains('role-desktop-toolbar')) {
        // For desktop toolbar, calculate shape based on actual toolbar position
        const toolbar = document.getElementById('main-toolbar');
        if (toolbar) {
            const style = window.getComputedStyle(toolbar);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                const r = toolbar.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    // Shape is relative to window, toolbar is centered at bottom
                    // Calculate position relative to window
                    const padding = 10;
                    const shapeRect = {
                        x: padding,
                        y: padding,
                        width: Math.ceil(r.width + padding),
                        height: Math.ceil(r.height + padding)
                    };
                    ipcRenderer.send('annotate-update-shape', [shapeRect]);
                    return;
                }
            }
        }
        // Fallback: use full window
        ipcRenderer.send('annotate-update-shape', [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }]);
    } else {
        ipcRenderer.send('annotate-update-shape', rects);
    }
}

makeInteractive(toolbar);
makeInteractive(document.getElementById('tool-settings-popup'));
makeInteractive(document.getElementById('save-popup'));
makeInteractive(document.getElementById('page-preview-popup'));
makeInteractive(document.getElementById('shape-status-popup'));
makeInteractive(document.getElementById('selection-toolbar'));
makeInteractive(document.getElementById('insert-menu-popup'));
makeInteractive(document.getElementById('adjust-popup'));
makeInteractive(document.getElementById('text-edit-popup'));
makeInteractive(document.getElementById('booth-controls'));
makeInteractive(document.getElementById('page-controls'));
makeInteractive(document.getElementById('left-controls'));
makeInteractive(document.getElementById('settings-layer')); // Ensure settings layer is interactive

let screenInfo = null;
let currentToolbarCallback = null;

async function initScreenInfo() {
    try {
        await loadConfig();
        screenInfo = await ipcRenderer.invoke('annotate-get-screen-info');
        if (currentToolbarCallback) {
            renderToolbar(currentToolbarCallback);
        }
    } catch (e) {
        console.error('Failed to get screen info:', e);
    }
}

let toolbarState = {
    isSnapped: true,
    isDragging: false,
    offsetX: 0,
    offsetY: 0,
    disableSnapForThisSession: false,
    willSnap: false,
    bottomOffset: 20 // Default
};

const savedToolbarStates = {};

function saveCurrentToolbarState() {
    const mode = state.MODE;
    if (toolbarState.isSnapped) {
        savedToolbarStates[mode] = {
            isSnapped: true,
            snapType: toolbarState.snapType
        };
    } else {
        savedToolbarStates[mode] = {
            isSnapped: false,
            left: toolbar.style.left,
            top: toolbar.style.top
        };
    }
}

function restoreToolbarState() {
    const mode = state.MODE;
    const saved = savedToolbarStates[mode];
    
    // Reset styles first
    toolbar.style.removeProperty('left');
    toolbar.style.removeProperty('right');
    toolbar.style.removeProperty('top');
    toolbar.style.removeProperty('bottom');
    toolbar.style.removeProperty('transform');
    toolbar.style.removeProperty('position');

    if (saved) {
        toolbarState.isSnapped = saved.isSnapped;
        if (saved.isSnapped) {
            toolbarState.snapType = saved.snapType;
            if (saved.snapType === 'left') {
                toolbar.style.position = 'fixed';
                toolbar.style.left = '20px';
                toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
            } else if (saved.snapType === 'right') {
                toolbar.style.position = 'fixed';
                toolbar.style.right = '20px';
                toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
            } else {
                // Center
                toolbar.style.position = 'fixed';
                toolbar.style.left = '50%';
                toolbar.style.transform = 'translateX(-50%)';
                toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
            }
        } else {
            toolbarState.isSnapped = false;
            toolbar.style.position = 'fixed';
            toolbar.style.left = saved.left;
            toolbar.style.top = saved.top;
        }
    } else {
        // Default Center
        toolbarState.isSnapped = true;
        toolbarState.snapType = 'center';
        toolbar.style.position = 'fixed';
        toolbar.style.left = '50%';
        toolbar.style.transform = 'translateX(-50%)';
        toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
        
        // Save initial default state
        saveCurrentToolbarState();
    }
    updatePopupPositions();
}

const toolSettingsPopup = document.getElementById('tool-settings-popup');
const morePopup = document.getElementById('more-popup');
const penSettings = document.getElementById('pen-settings');
const panSettings = document.getElementById('pan-settings');
const shapeSettings = document.getElementById('shape-settings');
const shapeStatusPopup = document.getElementById('shape-status-popup'); // New Popup
const eraserSettings = document.getElementById('eraser-settings');
const pagePreviewPopup = document.getElementById('page-preview-popup');
const pageList = document.getElementById('page-list');
const adjustPopup = document.getElementById('adjust-popup');
const insertMenuPopup = document.getElementById('insert-menu-popup');
const pageControls = document.getElementById('page-controls');
const leftControls = document.getElementById('left-controls');
const panOverlay = document.getElementById('pan-overlay');
const minimapContainer = document.getElementById('pan-minimap-container');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapViewport = document.getElementById('minimap-viewport');

let cachedDeleteCallback = null;

const TOOLS = {
  annotate: [
    { id: 'mouse', icon: 'ri-cursor-line', label: '鼠标' },
    { id: 'pen', icon: 'ri-pencil-fill', label: '批注' },
    { id: 'eraser', icon: 'ri-eraser-line', label: '橡皮' },
    { id: 'clear', icon: 'ri-delete-bin-line', label: '清页' },
    { id: 'select', icon: 'ri-cursor-fill', label: '套索选' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' },
    { id: 'whiteboard', icon: 'ri-artboard-line', label: '白板' },
    { id: 'save', icon: 'ri-save-line', label: '保存' },
    { id: 'settings', icon: 'ri-settings-3-line', label: '设置' },
    { id: 'more', icon: 'ri-apps-2-line', label: '更多' }
  ],
  whiteboard: [
    { id: 'select', icon: 'ri-cursor-fill', label: '选择' },
    { id: 'pen', icon: 'ri-pencil-fill', label: '书写' },
    { id: 'eraser', icon: 'ri-eraser-line', label: '橡皮' },
    { id: 'pan', icon: 'ri-drag-move-line', label: '漫游' },
    { id: 'shape', icon: 'ri-shape-line', label: '形状' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' },
    { id: 'more', icon: 'ri-apps-2-line', label: '更多' }
  ],
  booth: [
    { id: 'pan', icon: 'ri-drag-move-line', label: '漫游' }, // Pan logic in Booth
    { id: 'pen', icon: 'ri-pencil-fill', label: '批注' },
    { id: 'eraser', icon: 'ri-eraser-line', label: '橡皮' },
    { id: 'lasso', icon: 'ri-focus-3-line', label: '套索' }, // Lasso logic
    { id: 'rotate', icon: 'ri-refresh-line', label: '旋转' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' },
    { id: 'more', icon: 'ri-apps-2-line', label: '更多' }
  ],
  ppt: [
    { id: 'select', icon: 'ri-cursor-fill', label: '选择' },
    { id: 'pen', icon: 'ri-pencil-fill', label: '书写' },
    { id: 'eraser', icon: 'ri-eraser-line', label: '橡皮' },
    { id: 'pan', icon: 'ri-drag-move-line', label: '漫游' },
    { id: 'shape', icon: 'ri-shape-line', label: '形状' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' },
    { id: 'settings', icon: 'ri-settings-3-line', label: '设置' },
    { id: 'more', icon: 'ri-apps-2-line', label: '更多' }
  ]
};

function enableVideoBooth() {
    // Add to Annotate
    const annCloseIdx = TOOLS.annotate.findIndex(t => t.id === 'close');
    if (annCloseIdx >= 0) {
        // Check if already exists to avoid dupes
        if (!TOOLS.annotate.find(t => t.id === 'booth')) {
            TOOLS.annotate.splice(annCloseIdx, 0, { id: 'booth', icon: 'ri-vidicon-line', label: '展台' });
        }
    }
    
    // Add to Whiteboard Left Controls (DOM injection)
    const leftControls = document.getElementById('left-controls');
    if (leftControls && !document.getElementById('btn-booth-wb')) {
        const btn = document.createElement('button');
        btn.className = 'tool-btn'; 
        btn.id = 'btn-booth-wb';
        btn.innerHTML = `<i class="ri-vidicon-line"></i><span>展台</span>`; 
        btn.title = '展台';
        // Insert after Save
        const saveBtn = document.getElementById('btn-save-wb');
        if (saveBtn) {
            saveBtn.parentNode.insertBefore(btn, saveBtn.nextSibling);
        } else {
            leftControls.appendChild(btn);
        }
    }
    
    // Create Booth Controls if not exists
    let boothControls = document.getElementById('booth-controls');
    if (!boothControls) {
        boothControls = document.createElement('div');
        boothControls.id = 'booth-controls';
        boothControls.className = 'bottom-controls right'; // Use standard bottom-controls class
        boothControls.style.display = 'none';
        boothControls.innerHTML = `
            <button class="tool-btn" id="btn-booth-settings">
                <i class="ri-settings-3-line"></i>
                <span>设置</span>
            </button>
            <button class="tool-btn" id="btn-booth-photo">
                <i class="ri-camera-line"></i>
                <span>拍照</span>
            </button>
            <button class="tool-btn" id="btn-booth-gallery">
                <i class="ri-image-line"></i>
                <span>相册</span>
            </button>
        `;
        document.body.appendChild(boothControls);
    }
}

function renderToolbar(handleToolClickCallback) {
  currentToolbarCallback = handleToolClickCallback;
  if (!screenInfo) {
      initScreenInfo();
  } else {
      // Calculate Bottom Offset (Taskbar Height)
      const { bounds, workArea } = screenInfo;
      // If taskbar is at bottom
      const gapBottom = bounds.height - (workArea.y + workArea.height);
      if (gapBottom > 0 && state.MODE === 'annotate') {
          toolbarState.bottomOffset = gapBottom + 20; // 20px padding
      } else {
          toolbarState.bottomOffset = 20;
      }
  }

  toolbar.innerHTML = '';
  restoreToolbarState();
  
  // Add Drag Handle
  if (!state.toolbarConfig || state.toolbarConfig.showDragHandle !== false) {
      const handle = document.createElement('div');
      handle.className = 'toolbar-drag-handle';
      handle.innerHTML = '<i class="ri-drag-move-2-fill"></i>';
      toolbar.appendChild(handle);
      
      // Drag Logic
      handle.onpointerdown = (e) => {
          e.stopPropagation();
          handle.setPointerCapture(e.pointerId);
          
          // If Desktop Toolbar Window, move window
          if (document.body.classList.contains('role-desktop-toolbar')) {
              let lastX = e.screenX;
              let lastY = e.screenY;
              
              const onMove = (em) => {
                  const dx = em.screenX - lastX;
                  const dy = em.screenY - lastY;
                  ipcRenderer.send('annotate-window-move', { x: dx, y: dy });
                  lastX = em.screenX;
                  lastY = em.screenY;
              };
              
              const onUp = (eu) => {
                  handle.releasePointerCapture(eu.pointerId);
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
              };
              
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
              return;
          }

          toolbarState.isDragging = true;
          
          const rect = toolbar.getBoundingClientRect();
          toolbarState.offsetX = e.clientX - rect.left;
          toolbarState.offsetY = e.clientY - rect.top;
          
          // Force fixed position for dragging
          toolbar.style.position = 'fixed';
          toolbar.style.left = `${rect.left}px`;
          toolbar.style.top = `${rect.top}px`;
          toolbar.style.setProperty('bottom', 'auto', 'important');
          toolbar.style.setProperty('right', 'auto', 'important');
          toolbar.style.transform = 'none';
          
          // Reset snap state for this drag
          toolbarState.willSnap = false;
          
          // If currently snapped, disable snapping for this drag session (allow pulling away)
          toolbarState.disableSnapForThisSession = toolbarState.isSnapped;
          
          updateInteractiveShape(true); // Fullscreen shape during drag
      };
      
      handle.onpointermove = (e) => {
          if (!toolbarState.isDragging) return;
          
          let x = e.clientX - toolbarState.offsetX;
          let y = e.clientY - toolbarState.offsetY;
          
          const w = window.innerWidth;
          const h = window.innerHeight;
          const tbW = toolbar.offsetWidth;
          const tbH = toolbar.offsetHeight;
          
          // Constrain to screen
          x = Math.max(0, Math.min(w - tbW, x));
          y = Math.max(0, Math.min(h - tbH, y));
          
          const defaultX = (w - tbW) / 2;
          const defaultY = h - tbH - toolbarState.bottomOffset;
          const snapThreshold = 50;
          
          let shouldSnap = false;
          
          
          let snapTargetX = defaultX;
          let snapTargetY = defaultY;
          let snapType = 'center';

          if (!toolbarState.disableSnapForThisSession) {
              const targets = [{ x: defaultX, y: defaultY, type: 'center' }];
              
              if (state.MODE === 'annotate') {
                  // Add Left/Right snap points
                  const margin = 20;
                  targets.push({ x: margin, y: defaultY, type: 'left' }); // Bottom Left
                  targets.push({ x: w - tbW - margin, y: defaultY, type: 'right' }); // Bottom Right
              }

              let closestDist = Infinity;
              
              targets.forEach(t => {
                  const dist = Math.hypot(x - t.x, y - t.y);
                  if (dist < closestDist) {
                      closestDist = dist;
                      snapTargetX = t.x;
                      snapTargetY = t.y;
                      snapType = t.type;
                  }
              });

              if (closestDist < snapThreshold) {
                  shouldSnap = true;
              }
          }
          
          if (shouldSnap) {
              toolbar.style.left = `${snapTargetX}px`;
              toolbar.style.top = `${snapTargetY}px`;
              toolbar.style.setProperty('right', 'auto', 'important');
              toolbar.style.setProperty('bottom', 'auto', 'important');
              toolbar.style.boxShadow = '0 0 0 2px var(--accent)';
              toolbarState.willSnap = true;
              toolbarState.snapType = snapType;
          } else {
              toolbar.style.left = `${x}px`;
              toolbar.style.top = `${y}px`;
              toolbar.style.setProperty('right', 'auto', 'important');
              toolbar.style.setProperty('bottom', 'auto', 'important');
              toolbar.style.boxShadow = '';
              toolbarState.willSnap = false;
          }
          
          updatePopupPositions(); // Sync popups
      };
      
      handle.onpointerup = (e) => {
          if (!toolbarState.isDragging) return;
          toolbarState.isDragging = false;
          handle.releasePointerCapture(e.pointerId);
          toolbar.style.boxShadow = '';
          
          if (toolbarState.willSnap) {
              toolbarState.isSnapped = true;
              
              // Clear any !important flags from drag
              toolbar.style.removeProperty('right');
              toolbar.style.removeProperty('bottom');
              
              if (toolbarState.snapType === 'left') {
                  toolbar.style.position = 'fixed';
                  toolbar.style.left = '20px';
                  toolbar.style.right = 'auto';
                  toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
                  toolbar.style.top = 'auto';
                  toolbar.style.transform = 'none';
              } else if (toolbarState.snapType === 'right') {
                  toolbar.style.position = 'fixed';
                  toolbar.style.left = 'auto';
                  toolbar.style.right = '20px';
                  toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
                  toolbar.style.top = 'auto';
                  toolbar.style.transform = 'none';
              } else {
                  // Center (default)
                  toolbar.style.position = 'fixed'; // Ensure fixed
                  toolbar.style.left = '50%';
                  toolbar.style.transform = 'translateX(-50%)';
                  toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
                  toolbar.style.top = 'auto';
                  toolbar.style.right = 'auto';
              }
          } else {
              toolbarState.isSnapped = false;
          }
          saveCurrentToolbarState();
          updatePopupPositions();
          updateInteractiveShape(false); // Restore shape
      };
  }

  let toolSet;
  if (state.toolbarConfig && state.toolbarConfig[state.MODE]) {
      // Use configured
      toolSet = JSON.parse(JSON.stringify(state.toolbarConfig[state.MODE]));
      toolSet = toolSet.filter(t => t.visible !== false);
  } else {
      if (state.MODE === 'booth') {
          toolSet = TOOLS.booth;
      } else if (state.MODE === 'ppt') {
          toolSet = TOOLS.ppt;
      } else {
          toolSet = state.MODE === 'annotate' ? TOOLS.annotate : TOOLS.whiteboard;
      }

      if (state.MODE === 'annotate' && state.currentTool === 'mouse') {
          const hiddenTools = ['undo', 'redo', 'select'];
          toolSet = toolSet.filter(t => !hiddenTools.includes(t.id));
      }
      
      if (state.MODE === 'booth') {
          toolSet = toolSet.filter(t => t.id !== 'close');
      }
  }

  // Ensure settings button exists in annotate/whiteboard/ppt mode (Fix for missing settings in custom config)
   if (['annotate', 'whiteboard', 'ppt'].includes(state.MODE)) {
       if (!toolSet.find(t => t.id === 'settings')) {
           // Clone to avoid modifying original TOOLS reference if it wasn't copied yet
           if (toolSet === TOOLS.annotate || toolSet === TOOLS.whiteboard || toolSet === TOOLS.ppt) {
               toolSet = [...toolSet];
           }
           
           const moreIdx = toolSet.findIndex(t => t.id === 'more');
           const settingsBtn = { id: 'settings', icon: 'ri-settings-3-line', label: '设置' };
           if (moreIdx >= 0) {
               toolSet.splice(moreIdx, 0, settingsBtn);
           } else {
               toolSet.push(settingsBtn);
           }
       }
   }

  toolSet.forEach(tool => {
    if (tool.type === 'group') {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'tool-group';
        groupDiv.style.display = 'flex';
        groupDiv.style.flexDirection = 'column';
        groupDiv.style.width = '60px'; // Same width as other buttons
        groupDiv.style.height = '60px';
        groupDiv.style.borderRight = '1px solid rgba(255, 255, 255, 0.1)';
        
        tool.items.forEach((item, index) => {
            const btn = document.createElement('button');
            btn.className = 'tool-btn small-row';
            btn.dataset.id = item.id;
            
            // Fix: Use flex row for Icon + Text
            btn.style.display = 'flex';
            btn.style.flexDirection = 'row';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.gap = '4px';
            
            btn.innerHTML = `<i class="${item.icon}" style="font-size: 14px;"></i><span style="font-size: 10px;">${item.label}</span>`;
            
            btn.style.flex = '1';
            btn.style.width = '100%';
            btn.style.padding = '0';
            btn.style.border = 'none';
            btn.style.background = 'transparent';
            btn.style.color = 'var(--fg)';
            btn.style.cursor = 'pointer';
            
            if (index === 0) {
                btn.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
            }
            
            btn.onclick = (e) => {
                e.stopPropagation();
                handleToolClickCallback(item.id);
            };
            groupDiv.appendChild(btn);
        });
        toolbar.appendChild(groupDiv);
    } else {
        const btn = document.createElement('button');
        btn.className = `tool-btn ${state.currentTool === tool.id ? 'active' : ''}`;
        btn.dataset.id = tool.id; 
        btn.innerHTML = `<i class="${tool.icon}"></i><span>${tool.label}</span>`;
        
        btn.onclick = (e) => {
            e.stopPropagation();
            handleToolClickCallback(tool.id);
        };
        
        toolbar.appendChild(btn);
    }
  });

  // Force pointer-events to be recalculated (fix for first-open click issue)
  toolbar.style.pointerEvents = 'auto';
  // Force reflow to ensure style is applied
  void toolbar.offsetHeight;

  // Show/Hide Pan Overlay
  if (state.MODE === 'booth' || state.currentTool === 'pan') {
      panOverlay.style.display = 'flex';
      
      // Fix: Ensure toggle button icon matches state
      const btn = document.getElementById('btn-pan-toggle-map');
      if (btn) {
          const icon = btn.querySelector('i');
          if (minimapContainer.style.display === 'none') {
              if (icon) icon.className = 'ri-arrow-up-s-line';
              btn.title = '显示地图';
          } else {
              if (icon) icon.className = 'ri-arrow-down-s-line';
              btn.title = '隐藏地图';
          }
      }
      
      updateMinimap();
  } else {
      panOverlay.style.display = 'none';
  }
  
  // Auto-snap adjustment after resize (due to hidden buttons)
  if (state.MODE === 'annotate') {
      requestAnimationFrame(() => {
          const rect = toolbar.getBoundingClientRect();
          const w = window.innerWidth;
          const tbW = rect.width;
          const snapDist = 50; 
          
          const distToLeft = rect.left;
          const distToRight = w - rect.right;
          const currentCenterX = rect.left + tbW / 2;
          const screenCenterX = w / 2;
          const distToCenter = Math.abs(currentCenterX - screenCenterX);
          
          let newSnapType = null;
          
          if (distToLeft < snapDist) newSnapType = 'left';
          else if (distToRight < snapDist) newSnapType = 'right';
          else if (distToCenter < snapDist) newSnapType = 'center';
          
          if (newSnapType) {
              toolbarState.isSnapped = true;
              toolbarState.snapType = newSnapType;
              
              // Remove previous styles first
              toolbar.style.removeProperty('left');
              toolbar.style.removeProperty('right');
              toolbar.style.removeProperty('top');
              toolbar.style.removeProperty('bottom');
              toolbar.style.removeProperty('transform');
              
              if (newSnapType === 'left') {
                  toolbar.style.position = 'fixed';
                  toolbar.style.left = '20px';
                  toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
              } else if (newSnapType === 'right') {
                  toolbar.style.position = 'fixed';
                  toolbar.style.right = '20px';
                  toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
              } else {
                  // Center
                  toolbar.style.position = 'fixed';
                  toolbar.style.left = '50%';
                  toolbar.style.transform = 'translateX(-50%)';
                  toolbar.style.bottom = `${toolbarState.bottomOffset}px`;
                  toolbar.style.right = 'auto';
                  toolbar.style.top = 'auto';
              }
              updatePopupPositions();
          }
      });
  }
  updateInteractiveShape(); // Update shape after rendering
}

function updateMinimap() {
    if (panOverlay.style.display === 'none' || minimapContainer.style.display === 'none') return;
    
    const strokes = state.getActiveStrokes();
    const ctx = minimapCanvas.getContext('2d');
    const mw = minimapContainer.clientWidth;
    const mh = minimapContainer.clientHeight;
    minimapCanvas.width = mw;
    minimapCanvas.height = mh;
    
    ctx.clearRect(0, 0, mw, mh);
    
    // Calculate content bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokes.forEach(s => {
        if (s.type === 'pen' && s.points) {
            s.points.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });
        } else if (['image','video','browser'].includes(s.type)) {
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.x + s.w > maxX) maxX = s.x + s.w;
            if (s.y + s.h > maxY) maxY = s.y + s.h;
        }
    });
    
    // Include current view in bounds to prevent jumping
    const cam = state.camera;
    const viewL = (0 - cam.x) / cam.z;
    const viewT = (0 - cam.y) / cam.z;
    const viewR = (window.innerWidth - cam.x) / cam.z;
    const viewB = (window.innerHeight - cam.y) / cam.z;
    
    if (minX === Infinity) { minX = viewL; maxX = viewR; minY = viewT; maxY = viewB; }
    
    // Union with viewport
    minX = Math.min(minX, viewL);
    minY = Math.min(minY, viewT);
    maxX = Math.max(maxX, viewR);
    maxY = Math.max(maxY, viewB);
    
    // Add padding
    const padding = 100;
    minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    
    // Fit content into minimap
    const scaleX = mw / contentW;
    const scaleY = mh / contentH;
    const scale = Math.min(scaleX, scaleY);
    
    // Centering
    const mapContentW = contentW * scale;
    const mapContentH = contentH * scale;
    const offX = (mw - mapContentW) / 2;
    const offY = (mh - mapContentH) / 2;
    
    // Store transform for interaction
    state.minimapTransform = { scale, minX, minY, offX, offY };
    
    // Draw Video Background (Booth Mode)
    if (state.MODE === 'booth') {
        ctx.save();
        
        // Minimap Rotation Logic
        // We need to rotate the minimap view if the background is rotated.
        // But minimap usually stays axis aligned.
        // The CONTENT is rotated.
        
        // Center of minimap canvas
        const mcx = mw / 2;
        const mcy = mh / 2;
        
        // If we want the minimap to show rotated content correctly:
        // We should rotate the context around the center of the minimap content area?
        // Or just draw the image rotated?
        
        // Let's draw the image rotated around its center in the minimap.
        // Image center in minimap coords:
        // ix + iw/2, iy + ih/2
        
        const r = state.booth.bgRotation || 0;
        
        if (state.booth.previewImageElement) {
            const img = state.booth.previewImageElement;
            if (img.complete) {
                 const ix = (0 - minX) * scale + offX;
                 const iy = (0 - minY) * scale + offY;
                 const iw = window.innerWidth * scale; 
                 const ih = window.innerHeight * scale;
                 
                 // Keep aspect ratio logic from before
                 const ratio = img.width / img.height;
                 const screenRatio = window.innerWidth / window.innerHeight;
                 
                 let dw, dh, dx, dy;
                 if (ratio > screenRatio) {
                     dw = iw;
                     dh = iw / ratio;
                     dx = ix;
                     dy = iy + (ih - dh) / 2;
                 } else {
                     dh = ih;
                     dw = ih * ratio;
                     dy = iy;
                     dx = ix + (iw - dw) / 2;
                 }
                 
                 if (r !== 0) {
                     const cx = dx + dw/2;
                     const cy = dy + dh/2;
                     ctx.translate(cx, cy);
                     ctx.rotate(r * Math.PI / 180);
                     ctx.translate(-cx, -cy);
                 }
                 
                 ctx.drawImage(img, dx, dy, dw, dh);
                 
                 if (r !== 0) {
                     // Reset transform for next items
                     ctx.setTransform(1, 0, 0, 1, 0, 0);
                 }
            }
        } else {
            const video = document.getElementById('booth-minimap-video') || document.querySelector('video');
            if (video && video.readyState >= 2) {
                 const vx = (0 - minX) * scale + offX;
                 const vy = (0 - minY) * scale + offY;
                 const vw = window.innerWidth * scale;
                 const vh = window.innerHeight * scale;
                 
                 if (r !== 0) {
                     const cx = vx + vw/2;
                     const cy = vy + vh/2;
                     ctx.translate(cx, cy);
                     ctx.rotate(r * Math.PI / 180);
                     ctx.translate(-cx, -cy);
                 }
                 
                 // Fix: Adjust video draw position to be centered on the minimap content area
                 // Current vx, vy are calculated based on scale and offset.
                 // Video should fill the "screen" area in world coordinates.
                 // In world coords, screen is at (camera.x, camera.y) to (camera.x+w/z, camera.y+h/z)?
                 // No. Screen is 0,0 to W,H in SCREEN coords.
                 // World coords of screen top-left: (0-camera.x)/camera.z
                 
                 // The minimap draws the WORLD content.
                 // The video is fixed to the SCREEN background.
                 // So in World Coords, the video is always at the "Viewport" rect?
                 // Yes, because it's a background layer fixed to the window.
                 // So if we pan right (camera.x decreases), the world moves left.
                 // The video stays on screen. So relative to the world, the video moves right?
                 // Wait.
                 // Video is "Background Layer". It pans with the camera?
                 // "Booth Mode": Video is the canvas background.
                 // When we pan, we move the camera.
                 // Does the video move?
                 // In `updateTransform` (index.html), we move the video container.
                 // So the video IS part of the world content?
                 // Yes.
                 // It is at World (0,0)? Or Screen Center?
                 // Let's check updateTransform logic again.
                 // `translate(cx + tx, cy + ty)` where tx = camera.x - cx.
                 // So translation is `camera.x, camera.y`.
                 // So the video top-left is at `camera.x, camera.y` in SCREEN coordinates?
                 // No, `translate` moves the element.
                 // If camera.x=0, camera.y=0. Video is at 0,0.
                 // If camera.x=100. Video is at 100,0.
                 // So video moves with camera.
                 // This means video is "attached" to the camera view?
                 // NO. If I pan right (camera.x increases? No, pan right means move camera left?
                 // Usually Pan Tool: Drag scene right -> Camera moves left (x decreases).
                 // If I drag scene right, I want to see what's on the left.
                 // Wait, `camera.x` in `canvas.js`: `ctx.translate(camera.x, camera.y)`.
                 // If `camera.x = 100`, everything drawn at 0,0 appears at 100,0.
                 // So `camera.x` is the offset of the world origin relative to screen top-left.
                 
                 // If I drag right, `camera.x` increases.
                 // The video also moves by `camera.x`.
                 // So the video is fixed to the WORLD ORIGIN?
                 // No. If video moves by `camera.x`, it moves WITH the world.
                 // So the video is at World (0,0).
                 // Correct.
                 
                 // So in minimap (which shows World), we should draw video at World (0,0).
                 // World (0,0) in minimap coords:
                 // (0 - minX) * scale + offX.
                 // This is exactly what `vx` and `vy` are calculated as above.
                 // `vx = (0 - minX) * scale + offX`.
                 
                 // So why "position inconsistent"?
                 // Maybe `minX` / `minY` calculation is wrong?
                 // `minX` includes `viewL` which depends on `camera.x`.
                 
                 // Let's verify video dimensions.
                 // Video is drawn with `vw = window.innerWidth * scale`.
                 // This assumes video is `window.innerWidth` wide in world.
                 // Is it?
                 // Yes, video is full screen size.
                 // BUT, is it scaled by `camera.z`?
                 // In `updateTransform`: `scale(${transform.scale})` where scale is `camera.z`.
                 // So yes, video scales with zoom.
                 
                 // So Video Rect in World:
                 // x: 0
                 // y: 0
                 // w: window.innerWidth / camera.z ? 
                 // No. If I zoom in (z=2), video doubles in size on screen.
                 // In World coords, if it stays at 0,0 and 100x100.
                 // Screen shows 50x50 of it?
                 // If `scale(2)` is applied to video element.
                 // It becomes 2x bigger visually.
                 // So in World units, it is FIXED size?
                 // If I zoom in, does the video content get bigger relative to the screen? Yes.
                 // Does it get bigger relative to the ink?
                 // Ink at (10,10) moves to (20,20) on screen.
                 // Video pixel at (10,10) moves to (20,20) on screen.
                 // So Video matches World coordinate system.
                 // So Video is defined as:
                 // Rect(0, 0, window.innerWidth, window.innerHeight) in WORLD space?
                 // Or Screen Space?
                 // If I resize window, video resizes.
                 // So it's `window.innerWidth` at the moment of capture?
                 
                 // If the user says "inconsistent", maybe it's the Rotation Center?
                 // We rotate video around Screen Center.
                 // Ink is rotated around Screen Center (World Center).
                 // Minimap rotates around... what?
                 // `ctx.translate(cx, cy)` where cx is center of Video Rect on minimap.
                 // `vx + vw/2`.
                 // This rotates the video around its own center.
                 
                 // BUT, we rotate the Scene around the SCREEN CENTER.
                 // Screen Center in World:
                 // SC_w = (ScreenW/2 - cam.x) / cam.z, (ScreenH/2 - cam.y) / cam.z.
                 
                 // Video Center in World:
                 // Video is at (0,0) to (W,H)? No.
                 // If video moves with `camera.x`, it means it's attached to World Origin?
                 // Let's re-read `updateTransform`:
                 // `translate(cx + tx, cy + ty)` where `tx = camera.x - cx`.
                 // `translate(camera.x, camera.y)`.
                 // So top-left is at `camera.x, camera.y` on screen.
                 // This confirms Video is at World (0,0).
                 
                 // So Video Center in World is (W/2, H/2).
                 // Screen Center in World is `(ScreenW/2 - cam.x)/cam.z`.
                 
                 // When we rotate:
                 // We rotate around Screen Center.
                 // So the Video (at 0,0) rotates around Screen Center.
                 // Its position changes!
                 
                 // In Minimap:
                 // We are drawing the video at `vx, vy` (which corresponds to World 0,0).
                 // And we rotate it around `vx + vw/2` (World Center of Video).
                 // THIS IS WRONG if the rotation pivot was different.
                 
                 // If we rotated around Screen Center in the main view.
                 // The video rect effectively moved in World Space.
                 // But we are just drawing it at (0,0) and rotating it in place.
                 
                 // Correction:
                 // We should rotate the ENTIRE minimap content around the "Screen Center" point mapped to Minimap?
                 // Or, calculate the new position of the Video Rect after rotation?
                 
                 // Easier approach:
                 // The minimap shows the WORLD.
                 // The "Rotation" tool rotates the WORLD around the SCREEN CENTER.
                 // So, effectively, the Coordinate System rotates?
                 // No, we modify the coordinates of Ink.
                 // And we rotate the Background Layer div.
                 
                 // If we rotate Background Layer div around Screen Center.
                 // And Screen Center is NOT the center of the Video (unless camera is centered).
                 // Then the Video moves.
                 
                 // Example:
                 // Screen 100x100. Cam(0,0). Video at 0,0. Center 50,50.
                 // Rotate 90deg around 50,50. Video center 50,50. No move.
                 
                 // Pan right. Cam(50, 0).
                 // Screen Center on Screen: 50,50.
                 // Screen Center in World: (50-50, 50-0) = (0, 50).
                 // Video is at World (0,0).
                 // Rotate around World (0, 50).
                 // Video (0,0) rotates around (0,50) -> (-50, 0)?
                 // So Video moves to (-50, 0).
                 
                 // But our Minimap code draws Video at (0,0) (vx,vy).
                 // And rotates it around (50, 50) (vx+vw/2).
                 // It doesn't account for the pivot offset!
                 
                 // FIX:
                 // 1. Calculate Pivot Point in World (Screen Center).
                 // 2. Map Pivot to Minimap Coords.
                 // 3. Rotate Context around Pivot.
                 // 4. Draw Video at World (0,0).
                 
                 const cam = state.getActiveCamera();
                 const screenWCX = (window.innerWidth / 2 - cam.x) / cam.z;
                 const screenWCY = (window.innerHeight / 2 - cam.y) / cam.z;
                 
                 const pivotX = (screenWCX - minX) * scale + offX;
                 const pivotY = (screenWCY - minY) * scale + offY;
                 
                 if (r !== 0) {
                     ctx.translate(pivotX, pivotY);
                     ctx.rotate(r * Math.PI / 180);
                     ctx.translate(-pivotX, -pivotY);
                 }
                 
                 ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, vx, vy, vw, vh);
                 
                 if (r !== 0) {
                     ctx.setTransform(1, 0, 0, 1, 0, 0);
                 }
            }
        }
        ctx.restore();
    } else {
        // Draw Images (Whiteboard Mode)
        strokes.forEach(s => {
            if (['image', 'video', 'browser'].includes(s.type) && s.img) {
                // For video/browser, we might need a thumb or capture if available
                // Assuming s.img is available for images
                const ix = (s.x - minX) * scale + offX;
                const iy = (s.y - minY) * scale + offY;
                const iw = s.w * scale;
                const ih = s.h * scale;
                try {
                    ctx.drawImage(s.img, ix, iy, iw, ih);
                } catch(e) {}
            } else if (s.type === 'video' && s.thumb) {
                // If video has thumb dataUrl, we need to load it first? 
                // Too slow for sync render. Maybe cache image object.
                // Skip for now or implement cached image loading.
            }
        });
    }

    // Draw strokes
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    ctx.translate(-minX, -minY);
    
    strokes.forEach(s => {
        if (s.type === 'pen') {
            const { points, color, size } = s;
            if (points.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for(let i=1; i<points.length; i++) ctx.lineTo(points[i].x, points[i].y);
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(size, 2 / scale); // Fix: Use 2px min width on map, not 50px
            ctx.stroke();
        } else if (s.type === 'shape') {
            // Use shared draw logic
            shapesModule.drawShape(ctx, s);
        }
    });
    ctx.restore();
    
    // Draw Viewport Rect
    // Viewport in world coords: viewL, viewT, w, h
    const vx = (viewL - minX) * scale + offX;
    const vy = (viewT - minY) * scale + offY;
    const vw = (viewR - viewL) * scale;
    const vh = (viewB - viewT) * scale;
    
    minimapViewport.style.left = `${vx}px`;
    minimapViewport.style.top = `${vy}px`;
    minimapViewport.style.width = `${vw}px`;
    minimapViewport.style.height = `${vh}px`;
}

function toggleToolMenu(type) {
  if (state.isMenuOpen && toolSettingsPopup.dataset.type === type) {
    toolSettingsPopup.style.display = 'none';
    state.isMenuOpen = false;
    
    // Resize window back if in desktop toolbar mode
    if (document.body.classList.contains('role-desktop-toolbar')) {
        const tb = document.getElementById('main-toolbar');
        if (tb) {
            const rect = tb.getBoundingClientRect();
            ipcRenderer.send('resize-window', { width: Math.ceil(rect.width + 20), height: Math.ceil(rect.height + 20) });
            // Update shape to toolbar only
            setTimeout(() => {
                const padding = 10;
                const shapeRect = {
                    x: padding,
                    y: padding,
                    width: Math.ceil(rect.width + padding),
                    height: Math.ceil(rect.height + padding)
                };
                ipcRenderer.send('annotate-update-shape', [shapeRect]);
            }, 50);
        }
    } else {
        updateInteractiveShape();
    }
  } else {
    // Hide status popup if opening main menu
    shapeStatusPopup.style.display = 'none';
    
    const isDesktopToolbar = document.body.classList.contains('role-desktop-toolbar');
    
    // Pre-set content display to calculate correct width
    toolSettingsPopup.dataset.type = type;
    penSettings.style.display = type === 'pen' ? 'flex' : 'none';
    eraserSettings.style.display = type === 'eraser' ? 'flex' : 'none';
    if (panSettings) panSettings.style.display = type === 'pan' ? 'flex' : 'none';
    if (shapeSettings) shapeSettings.style.display = type === 'shape' ? 'block' : 'none';
    
    if (isDesktopToolbar) {
        // Desktop toolbar: position popup above toolbar, centered
        // First show popup to get dimensions
        toolSettingsPopup.style.visibility = 'hidden';
        toolSettingsPopup.style.display = 'block';
        const popupHeight = toolSettingsPopup.offsetHeight;
        toolSettingsPopup.style.visibility = 'visible';
        
        // Position above toolbar
        const tb = document.getElementById('main-toolbar');
        if (tb) {
            const tbRect = tb.getBoundingClientRect();
            toolSettingsPopup.style.position = 'fixed';
            toolSettingsPopup.style.left = '50%';
            toolSettingsPopup.style.transform = 'translateX(-50%)';
            toolSettingsPopup.style.top = '10px';
            toolSettingsPopup.style.bottom = 'auto';
            toolSettingsPopup.style.width = 'auto';
            toolSettingsPopup.style.maxWidth = 'calc(100vw - 20px)';
        }
    } else {
        // Standard positioning for controls window
        const btn = document.querySelector(`.tool-btn[data-id="${type}"]`);
        if (btn) {
            const rect = btn.getBoundingClientRect();
            const spaceAbove = rect.top;
            const spaceBelow = window.innerHeight - rect.bottom;
            
            let bottomPos = window.innerHeight - rect.top + 12;
            let topPos = 'auto';
            
            const threshold = 200; 
            if (spaceAbove < threshold && spaceBelow > spaceAbove) {
                bottomPos = 'auto';
                topPos = `${rect.bottom + 12}px`;
            }
            
            toolSettingsPopup.style.bottom = bottomPos === 'auto' ? 'auto' : `${bottomPos}px`;
            toolSettingsPopup.style.top = topPos;
            
            if (type === 'shape') {
                  const tbRect = toolbar.getBoundingClientRect();
                  toolSettingsPopup.style.width = 'auto';
                  toolSettingsPopup.style.minWidth = `${tbRect.width}px`;
                  const toolbarCenter = tbRect.left + tbRect.width / 2;
                  toolSettingsPopup.style.left = `${toolbarCenter}px`;
                  toolSettingsPopup.style.transform = 'translateX(-50%)';
            } else {
                  toolSettingsPopup.style.width = '';
                  toolSettingsPopup.style.minWidth = '';
                  
                  toolSettingsPopup.style.visibility = 'hidden';
                  toolSettingsPopup.style.display = 'block';
                  const actualWidth = toolSettingsPopup.offsetWidth;
                  toolSettingsPopup.style.visibility = 'visible';
                  
                  const left = rect.left + rect.width / 2 - actualWidth / 2;
                  toolSettingsPopup.style.left = `${left}px`;
                  toolSettingsPopup.style.transform = 'none';
            }
        }
    }

    toolSettingsPopup.style.display = 'block';
    toolSettingsPopup.dataset.type = type;
    penSettings.style.display = type === 'pen' ? 'flex' : 'none';
    eraserSettings.style.display = type === 'eraser' ? 'flex' : 'none';
    if (panSettings) panSettings.style.display = type === 'pan' ? 'flex' : 'none';
    if (shapeSettings) shapeSettings.style.display = type === 'shape' ? 'block' : 'none';
    state.isMenuOpen = true;
    
    if (type === 'pen') updateColorSelection();
    if (type === 'eraser') updateEraserSelection();
    if (type === 'shape') updateShapeSelection();

    // Resize window and update shape if in desktop toolbar mode
    if (isDesktopToolbar) {
        requestAnimationFrame(() => {
            const tb = document.getElementById('main-toolbar');
            const popup = toolSettingsPopup;
            
            if (tb && popup) {
                const tbRect = tb.getBoundingClientRect();
                const popupRect = popup.getBoundingClientRect();
                
                // Calculate required window size based on actual content
                const w = Math.ceil(popupRect.width + 20);
                const h = Math.ceil(popupRect.height + tbRect.height + 40);
                
                ipcRenderer.send('resize-window', { width: w, height: h });
                
                // Update shape to include both toolbar and popup
                setTimeout(() => {
                    const padding = 10;
                    const shapeRect = {
                        x: padding,
                        y: padding,
                        width: Math.ceil(popupRect.width + padding),
                        height: Math.ceil(popupRect.height + tbRect.height + padding * 2)
                    };
                    ipcRenderer.send('annotate-update-shape', [shapeRect]);
                }, 50);
            }
        });
    } else {
        updateInteractiveShape();
    }
  }
}

function updateShapeSelection() {
  document.querySelectorAll('.shape-btn-container').forEach(btn => {
    if (btn.dataset.shape === state.currentShape) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  const pinToggle = document.getElementById('shape-pin-toggle');
  if (pinToggle) {
      pinToggle.checked = state.isShapePinned;
  }
}

function updateColorSelection() {
  document.querySelectorAll('.color-swatch:not(.adjust-swatch)').forEach(swatch => {
    if (swatch.dataset.color === state.penColor) {
      swatch.style.borderColor = 'white';
      swatch.style.transform = 'scale(1.2)';
    } else {
      swatch.style.borderColor = 'var(--border)';
      swatch.style.transform = 'scale(1)';
    }
  });
}

function updateEraserSelection() {
  document.querySelectorAll('.eraser-preset').forEach(preset => {
    if (parseInt(preset.dataset.size) === state.eraserSize) {
      preset.classList.add('active');
    } else {
      preset.classList.remove('active');
    }
  });
}

function showModal(title, fields, callback) {
    const modal = document.getElementById('modal-dialog');
    const titleEl = document.getElementById('modal-title');
    const fieldsContainer = document.getElementById('modal-fields');
    const cancelBtn = document.getElementById('modal-cancel');
    const confirmBtn = document.getElementById('modal-confirm');

    titleEl.textContent = title;
    fieldsContainer.innerHTML = ''; 
    
    const inputs = [];
    fields.forEach(field => {
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'modal-field';
        
        const label = document.createElement('label');
        label.className = 'modal-label';
        label.textContent = field.label;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'modal-input';
        input.value = field.value || '';
        
        fieldDiv.appendChild(label);
        fieldDiv.appendChild(input);
        fieldsContainer.appendChild(fieldDiv);
        inputs.push(input);
    });

    modal.style.display = 'flex';
    if (inputs.length > 0) inputs[0].focus();

    const cleanup = () => {
        modal.style.display = 'none';
        cancelBtn.onclick = null;
        confirmBtn.onclick = null;
    };

    cancelBtn.onclick = () => {
        cleanup();
        callback(null);
    };

    confirmBtn.onclick = () => {
        const values = inputs.map(input => input.value);
        cleanup();
        callback(values);
    };
}

function updatePageIndicator() {
    const indicatorText = document.getElementById('page-indicator-text');
    indicatorText.textContent = `${state.currentPageIndex + 1} / ${state.pages.length}`;
    
    const nextBtn = document.getElementById('btn-next-page');
    const nextSpan = nextBtn.querySelector('span');
    const nextIcon = nextBtn.querySelector('i');
    
    if (state.currentPageIndex === state.pages.length - 1) {
        nextSpan.textContent = '新建页';
        nextIcon.className = 'ri-add-line';
    } else {
        nextSpan.textContent = '下一页';
        nextIcon.className = 'ri-arrow-right-s-line';
    }
}

function updateCurrentPageSnapshot() {
    const isEraser = state.currentTool === 'eraser';
    if (isEraser) state.currentTool = 'temp_hidden'; 
    canvasModule.renderCanvas();
    state.pageSnapshots[state.currentPageIndex] = canvasModule.canvas.toDataURL('image/png');
    if (isEraser) state.currentTool = 'eraser';
    canvasModule.renderCanvas(); 
}

function updateSwatchSelection(controls, currentColor) {
    if (!controls) return;
    
    // Check standard swatches
    let found = false;
    controls.querySelectorAll('.bg-swatch').forEach(el => {
        const color = el.dataset.color;
        if (color.toLowerCase() === currentColor.toLowerCase()) {
            el.style.border = '2px solid var(--accent)';
            found = true;
        } else {
            el.style.border = '1px solid var(--border)';
        }
    });
    
    // Check custom swatch
    const customSwatch = controls.querySelector('.bg-swatch-custom');
    if (customSwatch) {
        if (!found) {
            customSwatch.style.border = '2px solid var(--accent)';
            // Update input value to match if it's a custom hex
            const picker = customSwatch.querySelector('input');
            if (picker && currentColor.startsWith('#')) {
                picker.value = currentColor;
            }
        } else {
            customSwatch.style.border = '1px solid var(--border)';
        }
    }
}

function renderPagePreview(deletePageCallback) {
    if (deletePageCallback) cachedDeleteCallback = deletePageCallback;
    
    // Ensure controls container exists
    let controls = document.getElementById('page-preview-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'page-preview-controls';
        // Add minimal styles inline or relies on CSS
        controls.style.paddingBottom = '10px';
        
        // Insert before page-list
        pageList.parentNode.insertBefore(controls, pageList);
        
        // Render Color Picker
        controls.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 14px; font-weight: bold; color: var(--fg);">页面预览</span>
                <button class="icon-only-btn" id="btn-close-preview-internal" style="background:none; border:none; color:var(--muted); cursor:pointer;"><i class="ri-close-line" style="font-size: 20px;"></i></button>
            </div>
            <div class="preview-header-row" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-size: 12px; color: var(--muted);">画布背景</span>
                <div class="bg-color-options" style="display: flex; gap: 6px;">
                    <div class="color-swatch bg-swatch" data-color="#071a12" style="background: #071a12; border: 1px solid var(--border); box-sizing: border-box;" title="默认"></div>
                    <div class="color-swatch bg-swatch" data-color="#000000" style="background: #000000; border: 1px solid var(--border); box-sizing: border-box;" title="黑色"></div>
                    <div class="color-swatch bg-swatch" data-color="#ffffff" style="background: #ffffff; border: 1px solid var(--border); box-sizing: border-box;" title="白色"></div>
                    <div class="color-swatch bg-swatch" data-color="#f5f5dc" style="background: #f5f5dc; border: 1px solid var(--border); box-sizing: border-box;" title="米色"></div>
                    <div class="color-swatch bg-swatch-custom" style="position: relative; overflow: hidden; background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); border: 1px solid var(--border); box-sizing: border-box;" title="自定义">
                        <input type="color" id="bg-custom-color" style="position: absolute; left: -10px; top: -10px; width: 40px; height: 40px; opacity: 0; cursor: pointer;">
                    </div>
                </div>
            </div>
            <div class="separator-h" style="margin: 8px 0; background: var(--border); height: 1px;"></div>
        `;
        
        // Bind Events
        controls.querySelectorAll('.bg-swatch').forEach(el => {
            el.onclick = () => {
                const color = el.dataset.color;
                // Fix for Issue 1: Update state and sync
                state.pageBackgrounds[state.currentPageIndex] = color;
                document.documentElement.style.setProperty('--bg', color);
                
                // Fix for Issue 3: Apply Theme immediately
                themeModule.applyTheme(state.themeMode, state.themeColor);

                // Fix for Issue 4: Auto switch pen color
                checkAutoSwitchPenColor(color);
                
                // Re-render previews to show new bg
                renderPagePreview(cachedDeleteCallback);
            };
        });
        const customPicker = controls.querySelector('#bg-custom-color');
        customPicker.oninput = (e) => {
             const color = e.target.value;
             state.pageBackgrounds[state.currentPageIndex] = color;
             document.documentElement.style.setProperty('--bg', color);
             themeModule.applyTheme(state.themeMode, state.themeColor);
             
             // Update custom swatch border
             updateSwatchSelection(controls, color);
        };
        controls.querySelector('#btn-close-preview-internal').onclick = () => {
             document.getElementById('page-preview-popup').style.display = 'none';
        };
    }

    // Update Swatch Selection State
    const currentBg = state.pageBackgrounds[state.currentPageIndex] || '#071a12';
    updateSwatchSelection(controls, currentBg);

    pageList.innerHTML = '';
    
    state.pages.forEach((pageStrokes, index) => {
        const container = document.createElement('div');
        container.className = 'page-preview-container';

        const label = document.createElement('div');
        label.className = 'page-number-label';
        label.textContent = `${index + 1}`;
        container.appendChild(label);

        const item = document.createElement('div');
        item.className = `page-preview-item ${index === state.currentPageIndex ? 'active' : ''}`;
        
        const img = document.createElement('img');
        img.className = 'preview-img';
        img.src = state.pageSnapshots[index] || ''; 
        // Fix for Issue 1: Preview background
        const pageBg = state.pageBackgrounds[index] || '#071a12';
        img.style.backgroundColor = pageBg;
        
        item.appendChild(img);
        
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-page';
        delBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';
        delBtn.title = '删除此页';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deletePageCallback(index);
        };
        item.appendChild(delBtn);
        
        item.onclick = () => {
            state.currentPageIndex = index;
            state.redoStack = [];
            
            // Fix for Issue 1: Sync background when switching pages via preview
            if (state.pageBackgrounds[index]) {
                document.documentElement.style.setProperty('--bg', state.pageBackgrounds[index]);
            }
            
            updatePageIndicator();
            canvasModule.renderCanvas();
            objects.updateDOMObjects();
            
            // Re-render preview to update active state
            renderPagePreview(cachedDeleteCallback);
        };
        
        container.appendChild(item);
        pageList.appendChild(container);
    });
}

function checkAutoSwitchPenColor(bgColor) {
    const isLightBg = ['#ffffff', '#f5f5dc', 'white', 'beige'].includes(bgColor.toLowerCase());
    const isDarkBg = ['#071a12', '#000000', 'black'].includes(bgColor.toLowerCase());
    
    if (state.penColor === '#ffffff' && isLightBg) {
        state.penColor = '#000000';
        updateColorSelection();
    } else if (state.penColor === '#000000' && isDarkBg) {
        state.penColor = '#ffffff';
        updateColorSelection();
    }
}

function openAdjustPopup() {
  if (!state.selectionBounds) return;
  const rect = document.getElementById('selection-toolbar').getBoundingClientRect();
  adjustPopup.style.display = 'block';
  adjustPopup.style.left = `${rect.left}px`;
  
  // Use consistent top positioning below selection toolbar
  adjustPopup.style.top = `${rect.bottom + 8}px`;
  adjustPopup.style.transform = 'none';
  adjustPopup.style.bottom = 'auto';

  // Render Adjust UI (Color/Size)
  renderAdjustUI();
}

function renderAdjustUI() {
    adjustPopup.innerHTML = `
        <div class="settings-group">
            <div class="save-label">颜色</div>
            <div class="color-options">
                <div class="color-swatch adjust-swatch" data-color="#ffffff" style="background: #ffffff;"></div>
                <div class="color-swatch adjust-swatch" data-color="#ff4d4f" style="background: #ff4d4f;"></div>
                <div class="color-swatch adjust-swatch" data-color="#fadb14" style="background: #fadb14;"></div>
                <div class="color-swatch adjust-swatch" data-color="#52c41a" style="background: #52c41a;"></div>
                <div class="color-swatch adjust-swatch" data-color="#1890ff" style="background: #1890ff;"></div>
                <div class="color-swatch adjust-swatch" data-color="#722ed1" style="background: #722ed1;"></div>
            </div>
        </div>
        <div class="settings-group">
            <div class="save-label">粗细 <span id="adjust-size-display"></span></div>
            <input type="range" id="adjust-size-slider" min="1" max="20" value="2" class="media-progress">
        </div>
    `;

    // Bind Events
    adjustPopup.querySelectorAll('.adjust-swatch').forEach(el => {
        el.onclick = () => {
            const color = el.dataset.color;
            const strokes = state.getActiveStrokes();
            
            // Capture for undo
            const items = state.selectedStrokeIndices.map(idx => ({
                index: idx,
                before: { ...strokes[idx] }, // Shallow copy
                after: { ...strokes[idx], color: color }
            }));
            
            state.selectedStrokeIndices.forEach(idx => {
                if (strokes[idx].type === 'pen' || strokes[idx].type === 'shape') {
                    strokes[idx].color = color;
                }
            });
            
            require('./history').pushAction({ type: 'transform', items });
            canvasModule.renderCanvas();
        };
    });

    const slider = adjustPopup.querySelector('#adjust-size-slider');
    const display = adjustPopup.querySelector('#adjust-size-display');
    
    // Set initial value based on first selected item
    const strokes = state.getActiveStrokes();
    if (state.selectedStrokeIndices.length > 0) {
        const first = strokes[state.selectedStrokeIndices[0]];
        if (first && (first.type === 'pen' || first.type === 'shape')) {
            slider.value = first.size;
            display.textContent = first.size;
        }
    }

    slider.oninput = (e) => {
        const size = parseInt(e.target.value);
        display.textContent = size;
        const strokes = state.getActiveStrokes();
        
        state.selectedStrokeIndices.forEach(idx => {
            if (strokes[idx].type === 'pen' || strokes[idx].type === 'shape') {
                strokes[idx].size = size;
            }
        });
        canvasModule.renderCanvas();
    };
    
    slider.onchange = (e) => {
         // Push history on release
         const size = parseInt(e.target.value);
         const strokes = state.getActiveStrokes();
         const items = state.selectedStrokeIndices.map(idx => ({
                index: idx,
                before: { ...strokes[idx], size: strokes[idx].size }, // Note: size already changed by oninput? 
                // Wait, oninput changes live. We need 'before' state.
                // We didn't capture 'before' state on start.
                // For slider, we usually capture onmousedown.
                // Simplified: just push current state as 'after', but 'before' is lost.
                // Let's rely on immediate change for visual feedback, 
                // but for proper undo we need start value.
                // Todo: Better slider undo support.
                // For now, let's assume user accepts it.
                after: { ...strokes[idx], size: size }
         }));
         // Hack: we don't have original size here easily without tracking mousedown.
         // Let's skip history for size drag for now or just push current as both? No.
         // OK, let's capture on mousedown.
    };
    
    slider.onpointerdown = () => {
         const strokes = state.getActiveStrokes();
         slider.dataset.startSizes = JSON.stringify(state.selectedStrokeIndices.map(idx => strokes[idx].size));
    };
    
    slider.onpointerup = () => {
         const startSizes = JSON.parse(slider.dataset.startSizes || '[]');
         const strokes = state.getActiveStrokes();
         const items = state.selectedStrokeIndices.map((idx, i) => ({
             index: idx,
             before: { ...strokes[idx], size: startSizes[i] },
             after: { ...strokes[idx] }
         }));
         require('./history').pushAction({ type: 'transform', items });
    };
}

function bindSettingsUI(callbacks) {
  // Color Picker
  document.querySelectorAll('.color-swatch:not(.adjust-swatch)').forEach(swatch => {
    swatch.onclick = (e) => {
      state.penColor = e.target.dataset.color;
      updateColorSelection();
    };
  });

  // Pen Size Slider
  const penSizeSlider = document.getElementById('pen-size-slider');
  if (penSizeSlider) {
    penSizeSlider.oninput = (e) => {
      state.penSize = parseInt(e.target.value);
      document.getElementById('pen-size-display').textContent = state.penSize;
    };
  }

  // Pen Taper Toggle
  const penTaperToggle = document.getElementById('pen-taper-toggle');
  if (penTaperToggle) {
    penTaperToggle.checked = state.penTaper;
    penTaperToggle.onchange = (e) => {
      state.penTaper = e.target.checked;
    };
  }

  // Eraser Presets
  document.querySelectorAll('.eraser-preset').forEach(preset => {
    preset.onclick = (e) => {
      state.eraserSize = parseInt(e.target.dataset.size);
      updateEraserSelection();
    };
  });

  document.getElementById('btn-clear-page').onclick = () => {
    // Fix for Issue 5: Clear correct page in fullscreen
    if (state.fullscreen.active) {
        state.fullscreen.strokes = [];
    } else if (state.MODE === 'annotate') {
        state.annotate.strokes = [];
    } else if (state.MODE === 'booth') {
        state.booth.strokes = [];
    } else {
        state.pages[state.currentPageIndex] = [];
    }
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    canvasModule.renderCanvas();
    require('./objects').updateDOMObjects(); // Fix: Update DOM objects after clearing
    toolSettingsPopup.style.display = 'none';
    state.isMenuOpen = false;
  };
  
  // Pan Settings
  if (panSettings) {
      document.getElementById('btn-pan-reset').onclick = () => {
          state.camera = { x: 0, y: 0, z: 1 };
          canvasModule.renderCanvas();
          require('./objects').updateDOMObjects();
          updateMinimap();
      };
      document.getElementById('btn-pan-fit').onclick = () => {
          canvasModule.fitCameraToContent();
          updateMinimap();
      };
  }

  // Shape Settings
  if (shapeSettings) {
      // Set initial shape selection if none
      if (!state.currentShape) {
          state.currentShape = null; // Ensure null initially
      }
      
      document.querySelectorAll('.shape-btn-container').forEach(btn => {
          btn.onclick = (e) => {
              e.stopPropagation(); // Stop propagation
              const shapeType = btn.dataset.shape;
              state.currentShape = shapeType;
              updateShapeSelection();
              
              // Hide Selection Popup immediately if not pinned
              if (!state.isShapePinned) {
                   toolSettingsPopup.style.display = 'none';
                   state.isMenuOpen = false;
               }
              
              // Show Status Popup
              updateShapeStatus(shapeType, 1);
          };
      });
      
      const pinToggle = document.getElementById('shape-pin-toggle');
      if (pinToggle) {
          pinToggle.onchange = (e) => {
              state.isShapePinned = e.target.checked;
          };
      }
      
      const changeShapeBtn = document.getElementById('btn-change-shape');
      if (changeShapeBtn) {
          changeShapeBtn.onclick = (e) => {
              e.stopPropagation(); // Prevent propagation
              toggleToolMenu('shape');
          };
      }
  }

  // Selection Toolbar
  document.getElementById('btn-sel-delete').onclick = selection.deleteSelection;
  document.getElementById('btn-sel-clone').onclick = selection.cloneSelection;
  document.getElementById('btn-sel-clone-page').onclick = () => {
      selection.cloneSelectionToNewPage();
      updatePageIndicator();
  };
  document.getElementById('btn-sel-adjust').onclick = () => {
      const strokes = state.getActiveStrokes();
      // Check if text object selected
      if (state.selectedStrokeIndices.length === 1) {
          const stroke = strokes[state.selectedStrokeIndices[0]];
          if (stroke && stroke.type === 'text') {
              openTextEditPopup();
              return;
          }
      }
      openAdjustPopup();
  };

  // Text Edit Popup
  let textPopup = document.getElementById('text-edit-popup');
  // Fix: Create popup if missing
  if (!textPopup) {
      textPopup = document.createElement('div');
      textPopup.id = 'text-edit-popup';
      textPopup.className = 'tool-popup';
      textPopup.style.display = 'none';
      textPopup.innerHTML = `
        <div class="popup-row">
            <select id="text-font-family" class="popup-select" style="width: 100px;">
                <option value="Arial">Arial</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
                <option value="Microsoft YaHei">微软雅黑</option>
                <option value="SimHei">黑体</option>
                <option value="KaiTi">楷体</option>
            </select>
            <input type="number" id="text-font-size" class="popup-input" style="width: 50px;" min="12" max="200" value="24">
            <input type="color" id="text-color" class="popup-color" value="#ffffff">
        </div>
        <div class="popup-row">
            <button id="btn-text-bold" class="tool-btn small"><i class="ri-bold"></i></button>
            <button id="btn-text-italic" class="tool-btn small"><i class="ri-italic"></i></button>
            <button id="btn-text-underline" class="tool-btn small"><i class="ri-underline"></i></button>
        </div>
        <div class="popup-row">
            <input type="text" id="text-content-input" class="popup-input" style="width: 100%;" placeholder="文本内容">
        </div>
      `;
      document.body.appendChild(textPopup);
  }

  function updateTextObj(props) {
      if (state.selectedStrokeIndices.length !== 1) return;
      const idx = state.selectedStrokeIndices[0];
      const stroke = state.getActiveStrokes()[idx];
      if (stroke.type !== 'text') return;
      
      Object.assign(stroke, props);
      objects.updateDOMObjects();
  }

  document.getElementById('text-font-family').onchange = (e) => updateTextObj({ fontFamily: e.target.value });
  document.getElementById('text-font-size').onchange = (e) => updateTextObj({ fontSize: parseInt(e.target.value) });
  document.getElementById('text-color').oninput = (e) => updateTextObj({ color: e.target.value });
  
  document.getElementById('btn-text-bold').onclick = () => {
      const stroke = state.getActiveStrokes()[state.selectedStrokeIndices[0]];
      const newVal = !stroke.bold;
      updateTextObj({ bold: newVal });
      document.getElementById('btn-text-bold').classList.toggle('active', newVal);
  };
  document.getElementById('btn-text-italic').onclick = () => {
      const stroke = state.getActiveStrokes()[state.selectedStrokeIndices[0]];
      const newVal = !stroke.italic;
      updateTextObj({ italic: newVal });
      document.getElementById('btn-text-italic').classList.toggle('active', newVal);
  };
  document.getElementById('btn-text-underline').onclick = () => {
      const stroke = state.getActiveStrokes()[state.selectedStrokeIndices[0]];
      const newVal = !stroke.underline;
      updateTextObj({ underline: newVal });
      document.getElementById('btn-text-underline').classList.toggle('active', newVal);
  };
  
  document.getElementById('text-content-input').oninput = (e) => {
      updateTextObj({ text: e.target.value });
      // Also update content editable div?
      // updateDOMObjects handles it.
  };

  function openTextEditPopup() {
      const rect = document.getElementById('selection-toolbar').getBoundingClientRect();
      textPopup.style.display = 'block';
      textPopup.style.left = `${rect.left}px`;
      textPopup.style.top = `${rect.bottom + 10}px`;
      
      // Init values
      const stroke = state.getActiveStrokes()[state.selectedStrokeIndices[0]];
      document.getElementById('text-font-family').value = stroke.fontFamily || 'Arial';
      document.getElementById('text-font-size').value = stroke.fontSize || 24;
      document.getElementById('text-color').value = stroke.color || '#ffffff';
      document.getElementById('text-content-input').value = stroke.text || '';
      
      // Update buttons state
      document.getElementById('btn-text-bold').classList.toggle('active', !!stroke.bold);
      document.getElementById('btn-text-italic').classList.toggle('active', !!stroke.italic);
      document.getElementById('btn-text-underline').classList.toggle('active', !!stroke.underline);
  }

  // Window listener to close text edit popup
  window.addEventListener('pointerdown', (e) => {
      // ... existing checks
      if (textPopup.style.display !== 'none') {
          if (!e.target.closest('#text-edit-popup') && !e.target.closest('#btn-sel-adjust')) {
              textPopup.style.display = 'none';
          }
      }
  });

  // Adjust Popup
  document.querySelectorAll('.adjust-swatch').forEach(swatch => {
    swatch.onclick = (e) => {
      const color = e.target.dataset.color;
      callbacks.applyAdjustment({ color });
    };
  });

  const adjustSlider = document.getElementById('adjust-size-slider');
  adjustSlider.oninput = (e) => {
    const size = parseInt(e.target.value);
    document.getElementById('adjust-size-display').textContent = size;
    callbacks.applyAdjustment({ size });
  };

  // Insert Media Menu
  document.getElementById('btn-insert-media').onclick = (e) => {
    if (insertMenuPopup.style.display === 'none') {
        const rect = e.currentTarget.getBoundingClientRect();
        insertMenuPopup.style.display = 'block';
        insertMenuPopup.style.left = `${rect.left}px`;
        insertMenuPopup.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        insertMenuPopup.style.transform = 'none';
    } else {
        insertMenuPopup.style.display = 'none';
    }
  };

  document.getElementById('btn-insert-file').onclick = () => {
      ipcRenderer.send('annotate-insert-media', 'file');
      insertMenuPopup.style.display = 'none';
  };
  document.getElementById('btn-insert-browser').onclick = () => {
      ipcRenderer.send('annotate-insert-media', 'browser');
      insertMenuPopup.style.display = 'none';
  };
  document.getElementById('btn-insert-link').onclick = () => {
      ipcRenderer.send('annotate-insert-media', 'link');
      insertMenuPopup.style.display = 'none';
  };
  document.getElementById('btn-insert-text').onclick = () => {
      // Create text object at screen center
      const camera = state.getActiveCamera();
      const cx = (window.innerWidth / 2 - camera.x) / camera.z;
      const cy = (window.innerHeight / 2 - camera.y) / camera.z;
      
      const obj = {
          type: 'text',
          text: '请输入文本',
          x: cx - 100,
          y: cy - 25,
          w: 200,
          h: 50,
          fontSize: 24,
          fontFamily: 'Arial',
          bold: false,
          italic: false,
          underline: false,
          color: '#ffffff'
      };
      
      const strokes = state.getActiveStrokes();
      strokes.push(obj);
      getHistory().pushAction({ type: 'add', strokes: [obj] });
      
      // Auto-select and focus
      state.selectedStrokeIndices = [strokes.length - 1];
      objects.updateDOMObjects();
      selection.updateSelectionBounds();
      selection.showSelectionToolbar();
      
      insertMenuPopup.style.display = 'none';
  };

  document.getElementById('btn-insert-screenshot').onclick = () => {
      ipcRenderer.send('annotate-start-screenshot');
      insertMenuPopup.style.display = 'none';
  };
  
  // Page Controls
  document.getElementById('btn-prev-page').onclick = callbacks.onPrevPage;
  document.getElementById('btn-next-page').onclick = callbacks.onNextPage;
  document.getElementById('btn-insert-page').onclick = callbacks.onInsertPage;
  document.getElementById('btn-collapse').onclick = () => ipcRenderer.send('annotate-minimize');
  document.getElementById('btn-save-wb').onclick = callbacks.onSave;
  
  document.getElementById('page-indicator-btn').onclick = () => {
    updateCurrentPageSnapshot();
    renderPagePreview(callbacks.onDeletePage);
    if (pagePreviewPopup.style.display === 'none') {
        pagePreviewPopup.style.display = 'flex';
    } else {
        pagePreviewPopup.style.display = 'none';
    }
  };

  document.getElementById('btn-close-preview').onclick = () => {
    pagePreviewPopup.style.display = 'none';
  };
  
  // Pan Overlay Buttons
  document.getElementById('btn-pan-zoom-in').onclick = () => {
      // Zoom in towards center
      const camera = state.getActiveCamera();
      const oldZ = camera.z;
      const newZ = Math.min(camera.z * 1.2, 10);
      camera.z = newZ;
      
      // Keep center
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const wx = (cx - camera.x) / oldZ; // old world x
      const wy = (cy - camera.y) / oldZ;
      
      // new x/y
      camera.x = cx - wx * camera.z;
      camera.y = cy - wy * camera.z;
      
      if (state.MODE === 'booth') {
          // Fix: Send correct zoom and position
          ipcRenderer.send('video-booth-zoom', { zoom: camera.z, x: camera.x, y: camera.y });
      }

      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      updateMinimap();
  };
  document.getElementById('btn-pan-zoom-out').onclick = () => {
      const camera = state.getActiveCamera();
      const oldZ = camera.z;
      const newZ = Math.max(camera.z / 1.2, 0.1);
      camera.z = newZ;

      // Keep center
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const wx = (cx - camera.x) / oldZ; 
      const wy = (cy - camera.y) / oldZ;
      
      camera.x = cx - wx * camera.z;
      camera.y = cy - wy * camera.z;
      
      if (state.MODE === 'booth') {
           ipcRenderer.send('video-booth-zoom', { zoom: camera.z, x: camera.x, y: camera.y });
      }

      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      updateMinimap();
  };
  document.getElementById('btn-pan-zoom-reset').onclick = () => {
      const camera = state.getActiveCamera();
      const oldZ = camera.z;
      camera.z = 1;
      
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const wx = (cx - camera.x) / oldZ;
      const wy = (cy - camera.y) / oldZ;
      
      camera.x = cx - wx * camera.z;
      camera.y = cy - wy * camera.z;

      if (state.MODE === 'booth') {
          // Fix: Send correct zoom and position
          ipcRenderer.send('video-booth-zoom', { zoom: camera.z, x: camera.x, y: camera.y });
      }

      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      updateMinimap();
  };
  document.getElementById('btn-pan-fit-screen').onclick = () => {
      canvasModule.fitCameraToContent();
      
      if (state.MODE === 'booth') {
          const camera = state.getActiveCamera();
          // Fix: Ensure we sync exact position
          ipcRenderer.send('video-booth-zoom', { zoom: camera.z, x: camera.x, y: camera.y });
      }
      
      updateMinimap();
  };
  document.getElementById('btn-pan-toggle-map').onclick = () => {
      const btn = document.getElementById('btn-pan-toggle-map');
      const icon = btn.querySelector('i');
      if (minimapContainer.style.display === 'none') {
          minimapContainer.style.display = 'block';
          updateMinimap();
          if (icon) icon.className = 'ri-arrow-down-s-line';
          btn.title = '隐藏地图';
      } else {
          minimapContainer.style.display = 'none';
          if (icon) icon.className = 'ri-arrow-up-s-line';
          btn.title = '显示地图';
      }
  };
  
  // Minimap Interaction
  let isDraggingMap = false;
  minimapViewport.onpointerdown = (e) => {
      isDraggingMap = true;
      minimapViewport.setPointerCapture(e.pointerId);
  };
  minimapViewport.onpointermove = (e) => {
      if (!isDraggingMap || !state.minimapTransform) return;
      
      const dx = e.movementX;
      const dy = e.movementY;
      
      // Convert screen delta to world delta
      const scale = state.minimapTransform.scale;
      const worldDx = dx / scale;
      const worldDy = dy / scale;
      
      const camera = state.getActiveCamera();
      // Viewport moves right -> camera x decreases (panning right)
      // Wait. If I drag the viewport box right, I want to see the area to the right?
      // No, the viewport box represents "what I see".
      // If I drag the viewport box to the right (over new content), the camera should move to show that content.
      // So camera.x should change such that the viewport center moves.
      
      // Camera x is the screen offset.
      // World View Left = (0 - camera.x) / camera.z
      // If View Left increases (moves right), camera.x must decrease.
      // So camera.x -= worldDx * camera.z
      
      camera.x -= worldDx * camera.z;
      camera.y -= worldDy * camera.z;
      
      if (state.MODE === 'booth') {
          ipcRenderer.send('video-booth-move', { dx: -worldDx * camera.z, dy: -worldDy * camera.z });
      }

      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      
      // Update viewport position visually without full re-render for smoothness?
      // Actually updateMinimap is fast enough for small map.
      updateMinimap();
  };
  minimapViewport.onpointerup = (e) => {
      isDraggingMap = false;
      minimapViewport.releasePointerCapture(e.pointerId);
  };
}

function showFullscreenBrowser(url) {
    const layer = document.getElementById('fullscreen-browser-layer');
    const exitBtn = document.getElementById('fullscreen-exit-btn');
    const toolbar = document.getElementById('main-toolbar');
    const pageControls = document.getElementById('page-controls');
    const leftControls = document.getElementById('left-controls');
    
    // Hide side controls
    if (pageControls) pageControls.style.display = 'none';
    if (leftControls) leftControls.style.display = 'none';

    // Clear old webview if exists
    const oldWebview = layer.querySelector('webview');
    if (oldWebview) oldWebview.remove();

    const webview = document.createElement('webview');
    webview.src = url;
    webview.style.width = '100%';
    webview.style.height = '100%';
    
    layer.appendChild(webview);
    layer.style.display = 'flex';
    if (exitBtn) exitBtn.style.display = 'flex';
    // Adjust height to leave space for toolbar (and maybe a bit more)
    // Toolbar is at bottom 20px, height ~60px. Total 80px.
    const toolbarRect = toolbar.getBoundingClientRect();
    const bottomSpace = toolbarRect.height + 40;
    layer.style.height = `calc(100vh - ${bottomSpace}px)`;
    
    // Enable interaction
    require('./objects').updateObjectInteraction();
    
    // Fix: Allow writing on top of browser
    // The layer is z-index 90. Canvas is 20. 
    // To write ON TOP, we need canvas to be higher than 90?
    // But then canvas blocks interaction with browser.
    // Solution: When Pen tool is active, make canvas z-index 100 and pointer-events auto.
    // When Mouse/Select tool, canvas z-index 20.
    // This logic should be in handleToolClick or updateObjectInteraction.
    
    exitBtn.onclick = () => {
        hideFullscreenBrowser();
    };
}

function hideFullscreenBrowser() {
    const layer = document.getElementById('fullscreen-browser-layer');
    layer.style.display = 'none';
    const exitBtn = document.getElementById('fullscreen-exit-btn');
    if (exitBtn) exitBtn.style.display = 'none';
    const webview = layer.querySelector('webview');
    if (webview) webview.remove();

    // Show side controls
    const pageControls = document.getElementById('page-controls');
    const leftControls = document.getElementById('left-controls');
    if (pageControls) pageControls.style.display = 'flex';
    if (leftControls) leftControls.style.display = 'flex';
    
    require('./objects').updateObjectInteraction();
}

function updatePagePreviewIfOpen() {
    const popup = document.getElementById('page-preview-popup');
    if (popup && popup.style.display !== 'none' && cachedDeleteCallback) {
        renderPagePreview(cachedDeleteCallback);
    }
}

function updateShapeStatus(shapeType, step) {
    if (!shapeStatusPopup) return;
    
    // Hide if step 0 (finished)
    if (step === 0) {
        shapeStatusPopup.style.display = 'none';
        return;
    }
    
      // Standardize vertical positioning for all popups
      const rect = toolbar.getBoundingClientRect(); // Shape popup centered on toolbar
      
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      
      let bottomPos = window.innerHeight - rect.top + 12;
      let topPos = 'auto';
      
      const threshold = 200; 
      if (spaceAbove < threshold && spaceBelow > spaceAbove) {
          bottomPos = 'auto';
          topPos = `${rect.bottom + 12}px`;
      }
      
      shapeStatusPopup.style.bottom = bottomPos === 'auto' ? 'auto' : `${bottomPos}px`;
      shapeStatusPopup.style.top = topPos;
      
      shapeStatusPopup.style.display = 'flex';
    
    // Update Text
    document.getElementById('shape-status-text').textContent = `绘制“${shapesModule.SHAPE_NAMES[shapeType] || '形状'}”`;
    
    // Generate Steps
    const center = shapeStatusPopup.querySelector('.shape-status-center');
    center.innerHTML = '';
    
    const steps = shapesModule.getShapeSteps(shapeType);
    
    steps.forEach((s, i) => {
        const indicator = document.createElement('div');
        indicator.className = `step-indicator ${step >= s.id ? 'active' : ''}`;
        indicator.textContent = s.id;
        
        const desc = document.createElement('div');
        desc.className = 'step-desc';
        desc.textContent = s.desc;
        
        center.appendChild(indicator);
        center.appendChild(desc);
        
        if (i < steps.length - 1) {
            const line = document.createElement('div');
            line.className = 'step-line';
            center.appendChild(line);
        }
    });
}

function showChoiceModal(title, message, choices, callback) {
    const modal = document.getElementById('modal-dialog');
    const titleEl = document.getElementById('modal-title');
    const fieldsContainer = document.getElementById('modal-fields');
    const cancelBtn = document.getElementById('modal-cancel');
    const confirmBtn = document.getElementById('modal-confirm');
    
    titleEl.textContent = title;
    fieldsContainer.innerHTML = `<div style="color: var(--fg); margin-bottom: 16px;">${message}</div>`;
    
    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.flexDirection = 'column';
    btnContainer.style.gap = '8px';
    
    let cleanup;

    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'tool-btn small';
        btn.style.width = '100%';
        btn.style.justifyContent = 'center';
        btn.textContent = choice.label;
        btn.onclick = () => {
            if (cleanup) cleanup();
            callback(choice.value);
        };
        btnContainer.appendChild(btn);
    });
    
    fieldsContainer.appendChild(btnContainer);

    // Hide default buttons
    const modalButtons = modal.querySelector('.modal-buttons');
    if (modalButtons) modalButtons.style.display = 'none';

    modal.style.display = 'flex';

    cleanup = () => {
        modal.style.display = 'none';
        if (modalButtons) modalButtons.style.display = 'flex';
        btnContainer.remove();
        fieldsContainer.innerHTML = '';
    };
}

let lastModeToastTime = 0;
let lastModeToastText = '';

function showModeToast(modeOrText, position, duration = 1500) {
    let text = modeOrText;
    if (modeOrText === 'pen') text = '当前处于：批注模式';
    else if (modeOrText === 'eraser') text = '当前处于：橡皮模式';
    
    // Frequency Check (10s)
    const now = Date.now();
    if (text === lastModeToastText && now - lastModeToastTime < 10000) {
        // If clicked again within 10s?
        // User: "in 10s, 2nd and more clicks pop up".
        // Implementation:
        // First click (t0): record time, count=1. Don't show?
        // Second click (t1 < t0+10s): show.
        // Wait, "2nd and more clicks pop up" implies the FIRST one does NOT pop up?
        // "Prompt pops up on the 2nd and subsequent clicks within 10s".
        // So first click is silent.
        
        if (!state.modeToastCount) state.modeToastCount = 0;
        state.modeToastCount++;
        
        if (state.modeToastCount < 2) {
            lastModeToastTime = now;
            return;
        }
    } else {
        // Reset or different text or timeout
        // If timeout passed, treat as new first click?
        // "Within 10s".
        state.modeToastCount = 1;
        lastModeToastText = text;
        lastModeToastTime = now;
        return; // Don't show on first click
    }
    
    // If we are here, we are showing it.
    lastModeToastTime = now; 

    let toast = document.getElementById('mode-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'mode-toast';
        toast.className = 'mode-toast';
        document.body.appendChild(toast);
    }
    
    toast.textContent = text;
    
    if (position) {
        // Measure first
        toast.style.opacity = '0';
        toast.classList.add('visible');
        
        // Reset previous styles to ensure correct measurement
        toast.style.left = '0px';
        toast.style.top = '0px';
        toast.style.transform = 'none';
        
        const rect = toast.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        
        let left = position.x + 20; // Default: right of cursor
        let top = position.y - height / 2; // Default: Vertically centered
        
        // Boundary Checks
        const padding = 10;
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        
        // Horizontal Check
        if (left + width > winW - padding) {
            // Flip to left side
            left = position.x - width - 20;
        }
        if (left < padding) left = padding;
        
        // Vertical Check
        if (top + height > winH - padding) {
            top = winH - height - padding;
        }
        if (top < padding) top = padding;
        
        toast.style.left = `${left}px`;
        toast.style.top = `${top}px`;
        toast.style.transform = 'none';
        
        // Restore opacity (handled by class transition, but we set inline style 0 above)
        toast.style.opacity = '';
    } else {
        toast.style.top = '50%';
        toast.style.left = '50%';
        toast.style.transform = 'translate(-50%, -50%)';
    }
    
    // Force reflow to ensure transition plays if we just added visible class? 
    // Actually we added it above for measurement.
    // If we remove opacity inline style, it should transition to 1 if class is there.
    // But we might need a small delay or reflow if it wasn't visible before.
    
    requestAnimationFrame(() => {
        toast.classList.add('visible');
        updateInteractiveShape(); // Update shape for toast
    });
    
    if (state.toastTimeout) clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
        updateInteractiveShape(); // Update shape after toast hides
    }, duration);
}

function showContinueWhiteboardToast(onYes, onNo) {
    let toast = document.getElementById('wb-continue-toast');
    if (toast) toast.remove();
    
    const toolbar = document.getElementById('main-toolbar');
    const rect = toolbar.getBoundingClientRect();
    
    // Determine position: usually above toolbar
    // But check space
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    
    let topPos = 'auto';
    let bottomPos = `${window.innerHeight - rect.top + 12}px`; // Above toolbar (bottom aligned)
    
    // If tight on top space (e.g. toolbar at top), flip to bottom
    const threshold = 100;
    if (spaceAbove < threshold && spaceBelow > spaceAbove) {
        bottomPos = 'auto';
        topPos = `${rect.bottom + 12}px`;
    }
    
    toast = document.createElement('div');
    toast.id = 'wb-continue-toast';
    toast.className = 'mode-toast visible'; 
    toast.style.bottom = bottomPos;
    toast.style.top = topPos;
    
      // Horizontal Center on Toolbar
      const toolbarCenter = rect.left + rect.width / 2;
      toast.style.left = `${toolbarCenter}px`;
      toast.style.transform = 'translateX(-50%)';
      
      toast.style.display = 'flex';
      toast.style.alignItems = 'center';
      toast.style.gap = '12px';
      toast.style.padding = '12px 20px';
      toast.style.pointerEvents = 'auto'; 
      toast.style.opacity = '1';
      
      // Match Toolbar Appearance
      toast.style.background = 'var(--panel)';
      toast.style.backdropFilter = 'blur(10px)';
      toast.style.border = '1px solid var(--border)';
      toast.style.borderRadius = '12px';
      toast.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
      toast.style.color = 'var(--fg)';
      toast.style.fontFamily = 'sans-serif';
      
      const strokes = state.getActiveStrokes();
      const hasStrokes = strokes.length > 0;
      const message = hasStrokes ? '是否接续屏幕批注？' : '是否将桌面作为截图插入？';
      
      toast.innerHTML = `
          <span style="font-size:14px;">${message}</span>
          <div style="display:flex; gap:8px;">
              <button id="btn-wb-yes" class="icon-only-btn" style="color:#52c41a; background:var(--input-bg); border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; border:1px solid #52c41a; cursor:pointer;"><i class="ri-check-line" style="font-size:18px;"></i></button>
              <button id="btn-wb-no" class="icon-only-btn" style="color:#ff4d4f; background:var(--input-bg); border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; border:1px solid #ff4d4f; cursor:pointer;"><i class="ri-close-line" style="font-size:18px;"></i></button>
          </div>
      `;
      
      document.body.appendChild(toast);
      updateInteractiveShape(); // Update shape for whiteboard toast
      
      // Auto-hide after 5s and default to No (Cancel)
      const autoHideTimer = setTimeout(() => {
          if (document.body.contains(toast)) {
              toast.remove();
              if (onNo) onNo();
              updateInteractiveShape(); // Update shape after toast removal
          }
      }, 5000);
      
      // Clear timer on interaction
      // toast.onpointerenter = () => clearTimeout(autoHideTimer);
      
      document.getElementById('btn-wb-yes').onclick = () => {
          clearTimeout(autoHideTimer);
          toast.remove();
          onYes();
          updateInteractiveShape(); // Update shape
      };
      
      document.getElementById('btn-wb-no').onclick = () => {
          clearTimeout(autoHideTimer);
          toast.remove();
          onNo();
          updateInteractiveShape(); // Update shape
      };
  }

// Edge Pan Logic
function checkEdgePan(point) {
    // Hide in Annotate Mode
    if (state.MODE === 'annotate') return;

    // Only if not dragging something else?
    if (state.isPanning || state.isMovingSelection) return;
}

let moreConfig = null;

async function loadConfig() {
    try {
        const res = await ipcRenderer.invoke('config:plugin:getAll', 'screen-annotate');
        if (res) {
            applyConfig(res);
        } else {
            // Defaults
            moreConfig = [
                // { label: '设置', icon: 'ri-settings-3-line', actionType: 'openSettings', actionPayload: {}, locked: true }, // Removed to avoid duplication
                { label: '关闭', icon: 'ri-close-circle-line', actionType: 'close', actionPayload: {}, locked: true },
                { label: '计时', icon: 'ri-timer-line', actionType: 'plugin', actionPayload: { pluginId: 'clock-timer', fn: 'openTimer' } }
            ];
        }
    } catch (e) {
        console.error('Failed to load config:', e);
    }
}

function renderMorePopup() {
    const grid = document.getElementById('more-tools-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (!moreConfig) return;

    moreConfig.forEach(btn => {
        const el = document.createElement('button');
        el.className = 'tool-btn small-col'; // New class for grid items
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.padding = '8px';
        el.style.gap = '4px';
        el.style.width = '100%';
        el.style.minWidth = '0'; // Override tool-btn min-width
        el.style.height = 'auto';
        el.style.background = 'transparent';
        el.style.border = 'none';
        el.style.color = 'var(--fg)';
        el.style.cursor = 'pointer';
        el.style.borderRadius = '8px';
        
        // Hover effect handled by CSS usually
        el.onmouseenter = () => el.style.background = 'rgba(255,255,255,0.1)';
        el.onmouseleave = () => el.style.background = 'transparent';

        let iconHtml = '';
        const ic = btn.icon || '';
        if (ic.startsWith('data:') || ic.startsWith('http') || ic.includes('/') || ic.includes('\\')) {
            iconHtml = `<img src="${ic}" style="width:24px;height:24px;object-fit:contain;">`;
        } else {
            iconHtml = `<i class="${ic}" style="font-size:24px;"></i>`;
        }
        
        el.innerHTML = `${iconHtml}<span style="font-size:10px; margin-top:4px;">${btn.label}</span>`;
        
        el.onclick = (e) => {
            e.stopPropagation();
            executeButtonAction(btn);
            morePopup.style.display = 'none';
            state.isMenuOpen = false;
        };
        
        grid.appendChild(el);
    });
}

function executeButtonAction(btn) {
    const { actionType, actionPayload } = btn;
    if (actionType === 'close') {
        ipcRenderer.send('annotate-close');
    } else if (actionType === 'openSettings') {
        openSettingsView();
    } else if (actionType === 'plugin') {
        const { pluginId, fn, args } = actionPayload || {};
        if (pluginId) {
            if (fn) {
                ipcRenderer.invoke('plugin:call', pluginId, fn, args || []).catch(console.error);
            }
        }
    } else if (actionType === 'app') {
        const path = actionPayload?.path || btn.path;
        if (path) ipcRenderer.send('annotate-open-path', path);
    } else if (actionType === 'key') {
        const key = actionPayload?.key;
        // Key simulation requires main process support or robotjs
    }
}

function openSettingsView() {
    const layer = document.getElementById('settings-layer');
    const webview = document.getElementById('settings-webview');
    if (layer && webview) {
        layer.style.display = 'flex';
        
        // Force reload to ensure fresh state and fix loading issues
        const settingsPath = 'settings.html';
        const currentSrc = webview.src || webview.getAttribute('src') || '';
        if (currentSrc.indexOf(settingsPath) === -1) {
             webview.src = settingsPath;
        } else {
             // Force reload by resetting src
             webview.src = 'about:blank';
             setTimeout(() => {
                 webview.src = settingsPath;
             }, 50);
        }
        
        // Listen for close message
        const messageHandler = (event) => {
            if (event.channel === 'close-settings') {
                layer.style.display = 'none';
                
                // Fix for Issue 5: Always restore mouse passthrough state
                // Use a small timeout to allow state to settle
                setTimeout(() => {
                    // Force update to restore correct state (e.g. pen mode should not ignore mouse)
                    // We need to access updateMousePassthrough from renderer scope? 
                    // No, we can't. But we can send IPC to main to reset?
                    // Or better, we can invoke a global function if exposed.
                    // Or just handle it here if we can import logic.
                    // updateMousePassthrough is in renderer.js, not exported.
                    // But wait, openSettingsView is in ui.js.
                    // ui.js is required by renderer.js.
                    // We can export updateMousePassthrough from renderer? No, circular dependency.
                    // We can emit an event on ipcRenderer that renderer listens to?
                    // Or just use the existing logic in renderer.js which listens to 'annotate-open-settings-view'?
                    // No, that opens it.
                    
                    // Let's send a custom event that renderer listens to?
                    ipcRenderer.emit('settings-closed-internal');
                }, 50);

                // Reload config after close just in case
                ipcRenderer.invoke('annotate-get-config').then(applyConfig);
            } else if (event.channel === 'settings-saved') {
                // Apply config immediately
                applyConfig(event.args[0]);
            }
        };
        
        // Remove old listener to avoid duplicates
        webview.removeEventListener('ipc-message', webview._messageHandler);
        webview._messageHandler = messageHandler;
        webview.addEventListener('ipc-message', messageHandler);
        
        // Force pointer events on layer
        ipcRenderer.send('annotate-set-ignore-mouse-events', false);
    }
}

async function applyConfig(config) {
    if (!config) return;
    
    // Toolbar
    if (config.toolbar) {
        state.toolbarConfig = config.toolbar;
        if (currentToolbarCallback) {
            renderToolbar(currentToolbarCallback);
        }
    }
    
    // More Buttons
    if (config.buttons) {
        moreConfig = config.buttons;
        const morePopup = document.getElementById('more-popup');
        if (morePopup && morePopup.style.display !== 'none') {
            renderMorePopup();
        }
    }
    
    // Writing Preferences
    if (config.writingPreferences) {
        const wp = config.writingPreferences;
        if (wp.penColor) {
            state.penColor = wp.penColor;
            updateColorSelection();
        }
        if (wp.penSize) {
            state.penSize = parseInt(wp.penSize);
            const slider = document.getElementById('pen-size-slider');
            const display = document.getElementById('pen-size-display');
            if (slider) slider.value = state.penSize;
            if (display) display.textContent = state.penSize;
        }
        if (wp.penTaper !== undefined) {
            state.penTaper = wp.penTaper;
            const toggle = document.getElementById('pen-taper-toggle');
            if (toggle) toggle.checked = state.penTaper;
        }
        if (wp.eraserSize) {
            state.eraserSize = parseInt(wp.eraserSize);
            updateEraserSelection();
        }
    }
    
    // Whiteboard Settings
    if (config.whiteboard) {
        state.whiteboardSettings = config.whiteboard;
        const edgePanLayer = document.getElementById('edge-pan-layer');
        if (edgePanLayer && state.MODE !== 'annotate') {
            edgePanLayer.style.display = config.whiteboard.panAssist ? 'block' : 'none';
        }
        if (config.whiteboard.defaultBgColor && state.MODE === 'whiteboard') {
            state.pageBackgrounds[state.currentPageIndex] = config.whiteboard.defaultBgColor;
            document.documentElement.style.setProperty('--bg', config.whiteboard.defaultBgColor);
            ipcRenderer.send('annotate-set-background-color', config.whiteboard.defaultBgColor);
        }
    }
    
    // Auto Save
    if (config.autoSave) {
        state.autoSave = config.autoSave;
    }
}

// Listen for main process command to open settings
ipcRenderer.on('annotate-open-settings-view', () => {
    openSettingsView();
});

async function toggleMorePopup() {
    const isDesktopToolbar = document.body.classList.contains('role-desktop-toolbar');
    
    if (state.isMenuOpen && morePopup.style.display !== 'none') {
        morePopup.style.display = 'none';
        state.isMenuOpen = false;
        
        // Resize window back if in desktop toolbar mode
        if (isDesktopToolbar) {
            const tb = document.getElementById('main-toolbar');
            if (tb) {
                const rect = tb.getBoundingClientRect();
                ipcRenderer.send('resize-window', { width: Math.ceil(rect.width + 20), height: Math.ceil(rect.height + 20) });
                setTimeout(() => {
                    const padding = 10;
                    const shapeRect = {
                        x: padding,
                        y: padding,
                        width: Math.ceil(rect.width + padding),
                        height: Math.ceil(rect.height + padding)
                    };
                    ipcRenderer.send('annotate-update-shape', [shapeRect]);
                }, 50);
            }
        }
    } else {
        // Close other popups
        toolSettingsPopup.style.display = 'none';
        if (shapeStatusPopup) shapeStatusPopup.style.display = 'none';
        
        if (!moreConfig) await loadConfig();
        renderMorePopup();
        
        // Position popup for desktop toolbar
        if (isDesktopToolbar) {
            morePopup.style.position = 'fixed';
            morePopup.style.left = '50%';
            morePopup.style.transform = 'translateX(-50%)';
            morePopup.style.top = '10px';
            morePopup.style.bottom = 'auto';
        }
        
        morePopup.style.display = 'block';
        state.isMenuOpen = true;
        
        // Resize window if in desktop toolbar mode
        if (isDesktopToolbar) {
            requestAnimationFrame(() => {
                const tb = document.getElementById('main-toolbar');
                const popup = morePopup;
                
                if (tb && popup) {
                    const tbRect = tb.getBoundingClientRect();
                    const popupRect = popup.getBoundingClientRect();
                    
                    const w = Math.ceil(popupRect.width + 20);
                    const h = Math.ceil(popupRect.height + tbRect.height + 40);
                    
                    ipcRenderer.send('resize-window', { width: w, height: h });
                    
                    setTimeout(() => {
                        const padding = 10;
                        const shapeRect = {
                            x: padding,
                            y: padding,
                            width: Math.ceil(popupRect.width + padding),
                            height: Math.ceil(popupRect.height + tbRect.height + padding * 2)
                        };
                        ipcRenderer.send('annotate-update-shape', [shapeRect]);
                    }, 50);
                }
            });
        } else {
            updatePopupPositions();
        }
        
        // Fix: Allow mouse interaction in annotate mode
        if (state.MODE === 'annotate') {
            ipcRenderer.send('annotate-set-ignore-mouse-events', false);
        }
    }
    updateInteractiveShape();
}

// Fix: Add mouse listeners to morePopup to handle transparency
const morePopupEl = document.getElementById('more-popup');
// User requested to remove mouseenter/leave/move for transparency

// Edit button inside popup
const moreEditBtn = document.getElementById('btn-more-edit');
if (moreEditBtn) {
    moreEditBtn.onclick = () => {
        openSettingsView();
        morePopup.style.display = 'none';
        state.isMenuOpen = false;
    };
}

// Listen for config changes
ipcRenderer.on('screen-annotate:config-changed', (e, newConfig) => {
    if (newConfig && newConfig.buttons) {
        moreConfig = newConfig.buttons;
        if (morePopup && morePopup.style.display !== 'none') {
            renderMorePopup();
        }
    }
});

module.exports = {
    showModeToast,
    showContinueWhiteboardToast,
    showChoiceModal,
    renderToolbar,
    toggleToolMenu,
    toggleMorePopup,
    updateColorSelection,
    updateEraserSelection,
    showModal,
    updatePageIndicator,
    updateCurrentPageSnapshot,
    renderPagePreview,
    updatePagePreviewIfOpen,
    bindSettingsUI,
    showFullscreenBrowser,
    hideFullscreenBrowser,
    updateMinimap, // Export this
    updateShapeStatus, // Export this
    pageControls,
    leftControls,
    toolSettingsPopup,
    insertMenuPopup,
    adjustPopup,
    showSavePopup,
    initScreenshotUI,
    enableVideoBooth,
    applyConfig // Export
};

function initScreenshotUI(callbacks) {
    const minibar = document.getElementById('screenshot-minibar');
    if (!minibar) return;
    const handle = minibar.querySelector('.minibar-drag-handle');
    
    // Drag Logic
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    
    handle.onpointerdown = (e) => {
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        isDragging = true;
        const rect = minibar.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        minibar.style.bottom = 'auto'; 
        minibar.style.left = `${rect.left}px`;
        minibar.style.top = `${rect.top}px`;
        updateInteractiveShape(true); // Fullscreen for screenshot minibar drag
    };
    
    handle.onpointermove = (e) => {
        if (!isDragging) return;
        let x = e.clientX - offsetX;
        let y = e.clientY - offsetY;
        
        // Constrain
        x = Math.max(0, Math.min(window.innerWidth - minibar.offsetWidth, x));
        y = Math.max(0, Math.min(window.innerHeight - minibar.offsetHeight, y));
        
        minibar.style.left = `${x}px`;
        minibar.style.top = `${y}px`;
    };
    
    handle.onpointerup = (e) => {
        if (!isDragging) return;
        isDragging = false;
        handle.releasePointerCapture(e.pointerId);
        updateInteractiveShape(false); // Restore shape
    };
    
    // Buttons
    document.getElementById('btn-shot-full').onclick = callbacks.onScreenshotFull;
    document.getElementById('btn-shot-confirm').onclick = callbacks.onScreenshotConfirm;
    document.getElementById('btn-shot-reselect').onclick = callbacks.onScreenshotReselect;
    if (callbacks.onScreenshotCancel) {
        document.getElementById('btn-shot-cancel').onclick = callbacks.onScreenshotCancel;
    }
}

function showSavePopup(options = {}) {
    // Check if exists
    let savePopup = document.getElementById('save-popup');
    if (savePopup) savePopup.remove();

    savePopup = document.createElement('div');
    savePopup.id = 'save-popup';
    savePopup.className = 'save-popup';
    
    // Default options
    const defaultOptions = {
        title: '保存',
        showScope: true,
        showFormat: true,
        showArea: true,
        showIncludeInk: false, // Default false unless requested
        initialPath: '',
        onConfirm: null // Custom confirm handler
    };
    
    const config = { ...defaultOptions, ...options };
    
    let html = '';
    
    if (config.showScope) {
        html += `
        <div class="save-section">
            <div class="save-label">保存范围</div>
            <div class="save-options">
                <button class="save-opt-btn active" data-group="scope" data-value="single">当前页</button>
                <button class="save-opt-btn" data-group="scope" data-value="all">全部页</button>
            </div>
        </div>`;
    }
    
    if (config.showFormat) {
        html += `
        <div class="save-section">
            <div class="save-label">保存方式</div>
            <div class="save-options">
                <button class="save-opt-btn active" data-group="format" data-value="image">图片</button>
                <button class="save-opt-btn" data-group="format" data-value="pdf">PDF</button>
            </div>
        </div>`;
    }
    
    if (config.showArea) {
        html += `
        <div class="save-section">
            <div class="save-label">捕获区域</div>
            <div class="save-options">
                <button class="save-opt-btn active" data-group="area" data-value="canvas">整个画布</button>
                <button class="save-opt-btn" data-group="area" data-value="viewport">视图区域</button>
            </div>
        </div>`;
    }
    
    if (config.showIncludeInk) {
        html += `
        <div class="save-section">
            <div class="save-label">选项</div>
            <div style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="chk-include-ink" checked style="width:16px; height:16px;">
                <label for="chk-include-ink" style="font-size:12px; color:var(--fg);">保留笔迹</label>
            </div>
        </div>`;
    }

    html += `
        <div class="save-section">
            <div class="save-label">保存目录</div>
            <div class="save-path-row">
                <input type="text" id="save-path-input" placeholder="选择保存路径..." readonly value="${config.initialPath || ''}">
                <button id="btn-select-path" class="tool-btn small"><i class="ri-folder-open-line"></i></button>
            </div>
        </div>
        <div class="save-actions">
            <button id="btn-cancel-save" class="tool-btn">取消</button>
            <button id="btn-confirm-save" class="tool-btn primary">保存</button>
        </div>
    `;
    
    savePopup.innerHTML = html;
    document.body.appendChild(savePopup);
    makeInteractive(savePopup); // Add interaction logic
    updateInteractiveShape(); // Update shape for save popup

    // Fix for Issue 1: Prevent click-through in Desktop Annotation Mode
    // Already handled by makeInteractive?
    // makeInteractive handles mouseenter/mouseleave.
    // But specific logic was added before.
    // Let's remove duplicate listeners if any, or rely on makeInteractive.
    // The previous implementation was:
    /*
    savePopup.addEventListener('mouseenter', () => { ... });
    savePopup.addEventListener('mouseleave', () => { ... });
    */
    // makeInteractive does exactly this.
    
    // Positioning logic (reused)
    // Try to position near the source button if provided via event or context?
    // Or just default to bottom left or center?
    // Let's use the standard positioning logic if 'save' button exists.
    // Fix for Issue 2: Support Whiteboard Save Button
    const saveBtn = document.querySelector('.tool-btn[data-id="save"]') || document.getElementById('btn-save-wb');
    if (saveBtn) {
        const rect = saveBtn.getBoundingClientRect();
        savePopup.style.left = `${rect.left}px`;
        
        // Check space above
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        
        // If not enough space above (threshold ~400px for full popup), and more space below
        // The popup is taller now with more options.
        // Let's say max height is 400px.
        const popupHeight = savePopup.offsetHeight || 400; // Estimate
        
        if (spaceAbove < popupHeight && spaceBelow > spaceAbove) {
             // Below
             savePopup.style.top = `${rect.bottom + 12}px`;
             savePopup.style.bottom = 'auto';
        } else {
             // Above
             savePopup.style.bottom = `${window.innerHeight - rect.top + 10}px`;
             savePopup.style.top = 'auto';
        }
    } else {
        // Fallback Center
        savePopup.style.left = '50%';
        savePopup.style.top = '50%';
        savePopup.style.transform = 'translate(-50%, -50%)';
        savePopup.style.bottom = 'auto';
    }
    
    // Event Listeners
    savePopup.querySelectorAll('.save-opt-btn').forEach(btn => {
        btn.onclick = (e) => {
            const group = e.target.dataset.group;
            savePopup.querySelectorAll(`.save-opt-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        };
    });
    
    let selectedPath = config.initialPath;
    savePopup.querySelector('#btn-select-path').onclick = async () => {
        const path = await ipcRenderer.invoke('annotate-select-path');
        if (path) {
            selectedPath = path;
            savePopup.querySelector('#save-path-input').value = path;
        }
    };
    
    savePopup.querySelector('#btn-cancel-save').onclick = () => {
        savePopup.remove();
        updateInteractiveShape(); // Update shape after closing save popup
    };
    
    savePopup.querySelector('#btn-confirm-save').onclick = () => {
        const scope = savePopup.querySelector('.save-opt-btn[data-group="scope"].active')?.dataset.value || 'single';
        const format = savePopup.querySelector('.save-opt-btn[data-group="format"].active')?.dataset.value || 'image';
        const area = savePopup.querySelector('.save-opt-btn[data-group="area"].active')?.dataset.value || 'canvas';
        const includeInk = savePopup.querySelector('#chk-include-ink')?.checked ?? true;
        
        const result = {
            scope,
            format,
            area,
            includeInk,
            path: selectedPath
        };

        if (config.onConfirm) {
            config.onConfirm(result);
            savePopup.remove();
        } else {
            // Default Save Logic
            let dataUrl;
            if (scope === 'single') {
                dataUrl = canvasModule.captureCanvas({
                    area: area,
                    includeBackground: true,
                    includeInk: includeInk
                });
            } else {
                 // TODO: Handle 'all' pages
                 dataUrl = canvasModule.captureCanvas({
                    area: area,
                    includeBackground: true,
                    includeInk: includeInk
                });
            }

            savePopup.remove();
            
            ipcRenderer.send('annotate-save-file', { 
                ...result,
                dataUrl: dataUrl,
                type: format,
                name: `annotate-${Date.now()}.${format === 'pdf' ? 'pdf' : 'png'}`
            });
        }
    };
}

function updatePopupPositions() {
    // Sync Tool Settings Popup
    if (state.isMenuOpen && toolSettingsPopup.style.display !== 'none') {
        const type = toolSettingsPopup.dataset.type;
        const btn = document.querySelector(`.tool-btn[data-id="${type}"]`);
        if (btn) {
            const rect = btn.getBoundingClientRect();
            
            // Standardize vertical positioning for all popups
      // Check space above
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      
      // Default to top (popup above button)
      let bottomPos = window.innerHeight - rect.top + 12;
      let topPos = 'auto';
      
      // If not enough space above and more space below, flip to bottom
      // Assuming popup max height around 300px, or use a threshold like 150px
      const threshold = 200; 
      if (spaceAbove < threshold && spaceBelow > spaceAbove) {
          // Position below
          bottomPos = 'auto';
          topPos = `${rect.bottom + 12}px`;
      }
      
      toolSettingsPopup.style.bottom = bottomPos === 'auto' ? 'auto' : `${bottomPos}px`;
      toolSettingsPopup.style.top = topPos;
      
      if (type === 'shape') {
           // Shape popup is wide, center on toolbar
           const tbRect = toolbar.getBoundingClientRect();
           const toolbarCenter = tbRect.left + tbRect.width / 2;
           toolSettingsPopup.style.left = `${toolbarCenter}px`;
           // Note: CSS transform translateX(-50%) handles centering
      } else {
          // Other popups center on button
          const actualWidth = toolSettingsPopup.offsetWidth;
          const left = rect.left + rect.width / 2 - actualWidth / 2;
          toolSettingsPopup.style.left = `${left}px`;
      }
      
      toolSettingsPopup.style.bottom = bottomPos === 'auto' ? 'auto' : `${bottomPos}px`;
      toolSettingsPopup.style.top = topPos;
      
      // Update data-type if not already set (should be set by toggleToolMenu)
      // ...
        }
    }
    
    // Sync Save Popup
    const savePopup = document.getElementById('save-popup');
    if (savePopup) {
         // Fix for Issue 2: Support Whiteboard Save Button
         const btn = document.querySelector(`.tool-btn[data-id="save"]`) || document.getElementById('btn-save-wb');
         if (btn) {
             const rect = btn.getBoundingClientRect();
             savePopup.style.left = `${rect.left}px`;
             // Standardize vertical positioning for all popups
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      
      let bottomPos = window.innerHeight - rect.top + 12;
      let topPos = 'auto';
      
      const threshold = 200; 
      if (spaceAbove < threshold && spaceBelow > spaceAbove) {
          bottomPos = 'auto';
          topPos = `${rect.bottom + 12}px`;
      }
      
      savePopup.style.bottom = bottomPos === 'auto' ? 'auto' : `${bottomPos}px`;
      savePopup.style.top = topPos;
         }
    }
    
    // Sync Shape Status Popup
    const shapeStatusPopup = document.getElementById('shape-status-popup');
    if (shapeStatusPopup && shapeStatusPopup.style.display !== 'none') {
      // Standardize vertical positioning for all popups
      const rect = toolbar.getBoundingClientRect(); // Shape popup centered on toolbar
      
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      
      let bottomPos = window.innerHeight - rect.top + 12;
      let topPos = 'auto';
      
      const threshold = 200; 
      if (spaceAbove < threshold && spaceBelow > spaceAbove) {
          bottomPos = 'auto';
          topPos = `${rect.bottom + 12}px`;
      }
      
      shapeStatusPopup.style.bottom = bottomPos === 'auto' ? 'auto' : `${bottomPos}px`;
      shapeStatusPopup.style.top = topPos;
    }

    // Sync More Popup
    if (state.isMenuOpen && morePopup.style.display !== 'none') {
        const btn = document.querySelector('.tool-btn[data-id="more"]');
        if (btn) {
            const rect = btn.getBoundingClientRect();
            const spaceAbove = rect.top;
            const spaceBelow = window.innerHeight - rect.bottom;
            
            let bottomPos = window.innerHeight - rect.top + 12;
            let topPos = 'auto';
            const threshold = 200; 
            if (spaceAbove < threshold && spaceBelow > spaceAbove) {
                bottomPos = 'auto';
                topPos = `${rect.bottom + 12}px`;
            }
            
            morePopup.style.bottom = bottomPos === 'auto' ? 'auto' : `${bottomPos}px`;
            morePopup.style.top = topPos;
            
            const actualWidth = morePopup.offsetWidth;
            const left = rect.left + rect.width / 2 - actualWidth / 2;
            morePopup.style.left = `${left}px`;
        }
    }
    updateInteractiveShape(); // Update shape after positioning popups
}