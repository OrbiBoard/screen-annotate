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

let toolbarState = {
    isSnapped: true,
    isDragging: false,
    offsetX: 0,
    offsetY: 0,
    disableSnapForThisSession: false,
    willSnap: false
};

const toolSettingsPopup = document.getElementById('tool-settings-popup');
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
    { id: 'whiteboard', icon: 'ri-artboard-line', label: '白板' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' },
    { id: 'save', icon: 'ri-save-line', label: '保存' },
    { id: 'close', icon: 'ri-close-circle-line', label: '关闭' }
  ],
  whiteboard: [
    { id: 'select', icon: 'ri-cursor-fill', label: '选择' },
    { id: 'pen', icon: 'ri-pencil-fill', label: '书写' },
    { id: 'eraser', icon: 'ri-eraser-line', label: '橡皮' },
    { id: 'pan', icon: 'ri-drag-move-line', label: '漫游' },
    { id: 'shape', icon: 'ri-shape-line', label: '形状' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' }
  ],
  booth: [
    { id: 'pen', icon: 'ri-pencil-fill', label: '批注' },
    { id: 'eraser', icon: 'ri-eraser-line', label: '橡皮' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' },
    { id: 'clear', icon: 'ri-delete-bin-line', label: '清页' },
    { id: 'photo', icon: 'ri-camera-line', label: '拍照' },
    { id: 'gallery', icon: 'ri-image-line', label: '相册' },
    { id: 'close', icon: 'ri-close-circle-line', label: '关闭' }
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
    // We can't modify HTML from here easily without re-render, but left-controls is static HTML.
    // We can inject a button.
    const leftControls = document.getElementById('left-controls');
    if (leftControls && !document.getElementById('btn-booth-wb')) {
        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.id = 'btn-booth-wb';
        btn.innerHTML = `<i class="ri-vidicon-line"></i><span>展台</span>`;
        // Insert after Save
        const saveBtn = document.getElementById('btn-save-wb');
        if (saveBtn) {
            saveBtn.parentNode.insertBefore(btn, saveBtn.nextSibling);
        } else {
            leftControls.appendChild(btn);
        }
    }
}

function renderToolbar(handleToolClickCallback) {
  toolbar.innerHTML = '';
  
  // Add Drag Handle
  const handle = document.createElement('div');
  handle.className = 'toolbar-drag-handle';
  handle.innerHTML = '<i class="ri-drag-move-2-fill"></i>';
  toolbar.appendChild(handle);
  
  // Drag Logic
  handle.onpointerdown = (e) => {
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
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
      const defaultY = h - tbH - 20; // 20px margin
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
              toolbar.style.bottom = '20px';
              toolbar.style.top = 'auto';
              toolbar.style.transform = 'none';
          } else if (toolbarState.snapType === 'right') {
              toolbar.style.position = 'fixed';
              toolbar.style.left = 'auto';
              toolbar.style.right = '20px';
              toolbar.style.bottom = '20px';
              toolbar.style.top = 'auto';
              toolbar.style.transform = 'none';
          } else {
              // Center (default)
              toolbar.style.position = '';
              toolbar.style.left = '';
              toolbar.style.top = '';
              toolbar.style.bottom = '';
              toolbar.style.right = '';
              toolbar.style.transform = '';
          }
      } else {
          toolbarState.isSnapped = false;
      }
      updatePopupPositions();
  };

  let toolSet;
  if (state.MODE === 'booth') {
      toolSet = TOOLS.booth;
  } else {
      toolSet = state.MODE === 'annotate' ? TOOLS.annotate : TOOLS.whiteboard;
  }

  if (state.MODE === 'annotate' && state.currentTool === 'mouse') {
      const hiddenTools = ['undo', 'redo', 'select'];
      toolSet = toolSet.filter(t => !hiddenTools.includes(t.id));
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
        
        btn.onclick = (e) => handleToolClickCallback(tool.id);
        
        toolbar.appendChild(btn);
    }
  });
  
  // Show/Hide Pan Overlay
  if (state.currentTool === 'pan') {
      panOverlay.style.display = 'flex';
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
                  toolbar.style.bottom = '20px';
              } else if (newSnapType === 'right') {
                  toolbar.style.position = 'fixed';
                  toolbar.style.right = '20px';
                  toolbar.style.bottom = '20px';
              } else {
                  // Center (default CSS)
                  toolbar.style.position = ''; // Revert to CSS
              }
              updatePopupPositions();
          }
      });
  }
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
  } else {
    // Hide status popup if opening main menu
    shapeStatusPopup.style.display = 'none';
    
    // Fix for Issue 2: Align menu with button
    const btn = document.querySelector(`.tool-btn[data-id="${type}"]`);
    if (btn) {
        // Pre-set content display to calculate correct width
        toolSettingsPopup.dataset.type = type;
        penSettings.style.display = type === 'pen' ? 'flex' : 'none';
        eraserSettings.style.display = type === 'eraser' ? 'flex' : 'none';
        if (panSettings) panSettings.style.display = type === 'pan' ? 'flex' : 'none';
        if (shapeSettings) shapeSettings.style.display = type === 'shape' ? 'block' : 'none';
        
        const rect = btn.getBoundingClientRect();
        
      // Standardize vertical positioning
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
            // Shape Menu special positioning (Above toolbar, full width or matching toolbar)
            const tbRect = toolbar.getBoundingClientRect();
            // Align with toolbar width but place above
            toolSettingsPopup.style.width = 'auto'; // Auto width to fit content
            toolSettingsPopup.style.minWidth = `${tbRect.width}px`; // At least toolbar width
            const toolbarCenter = tbRect.left + tbRect.width / 2;
            toolSettingsPopup.style.left = `${toolbarCenter}px`;
            
            toolSettingsPopup.style.transform = 'translateX(-50%)'; // Center horizontally
      } else {
            toolSettingsPopup.style.width = ''; // Reset width
            toolSettingsPopup.style.minWidth = ''; // Reset min-width
            
            // We can set display block first (visibility hidden) to get width?
            toolSettingsPopup.style.visibility = 'hidden';
            toolSettingsPopup.style.display = 'block';
            const actualWidth = toolSettingsPopup.offsetWidth;
            toolSettingsPopup.style.visibility = 'visible';
            
            const left = rect.left + rect.width / 2 - actualWidth / 2;
            toolSettingsPopup.style.left = `${left}px`;
            toolSettingsPopup.style.transform = 'none'; // Remove translateX(-50%)
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
      camera.z = Math.min(camera.z * 1.2, 10);
      // Keep center
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const wx = (cx - camera.x) / (camera.z / 1.2); // old world x
      const wy = (cy - camera.y) / (camera.z / 1.2);
      
      // new x/y
      camera.x = cx - wx * camera.z;
      camera.y = cy - wy * camera.z;
      
      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      updateMinimap();
  };
  document.getElementById('btn-pan-zoom-out').onclick = () => {
      const camera = state.getActiveCamera();
      camera.z = Math.max(camera.z / 1.2, 0.1);
      // Keep center
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const wx = (cx - camera.x) / (camera.z * 1.2); 
      const wy = (cy - camera.y) / (camera.z * 1.2);
      camera.x = cx - wx * camera.z;
      camera.y = cy - wy * camera.z;
      
      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      updateMinimap();
  };
  document.getElementById('btn-pan-zoom-reset').onclick = () => {
      const camera = state.getActiveCamera();
      camera.z = 1;
      // Recenter? Or just scale 1?
      // "100%" usually means zoom=1.
      canvasModule.renderCanvas();
      objects.updateDOMObjects();
      updateMinimap();
  };
  document.getElementById('btn-pan-fit-screen').onclick = () => {
      canvasModule.fitCameraToContent();
      updateMinimap();
  };
  document.getElementById('btn-pan-toggle-map').onclick = () => {
      if (minimapContainer.style.display === 'none') {
          minimapContainer.style.display = 'block';
          updateMinimap();
      } else {
          minimapContainer.style.display = 'none';
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

function showModeToast(mode, position) {
    let toast = document.getElementById('mode-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'mode-toast';
        toast.className = 'mode-toast';
        document.body.appendChild(toast);
    }
    
    let text = '';
    if (mode === 'pen') text = '当前处于：批注模式';
    else if (mode === 'eraser') text = '当前处于：橡皮模式';
    else return; // Only for pen/eraser
    
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
    });
    
    if (state.toastTimeout) clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, 1500);
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
      
      // Auto-hide after 5s if no interaction
      const autoHideTimer = setTimeout(() => {
          if (document.body.contains(toast)) {
              toast.style.opacity = '0';
              setTimeout(() => toast.remove(), 300); // Wait for fade out
              // Fix: Do not clear strokes on timeout, just hide the prompt.
              // User can clear manually if they want.
          }
      }, 5000);
      
      // Clear timer on interaction
      toast.onpointerenter = () => clearTimeout(autoHideTimer);
      
      document.getElementById('btn-wb-yes').onclick = () => {
          clearTimeout(autoHideTimer);
          toast.remove();
          onYes();
      };
      
      document.getElementById('btn-wb-no').onclick = () => {
          clearTimeout(autoHideTimer);
          toast.remove();
          onNo();
      };
  }

// Edge Pan Logic
function checkEdgePan(point) {
    // Hide in Annotate Mode
    if (state.MODE === 'annotate') return;

    // Only if not dragging something else?
    if (state.isPanning || state.isMovingSelection) return;
}

module.exports = {
    showModeToast,
    showContinueWhiteboardToast,
    showChoiceModal,
    renderToolbar,
    toggleToolMenu,
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
    enableVideoBooth // Export
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
    };
    
    // Buttons
    document.getElementById('btn-shot-full').onclick = callbacks.onScreenshotFull;
    document.getElementById('btn-shot-confirm').onclick = callbacks.onScreenshotConfirm;
    document.getElementById('btn-shot-reselect').onclick = callbacks.onScreenshotReselect;
}

function showSavePopup() {
    // Check if exists
    let savePopup = document.getElementById('save-popup');
    if (savePopup) savePopup.remove();

    savePopup = document.createElement('div');
    savePopup.id = 'save-popup';
    savePopup.className = 'save-popup';
    
    const leftControls = document.getElementById('left-controls');
    if (leftControls) {
        const rect = leftControls.getBoundingClientRect();
        savePopup.style.left = `${rect.left}px`;
        savePopup.style.bottom = `${window.innerHeight - rect.top}px`;
    }
    
    savePopup.innerHTML = `
        <div class="save-section">
            <div class="save-label">保存范围</div>
            <div class="save-options">
                <button class="save-opt-btn active" data-group="scope" data-value="single">当前页</button>
                <button class="save-opt-btn" data-group="scope" data-value="all">全部页</button>
            </div>
        </div>
        <div class="save-section">
            <div class="save-label">保存方式</div>
            <div class="save-options">
                <button class="save-opt-btn active" data-group="format" data-value="image">图片</button>
                <button class="save-opt-btn" data-group="format" data-value="pdf">PDF</button>
            </div>
        </div>
        <div class="save-section">
            <div class="save-label">捕获区域</div>
            <div class="save-options">
                <button class="save-opt-btn active" data-group="area" data-value="canvas">整个画布</button>
                <button class="save-opt-btn" data-group="area" data-value="viewport">视图区域</button>
            </div>
        </div>
        <div class="save-section">
            <div class="save-label">保存目录</div>
            <div class="save-path-row">
                <input type="text" id="save-path-input" placeholder="选择保存路径..." readonly>
                <button id="btn-select-path" class="tool-btn small"><i class="ri-folder-open-line"></i></button>
            </div>
        </div>
        <div class="save-actions">
            <button id="btn-cancel-save" class="tool-btn">取消</button>
            <button id="btn-confirm-save" class="tool-btn primary">保存</button>
        </div>
    `;
    
    document.body.appendChild(savePopup);
    
    // Positioning
    const saveBtn = document.querySelector('.tool-btn[data-id="save"]');
    if (saveBtn) {
        const rect = saveBtn.getBoundingClientRect();
        savePopup.style.left = `${rect.left}px`;
        // Position above the button (bottom of popup = top of button - 10px)
        savePopup.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        savePopup.style.top = 'auto'; // Ensure top is unset
        savePopup.style.transform = 'none'; // Ensure transform is unset
    } else {
        // Fallback
        savePopup.style.left = '20px';
        savePopup.style.bottom = '80px';
    }
    
    // Event Listeners for Options
    savePopup.querySelectorAll('.save-opt-btn').forEach(btn => {
        btn.onclick = (e) => {
            const group = e.target.dataset.group;
            savePopup.querySelectorAll(`.save-opt-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        };
    });
    
    // Path Selection
    let selectedPath = null;
    savePopup.querySelector('#btn-select-path').onclick = async () => {
        const path = await ipcRenderer.invoke('annotate-select-path');
        if (path) {
            selectedPath = path;
            savePopup.querySelector('#save-path-input').value = path;
        }
    };
    
    // Cancel
    savePopup.querySelector('#btn-cancel-save').onclick = () => {
        savePopup.remove();
    };
    
    // Confirm
    savePopup.querySelector('#btn-confirm-save').onclick = () => {
        const scope = savePopup.querySelector('.save-opt-btn[data-group="scope"].active').dataset.value;
        const format = savePopup.querySelector('.save-opt-btn[data-group="format"].active').dataset.value;
        const area = savePopup.querySelector('.save-opt-btn[data-group="area"].active').dataset.value;
        
        // Generate content
        let dataUrl;
        if (scope === 'single') {
            // For now only support single page image
            // Temporarily hide UI elements that shouldn't be captured?
            // Since we capture canvas, UI (HTML) is not included unless we use electron capture.
            // If user wants "Screenshot", we need electron capture.
            // If user wants "Whiteboard Content", canvas.toDataURL is fine.
            // Assuming "Whiteboard Content" for now.
            dataUrl = canvasModule.canvas.toDataURL('image/png');
        } else {
            // TODO: Multi-page support
             dataUrl = canvasModule.canvas.toDataURL('image/png');
        }

        savePopup.remove();
        
        ipcRenderer.send('annotate-save-file', { 
            scope, 
            format, 
            area, 
            path: selectedPath,
            dataUrl: dataUrl,
            type: format,
            name: `annotate-${Date.now()}.${format === 'pdf' ? 'pdf' : 'png'}`
        });
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
         const btn = document.querySelector(`.tool-btn[data-id="save"]`);
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
}