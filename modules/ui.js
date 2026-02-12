const { ipcRenderer } = require('electron');
const state = require('./state');
const canvasModule = require('./canvas');
const objects = require('./objects');
const selection = require('./selection');

// DOM Elements
const toolbar = document.getElementById('main-toolbar');
const toolSettingsPopup = document.getElementById('tool-settings-popup');
const penSettings = document.getElementById('pen-settings');
const panSettings = document.getElementById('pan-settings');
const shapeSettings = document.getElementById('shape-settings');
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
    { id: 'select', icon: 'ri-cursor-fill', label: '套索选' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' },
    { id: 'clear', icon: 'ri-delete-bin-line', label: '清页' },
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
  ]
};

function renderToolbar(handleToolClickCallback) {
  toolbar.innerHTML = '';
  let toolSet = state.MODE === 'annotate' ? TOOLS.annotate : TOOLS.whiteboard;

  toolSet.forEach(tool => {
    const btn = document.createElement('button');
    btn.className = `tool-btn ${state.currentTool === tool.id ? 'active' : ''}`;
    btn.dataset.id = tool.id; // Add data-id for positioning
    btn.innerHTML = `<i class="${tool.icon}"></i><span>${tool.label}</span>`;
    
    btn.onclick = (e) => handleToolClickCallback(tool.id);
    
    toolbar.appendChild(btn);
  });
  
  // Show/Hide Pan Overlay
  if (state.currentTool === 'pan') {
      panOverlay.style.display = 'flex';
      updateMinimap();
  } else {
      panOverlay.style.display = 'none';
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
            // Simple shape preview
            ctx.strokeStyle = s.color;
            ctx.lineWidth = Math.max(s.size, 2 / scale);
            const w = s.end.x - s.start.x;
            const h = s.end.y - s.start.y;
            ctx.strokeRect(s.start.x, s.start.y, w, h);
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
        // We can set display block first (visibility hidden) to get width?
        toolSettingsPopup.style.visibility = 'hidden';
        toolSettingsPopup.style.display = 'block';
        const actualWidth = toolSettingsPopup.offsetWidth;
        toolSettingsPopup.style.visibility = 'visible';
        
        const left = rect.left + rect.width / 2 - actualWidth / 2;
        toolSettingsPopup.style.left = `${left}px`;
        toolSettingsPopup.style.transform = 'none'; // Remove translateX(-50%)
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
  document.querySelectorAll('.shape-btn').forEach(btn => {
    if (btn.dataset.shape === state.currentShape) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  const pinBtn = document.getElementById('btn-shape-pin');
  if (pinBtn) {
      pinBtn.style.color = state.isShapePinned ? '#1890ff' : 'var(--fg)';
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
                    <div class="color-swatch bg-swatch" data-color="#071a12" style="background: #071a12; border: 1px solid rgba(255,255,255,0.2);" title="默认"></div>
                    <div class="color-swatch bg-swatch" data-color="#000000" style="background: #000000; border: 1px solid rgba(255,255,255,0.2);" title="黑色"></div>
                    <div class="color-swatch bg-swatch" data-color="#ffffff" style="background: #ffffff; border: 1px solid #ccc;" title="白色"></div>
                    <div class="color-swatch bg-swatch" data-color="#f5f5dc" style="background: #f5f5dc; border: 1px solid #ccc;" title="米色"></div>
                    <div class="color-swatch bg-swatch-custom" style="position: relative; overflow: hidden; background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);" title="自定义">
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
        };
        controls.querySelector('#btn-close-preview-internal').onclick = () => {
             document.getElementById('page-preview-popup').style.display = 'none';
        };
    }

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
  adjustPopup.style.top = `${rect.bottom + 10}px`;
  adjustPopup.style.transform = 'none';
  adjustPopup.style.bottom = 'auto';
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
      };
      document.getElementById('btn-pan-fit').onclick = () => {
          canvasModule.fitCameraToContent();
      };
  }

  // Shape Settings
  if (shapeSettings) {
      document.querySelectorAll('.shape-btn').forEach(btn => {
          btn.onclick = (e) => {
              state.currentShape = btn.dataset.shape;
              updateShapeSelection();
              if (!state.isShapePinned) {
                  toolSettingsPopup.style.display = 'none';
                  state.isMenuOpen = false;
              }
          };
      });
      
      const pinBtn = document.getElementById('btn-shape-pin');
      if (pinBtn) {
          pinBtn.onclick = () => {
              state.isShapePinned = !state.isShapePinned;
              updateShapeSelection();
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
  document.getElementById('btn-sel-adjust').onclick = openAdjustPopup;

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

module.exports = {
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
    pageControls,
    leftControls,
    toolSettingsPopup,
    insertMenuPopup,
    adjustPopup
};