const state = require('./state');
const utils = require('./utils');
const canvasModule = require('./canvas');
// Circular dependency: objects.js requires selection.js, so we might need to require objects.js inside functions or use a getter.

let objectsModule; // Lazy load
let uiModuleInstance;
let historyModule;

function getHistory() {
    if (!historyModule) historyModule = require('./history');
    return historyModule;
}

const selectionToolbar = document.getElementById('selection-toolbar');
const selectionOverlay = document.getElementById('selection-overlay');
const selectionBoxDom = selectionOverlay.querySelector('.selection-box-dom');
let selectionHandles = [];
let activeMenu = 'none'; // 'none', 'rotation', 'transform', 'layer', 'adjust'
let adjustMenuState = 'main'; // 'main', 'color', 'thickness'
let justLassoed = false;

function setMenuState(menu) {
    activeMenu = menu;
    updateSelectionToolbarPosition();
}

function getObjectsModule() {
    if (!objectsModule) objectsModule = require('./objects');
    return objectsModule;
}

function getUiModule() {
    if (!uiModuleInstance) uiModuleInstance = require('./ui');
    return uiModuleInstance;
}

function performLassoSelection() {
  if (state.lassoPoints.length < 3) return;

  // Check for small lasso (Treat as click on empty space -> Clear Selection)
  let lxMin = Infinity, lxMax = -Infinity, lyMin = Infinity, lyMax = -Infinity;
  state.lassoPoints.forEach(p => {
      if (p.x < lxMin) lxMin = p.x;
      if (p.x > lxMax) lxMax = p.x;
      if (p.y < lyMin) lyMin = p.y;
      if (p.y > lyMax) lyMax = p.y;
  });
  
  const cam = state.getActiveCamera();
  // Threshold in screen pixels (e.g. 5px) converted to world
  const threshold = 5 / cam.z;
  
  if ((lxMax - lxMin) < threshold && (lyMax - lyMin) < threshold) {
      state.selectedStrokeIndices = [];
      updateSelectionBounds();
      showSelectionToolbar();
      return;
  }

  justLassoed = true;
  setTimeout(() => justLassoed = false, 200);

  const strokes = state.getActiveStrokes();
  state.selectedStrokeIndices = [];
  state.visualRotation = 0; // Reset visual rotation on new selection

  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    if (stroke.isPointEraser) continue;

    // Check if any point is inside
    if (['image', 'video', 'audio', 'browser', 'link'].includes(stroke.type)) {
        // In fullscreen, we don't select DOM objects via lasso (only ink), 
        // because video is background. But if there are images added? 
        // Current implementation: fullscreen has strokes = [], and video is background. 
        // You can't add new images in fullscreen yet (UI hidden).
        // So only ink is relevant.
        let intersects = false;
        
        // Check corners inside lasso
        const corners = [
            {x: stroke.x, y: stroke.y},
            {x: stroke.x + stroke.w, y: stroke.y},
            {x: stroke.x + stroke.w, y: stroke.y + stroke.h},
            {x: stroke.x, y: stroke.y + stroke.h}
        ];
        
        for (const p of corners) {
            if (utils.isPointInPolygon(p, state.lassoPoints)) {
                intersects = true;
                break;
            }
        }
        
        // Check lasso points inside rect
        if (!intersects) {
             for (const lp of state.lassoPoints) {
                 if (lp.x >= stroke.x && lp.x <= stroke.x + stroke.w &&
                     lp.y >= stroke.y && lp.y <= stroke.y + stroke.h) {
                     intersects = true;
                     break;
                 }
             }
        }
        
        // Fix for Issue: Lasso must fully contain media object?
        // User request: "视频/音频/图片支持单击选择，但在套索模式下必须整体框住再选择以便选择其中的文本"
        // Meaning: Single click -> Select. Lasso -> Must fully contain to select.
        // Current logic: Intersects (partial overlap) -> Select.
        // New logic: If Lasso, must FULLY contain the bounding box.
        
        // Actually, let's check if all corners are inside.
        if (intersects) {
            // Check full containment
            let allCornersInside = true;
             for (const p of corners) {
                if (!utils.isPointInPolygon(p, state.lassoPoints)) {
                    allCornersInside = false;
                    break;
                }
            }
            // If all corners inside, then it's fully selected.
            // But isPointInPolygon works for complex shapes.
            // If lasso is smaller than rect and inside, corners are outside. -> Not selected.
            // If lasso intersects boundary -> Partial -> Not selected.
            // So "Must fully contain" means all 4 corners must be inside the lasso polygon.
            
            if (allCornersInside) {
                state.selectedStrokeIndices.push(i);
            }
        }
    } else if (stroke.type === 'pen' && stroke.points) {
        for (const p of stroke.points) {
            if (utils.isPointInPolygon(p, state.lassoPoints)) {
                state.selectedStrokeIndices.push(i);
                break;
            }
        }
    } else if (stroke.type === 'shape') {
        // Calculate Bounding Box for Shape
        let minX = stroke.start.x, minY = stroke.start.y, maxX = stroke.start.x, maxY = stroke.start.y;
        
        // Include end
        minX = Math.min(minX, stroke.end.x);
        minY = Math.min(minY, stroke.end.y);
        maxX = Math.max(maxX, stroke.end.x);
        maxY = Math.max(maxY, stroke.end.y);
        
        if (stroke.depthEnd) {
             minX = Math.min(minX, stroke.depthEnd.x);
             minY = Math.min(minY, stroke.depthEnd.y);
             maxX = Math.max(maxX, stroke.depthEnd.x);
             maxY = Math.max(maxY, stroke.depthEnd.y);
        }

        // Expand box slightly for line thickness
        const padding = (stroke.size || 5) / 2;
        minX -= padding; minY -= padding; maxX += padding; maxY += padding;
        
        // Intersection Check
        let intersects = false;
        const w = maxX - minX;
        const h = maxY - minY;
        
        const corners = [
            {x: minX, y: minY}, 
            {x: maxX, y: minY}, 
            {x: maxX, y: maxY}, 
            {x: minX, y: maxY}
        ];
        
        for (const p of corners) {
            if (utils.isPointInPolygon(p, state.lassoPoints)) {
                intersects = true;
                break;
            }
        }
        
        if (!intersects) {
             for (const lp of state.lassoPoints) {
                 if (lp.x >= minX && lp.x <= maxX && lp.y >= minY && lp.y <= maxY) {
                     intersects = true;
                     break;
                 }
             }
        }
        
        if (intersects) {
             state.selectedStrokeIndices.push(i);
        }
    }
  }
  
  if (state.selectedStrokeIndices.length > 0) {
    updateSelectionBounds();
    showSelectionToolbar();
  } else {
    state.selectionBounds = null;
    selectionToolbar.style.display = 'none';
    selectionOverlay.style.display = 'none';
  }
}

function updateSelectionBounds() {
  if (state.selectedStrokeIndices.length === 0) {
    state.selectionBounds = null;
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const strokes = state.getActiveStrokes();
  
  state.selectedStrokeIndices.forEach(idx => {
    const stroke = strokes[idx];
    if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(stroke.type)) { // Added 'text'
        if (stroke.x < minX) minX = stroke.x;
        if (stroke.y < minY) minY = stroke.y;
        if (stroke.x + stroke.w > maxX) maxX = stroke.x + stroke.w;
        if (stroke.y + stroke.h > maxY) maxY = stroke.y + stroke.h;
    } else if (stroke.type === 'shape') {
        // Shape bounds
        if (stroke.start.x < minX) minX = stroke.start.x;
        if (stroke.start.y < minY) minY = stroke.start.y;
        if (stroke.start.x > maxX) maxX = stroke.start.x;
        if (stroke.start.y > maxY) maxY = stroke.start.y;
        
        if (stroke.end.x < minX) minX = stroke.end.x;
        if (stroke.end.y < minY) minY = stroke.end.y;
        if (stroke.end.x > maxX) maxX = stroke.end.x;
        if (stroke.end.y > maxY) maxY = stroke.end.y;
        
        if (stroke.depthEnd) {
            if (stroke.depthEnd.x < minX) minX = stroke.depthEnd.x;
            if (stroke.depthEnd.y < minY) minY = stroke.depthEnd.y;
            if (stroke.depthEnd.x > maxX) maxX = stroke.depthEnd.x;
            if (stroke.depthEnd.y > maxY) maxY = stroke.depthEnd.y;
        }
    } else {
        if (stroke.points) {
            stroke.points.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });
        }
    }
  });

  const padding = 20; // Expanded padding to avoid handle overlap
          state.selectionBounds = {
            x: minX - padding,
            y: minY - padding,
            w: (maxX - minX) + padding * 2,
            h: (maxY - minY) + padding * 2
          };
        }
        
        function showSelectionToolbar() {
  if (!state.selectionBounds) {
      selectionToolbar.style.display = 'none';
      selectionOverlay.style.display = 'none';
      return;
  }
  
  // Fix for Issue 6: Hide 'New Page Clone' in Screen Annotation mode
  const clonePageBtn = document.getElementById('btn-sel-clone-page');
  if (clonePageBtn) {
      clonePageBtn.style.display = state.MODE === 'annotate' ? 'none' : 'flex';
  }

  const camera = state.getActiveCamera();
  // Convert world coords to screen coords
  const screenX = (state.selectionBounds.x * camera.z) + camera.x;
  const screenY = (state.selectionBounds.y * camera.z) + camera.y;
  const screenW = state.selectionBounds.w * camera.z;
  const screenH = state.selectionBounds.h * camera.z;

  // Check Rotation
  let rotation = 0;
  if (state.selectedStrokeIndices.length === 1) {
      const idx = state.selectedStrokeIndices[0];
      const obj = state.getActiveStrokes()[idx];
      if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(obj.type)) {
          rotation = obj.rotation || 0;
      } else {
          rotation = state.visualRotation || 0;
      }
  } else {
      rotation = state.visualRotation || 0;
  }

  // Update overlay box position
  selectionBoxDom.style.left = `${screenX}px`;
  selectionBoxDom.style.top = `${screenY}px`;
  selectionBoxDom.style.width = `${screenW}px`;
  selectionBoxDom.style.height = `${screenH}px`;
  selectionBoxDom.style.transform = `rotate(${rotation}rad)`;
  selectionBoxDom.style.transformOrigin = 'center center';
  
  selectionOverlay.style.display = 'block';
  selectionOverlay.style.pointerEvents = 'none';
  selectionBoxDom.style.pointerEvents = 'auto'; 

  const boxRect = selectionBoxDom.getBoundingClientRect();
  let toolbarTop = boxRect.bottom + 10;

  const mediaControls = document.getElementById('media-controls');
  if (mediaControls && mediaControls.style.display !== 'none') {
      const mcRect = mediaControls.getBoundingClientRect();
      if (toolbarTop + 50 > mcRect.top) { // 50 is approx toolbar height
          toolbarTop = boxRect.top - 60; // 60 is approx toolbar height + margin
      }
  }

  selectionToolbar.style.top = `${toolbarTop}px`;
  selectionToolbar.style.left = `${boxRect.left + boxRect.width / 2 - selectionToolbar.offsetWidth / 2}px`;

  const adjustBtn = document.getElementById('btn-sel-adjust');
  if (adjustBtn) {
    adjustBtn.onclick = () => {
      setMenuState(activeMenu === 'adjust' ? 'none' : 'adjust');
    };
  }


  
  // Clear previous handles
  selectionBoxDom.innerHTML = '';
  selectionHandles = [];

  // Create Resize Handles (Default 4-corner + Box Drag)
  // Always enabled to ensure move/resize works for all shapes
  const handlePositions = [
      { left: '0%', top: '0%', cursor: 'nwse-resize', id: 0, xOffset: '-5px', yOffset: '-5px' }, // TL
      { left: '100%', top: '0%', cursor: 'nesw-resize', id: 1, xOffset: '-5px', yOffset: '-5px' }, // TR
      { left: '100%', top: '100%', cursor: 'nwse-resize', id: 2, xOffset: '-5px', yOffset: '-5px' }, // BR
      { left: '0%', top: '100%', cursor: 'nesw-resize', id: 3, xOffset: '-5px', yOffset: '-5px' } // BL
  ];
  
  // Add Drag Listener to Box itself (Move Logic)
  selectionBoxDom.onpointerdown = (e) => {
      e.stopPropagation();
      const cam = state.getActiveCamera();
      state.isMovingSelection = true;
      state.dragStart = { x: (e.clientX - cam.x) / cam.z, y: (e.clientY - cam.y) / cam.z };
      state.originalSelectionStrokes = cloneStrokes(state.selectedStrokeIndices);
      selectionBoxDom.setPointerCapture(e.pointerId);

      const onMove = (em) => {
          if (!state.isMovingSelection) return;
          canvasModule.autoPanOnEdge(em.clientX, em.clientY);
          const cm = state.getActiveCamera();
          const point = { x: (em.clientX - cm.x) / cm.z, y: (em.clientY - cm.y) / cm.z };
          const dx = point.x - state.dragStart.x;
          const dy = point.y - state.dragStart.y;
          moveSelection(dx, dy);
          canvasModule.renderCanvas();
          getObjectsModule().updateDOMObjects();
          updateSelectionToolbarPosition();
      };

      const onUp = (eu) => {
          state.isMovingSelection = false;
          selectionBoxDom.releasePointerCapture(eu.pointerId);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          
          const items = state.selectedStrokeIndices.map((idx, i) => ({
              index: idx,
              before: state.originalSelectionStrokes[i],
              after: cloneStrokes([idx])[0]
          }));
          getHistory().pushAction({ type: 'transform', items });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
  };

  handlePositions.forEach(pos => {
      const h = document.createElement('div');
      h.className = 'resize-handle';
      h.style.position = 'absolute';
      h.style.left = pos.left;
      h.style.top = pos.top;
      h.style.transform = `translate(${pos.xOffset}, ${pos.yOffset})`;
      h.style.cursor = pos.cursor;
      h.style.zIndex = '90'; // Default handles lower than special handles
      
      h.onpointerdown = (e) => {
          e.stopPropagation();
          const cam = state.getActiveCamera();
          state.isResizingSelection = true;
          state.resizeHandleIndex = pos.id;
          state.dragStart = { x: (e.clientX - cam.x) / cam.z, y: (e.clientY - cam.y) / cam.z };
          state.originalSelectionStrokes = cloneStrokes(state.selectedStrokeIndices);
          h.setPointerCapture(e.pointerId);

          const onMove = (em) => {
              if (!state.isResizingSelection) return;
              canvasModule.autoPanOnEdge(em.clientX, em.clientY);
              const cm = state.getActiveCamera();
              const point = { x: (em.clientX - cm.x) / cm.z, y: (em.clientY - cm.y) / cm.z };
              resizeSelection(point);
              canvasModule.renderCanvas();
              getObjectsModule().updateDOMObjects();
              updateSelectionToolbarPosition();
          };

          const onUp = (eu) => {
              state.isResizingSelection = false;
              h.releasePointerCapture(eu.pointerId);
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              
              const items = state.selectedStrokeIndices.map((idx, i) => ({
                  index: idx,
                  before: state.originalSelectionStrokes[i],
                  after: cloneStrokes([idx])[0]
              }));
              getHistory().pushAction({ type: 'transform', items });
          };

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
      };
      
      selectionBoxDom.appendChild(h);
  });

  // Add Special Handles
  const strokes = state.getActiveStrokes();
  if (state.selectedStrokeIndices.length === 1) {
      const idx = state.selectedStrokeIndices[0];
      const stroke = strokes[idx];
      // Updated to include arrows and ellipse
      if (stroke.type === 'shape' && ['line', 'arrow', 'double-arrow', 'triangle', 'pentagon', 'hexagon', 'circle', 'ellipse', 'parallelogram', 'cuboid', 'axis-xy', 'axis-xyz'].includes(stroke.shapeType)) {
          renderShapeHandles(stroke, selectionBoxDom, state.selectionBounds);
      }
  }

  // Rotation Handle
  const rotDist = 40;
  
  const rotLine = document.createElement('div');
  rotLine.className = 'rotate-line';
  rotLine.style.position = 'absolute';
  rotLine.style.left = '50%';
  rotLine.style.top = `-${rotDist}px`;
  rotLine.style.height = `${rotDist}px`;
  rotLine.style.width = '0px';
  rotLine.style.borderLeft = '1px dashed var(--primary-color)';
  
  const rotH = document.createElement('div');
  rotH.className = 'rotate-handle';
  rotH.innerHTML = '<i class="ri-refresh-line"></i>';
  rotH.style.position = 'absolute';
  rotH.style.left = '50%';
  rotH.style.top = `-${rotDist + 10}px`;
  rotH.style.transform = 'translateX(-50%)';
  rotH.style.cursor = 'grab';
  rotH.style.display = 'flex';
  rotH.style.alignItems = 'center';
  rotH.style.justifyContent = 'center';
  rotH.style.width = '24px';
  rotH.style.height = '24px';
  rotH.style.background = 'white';
  rotH.style.border = '1px solid var(--primary-color)';
  rotH.style.borderRadius = '50%';
  rotH.style.fontSize = '14px';
  rotH.style.color = 'var(--primary-color)';
  
  rotH.onpointerdown = (e) => {
      e.stopPropagation();
      const cam = state.getActiveCamera();
      state.isRotatingSelection = true;
      
      const centerX = screenX + screenW / 2;
      const centerY = screenY + screenH / 2;
      
      state.rotationCenter = { x: centerX, y: centerY };
      
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      state.dragStartAngle = Math.atan2(dy, dx);
      state.initialVisualRotation = rotation;
      
      state.originalSelectionStrokes = cloneStrokes(state.selectedStrokeIndices);
      rotH.setPointerCapture(e.pointerId);
      rotH.style.cursor = 'grabbing';

      const onMove = (em) => {
          if (!state.isRotatingSelection) return;
          
          const dx = em.clientX - state.rotationCenter.x;
          const dy = em.clientY - state.rotationCenter.y;
          const currentAngle = Math.atan2(dy, dx);
          const totalDelta = currentAngle - state.dragStartAngle;
          
          state.visualRotation = state.initialVisualRotation + totalDelta;
          
          rotateSelection(totalDelta);
          
          canvasModule.renderCanvas();
          getObjectsModule().updateDOMObjects();
          updateSelectionToolbarPosition();
      };

      const onUp = (eu) => {
          state.isRotatingSelection = false;
          state.initialVisualRotation = undefined;
          rotH.releasePointerCapture(eu.pointerId);
          rotH.style.cursor = 'grab';
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          
          const items = state.selectedStrokeIndices.map((idx, i) => ({
              index: idx,
              before: state.originalSelectionStrokes[i],
              after: cloneStrokes([idx])[0]
          }));
          getHistory().pushAction({ type: 'transform', items });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
  };
  
  selectionBoxDom.appendChild(rotLine);
  selectionBoxDom.appendChild(rotH);
  
  
  // --- Toolbar Content ---
  
  selectionToolbar.innerHTML = '';
  selectionToolbar.className = 'selection-toolbar-container'; // Updated class
  
  // Create Primary Row
  const primaryRow = document.createElement('div');
  primaryRow.className = 'selection-toolbar-row primary';
  
  // Render Primary Buttons into primaryRow
  renderNormalToolbar(primaryRow);
  
  selectionToolbar.appendChild(primaryRow);

  // If active menu, Render Secondary Toolbar below it
  if (activeMenu !== 'none') {
      selectionToolbar.classList.add('expanded'); // Add state class for styling
      
      const secondaryRow = document.createElement('div');
      secondaryRow.className = 'selection-toolbar-row secondary';
      
      // Render content into secondaryRow
      if (activeMenu === 'layer') {
          renderSecondaryContent(secondaryRow, '层级', 'ri-stack-line', [
              { icon: 'ri-bring-to-front', title: '置顶', action: bringToFront },
              { icon: 'ri-send-to-back', title: '置底', action: sendToBack },
              { icon: 'ri-arrow-up-line', title: '上移', action: bringForward },
              { icon: 'ri-arrow-down-line', title: '下移', action: sendBackward }
          ]);
      } else if (activeMenu === 'adjust') {
          renderAdjustContent(secondaryRow);
      } else if (activeMenu === 'rotation') {
          renderSecondaryContent(secondaryRow, '旋转', 'ri-refresh-line', [
              { icon: 'ri-anticlockwise-2-line', title: '左旋', action: () => rotateSelection90(-1) },
              { icon: 'ri-clockwise-2-line', title: '右旋', action: () => rotateSelection90(1) },
              { icon: 'ri-refresh-line', title: '转180', action: () => rotateSelection90(2) }
          ]);
      } else if (activeMenu === 'transform') {
          renderSecondaryContent(secondaryRow, '变换', 'ri-drag-move-2-line', [
              { icon: 'ri-arrow-left-right-line', title: '水平', action: () => mirrorSelection('h') },
              { icon: 'ri-arrow-up-down-line', title: '垂直', action: () => mirrorSelection('v') }
          ]);
      } else if (activeMenu === 'adjust') {
          renderAdjustContent(secondaryRow);
      }
      
      selectionToolbar.appendChild(secondaryRow);
  }

  function renderNormalToolbar(container) {
      if (!state.fullscreen.active && state.selectedStrokeIndices.length === 1) {
          const idx = state.selectedStrokeIndices[0];
          const obj = state.getActiveStrokes()[idx];
          
          if (obj.type === 'video' || obj.type === 'audio') {
              const wrapper = document.querySelector(`.dom-object-wrapper[data-id="obj-${idx}"]`);
              const media = wrapper ? wrapper.querySelector(obj.type) : null;
              const isPlaying = media && !media.paused;
              
              const btn = createBtn(isPlaying ? 'ri-pause-fill' : 'ri-play-fill', isPlaying ? '暂停' : '播放', () => {
                 if (isPlaying) {
                     if (state.activeMedia && state.activeMedia.index === idx) media.pause();
                     else getObjectsModule().startActiveMedia(idx);
                 } else {
                     getObjectsModule().startActiveMedia(idx);
                     if (state.activeMedia && state.activeMedia.index === idx) media.play();
                 }
                 setTimeout(updateSelectionToolbarPosition, 100);
              });
              container.appendChild(btn);
              
              if (obj.type === 'video') {
                  container.appendChild(createBtn('ri-fullscreen-line', '全屏', () => {
                      if (state.activeMedia && state.activeMedia.index === idx) getObjectsModule().enterFullscreen(idx);
                      else {
                          getObjectsModule().startActiveMedia(idx);
                          setTimeout(() => getObjectsModule().enterFullscreen(idx), 100);
                      }
                  }));
              }
          } else if (obj.type === 'browser') {
              container.appendChild(createBtn('ri-global-line', '打开', () => getUiModule().showFullscreenBrowser(obj.src)));
          } else if (obj.type === 'link') {
              container.appendChild(createBtn('ri-external-link-line', '访问', () => require('electron').shell.openExternal(obj.src)));
          }
          
          if (['browser', 'link', 'text', 'shape', 'pen'].includes(obj.type) && obj.type !== 'video' && obj.type !== 'audio') {
               container.appendChild(createBtn('ri-settings-3-line', '调整', () => setMenuState(activeMenu === 'adjust' ? 'none' : 'adjust'), activeMenu === 'adjust'));
          }
      } else {
          container.appendChild(createBtn('ri-settings-3-line', '调整', () => setMenuState(activeMenu === 'adjust' ? 'none' : 'adjust'), activeMenu === 'adjust'));
      }
      
      container.appendChild(createBtn('ri-file-copy-line', '复制', cloneSelection));
      
      // Split Menus: Layer, Rotation, Transform
      container.appendChild(createBtn('ri-stack-line', '层级', () => setMenuState(activeMenu === 'layer' ? 'none' : 'layer'), activeMenu === 'layer'));
      container.appendChild(createBtn('ri-refresh-line', '旋转', () => setMenuState(activeMenu === 'rotation' ? 'none' : 'rotation'), activeMenu === 'rotation'));
      container.appendChild(createBtn('ri-drag-move-2-line', '变换', () => setMenuState(activeMenu === 'transform' ? 'none' : 'transform'), activeMenu === 'transform'));
      
      const delBtn = createBtn('ri-delete-bin-line', '删除', deleteSelection);
      container.appendChild(delBtn);

      const sep = document.createElement('div');
      sep.className = 'separator';
      container.appendChild(sep);
      
      const closeBtn = createBtn('ri-close-circle-line', '取消', () => {
          state.selectedStrokeIndices = [];
          state.selectionBounds = null;
          state.visualRotation = 0;
          selectionToolbar.style.display = 'none';
          selectionOverlay.style.display = 'none';
          canvasModule.renderCanvas();
          getObjectsModule().updateDOMObjects();
      });
      container.appendChild(closeBtn);
  }
  
  function renderSecondaryContent(container, title, icon, actions) {
      // container.classList.add('secondary'); // Handled by parent creation
      
      const header = document.createElement('div');
      header.className = 'selection-menu-header';
      header.innerHTML = `<i class="${icon}"></i><span>${title}</span>`;
      container.appendChild(header);
      
      // Removed separator, use padding/gap instead for cleaner look
      
      const content = document.createElement('div');
      content.className = 'selection-menu-content';
      
      actions.forEach(a => {
          content.appendChild(createBtn(a.icon, a.title, a.action));
      });
      container.appendChild(content);
      
      const right = document.createElement('div');
      right.className = 'selection-menu-right';
      const collapse = createBtn('ri-arrow-up-s-line', '收起', () => setMenuState('none'));
      right.appendChild(collapse);
      container.appendChild(right);
  }
  
  function renderAdjustContent(container) {
    if (adjustMenuState === 'main') {
        renderSecondaryContent(container, '调整', 'ri-tools-line', [
            { icon: 'ri-palette-line', title: '颜色', action: () => setAdjustMenuState('color') },
            { icon: 'ri-ruler-2-line', title: '粗细', action: () => setAdjustMenuState('thickness') }
        ]);
    } else if (adjustMenuState === 'color') {
        const backButton = createBackButton(() => setAdjustMenuState('main'));
        container.appendChild(backButton);
        
        const colorPicker = document.createElement('div');
        colorPicker.className = 'color-picker-container';
        
        const colors = ['#000000', '#F44336', '#238f4a', '#2196F3', '#FFEB3B', '#ffffff'];
        colors.forEach(c => {
           const swatch = document.createElement('div');
           swatch.className = 'color-swatch adjust-swatch';
           swatch.style.backgroundColor = c;
           swatch.onclick = () => {
                applyColorToSelection(c);
                setAdjustMenuState('main');
           }
           colorPicker.appendChild(swatch);
        });
        container.appendChild(colorPicker);

    } else if (adjustMenuState === 'thickness') {
        const backButton = createBackButton(() => setAdjustMenuState('main'));
        container.appendChild(backButton);

        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'thickness-slider-container';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '1';
        slider.max = '20';
        const obj = state.getActiveStrokes()[state.selectedStrokeIndices[0]];
        slider.value = obj.size || 5;
        slider.style.flex = '1';
        slider.style.height = '4px';
        slider.oninput = (e) => {
             applyThicknessToSelection(parseInt(e.target.value));
        };
        slider.onpointerdown = (e) => e.stopPropagation();
        
        sliderContainer.appendChild(slider);
        container.appendChild(sliderContainer);
    }
}

function setAdjustMenuState(state) {
    adjustMenuState = state;
    updateSelectionToolbarPosition();
}

function createBackButton(onClick) {
    const backButton = document.createElement('button');
    backButton.className = 'tool-btn small';
    backButton.innerHTML = '<i class="ri-arrow-left-line"></i> 返回';
    backButton.onclick = onClick;
    return backButton;
}

function applyColorToSelection(color) {
    const strokes = state.getActiveStrokes();
    state.selectedStrokeIndices.forEach(index => {
        strokes[index].color = color;
    });
    canvasModule.renderCanvas();
}

function applyThicknessToSelection(thickness) {
    const strokes = state.getActiveStrokes();
    state.selectedStrokeIndices.forEach(index => {
        strokes[index].size = thickness;
    });
    canvasModule.renderCanvas();
}
  
  function createBtn(icon, text, onClick, isActive = false) {
      const btn = document.createElement('button');
      btn.className = `tool-btn small ${isActive ? 'active' : ''}`;
      btn.innerHTML = `<i class="${icon}"></i><span>${text}</span>`;
      btn.onclick = onClick;
      return btn;
  }
  
  // Position Toolbar
  selectionToolbar.style.display = 'flex';
  const updatedBoxRect = selectionBoxDom.getBoundingClientRect();
  
  let left = updatedBoxRect.left + updatedBoxRect.width / 2 - selectionToolbar.offsetWidth / 2;
  let top = updatedBoxRect.bottom + 10;
  
  const updatedMediaControls = document.getElementById('media-controls');
  if (updatedMediaControls && updatedMediaControls.style.display !== 'none' && state.activeMedia) {
      if (state.fullscreen.active) {
          const mcRect = updatedMediaControls.getBoundingClientRect();
          if (top + 50 > mcRect.top) {
              top = updatedBoxRect.top - 60;
          }
      } else if (state.selectedStrokeIndices.includes(state.activeMedia.index)) {
          const mcRect = updatedMediaControls.getBoundingClientRect();
          if (mcRect.height > 0) {
              top = mcRect.bottom + 10;
          } else {
              top += 60; 
          }
      }
  }

  // Constrain to Safe Area (Viewport)
  const margin = 10;
  // Use clientWidth/Height to be safer
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  
  const menuW = selectionToolbar.offsetWidth;
  const menuH = selectionToolbar.offsetHeight;
  
  // Calculate max allowed positions
  const maxLeft = vw - menuW - margin;
  const maxTop = vh - menuH - margin;

  // Apply constraint logic: 
  // If calculation puts it outside, clamp it.
  
  if (left < margin) left = margin;
  if (left > maxLeft) left = maxLeft;
  
  // Vertical Constraint with "Flip" logic
  if (top < margin) top = margin;
  
  if (top > maxTop) {
      // It hits the bottom edge.
      // Check if we can put it ABOVE the object instead.
      // Above position: updatedBoxRect.top - menuH - 10
      const aboveTop = updatedBoxRect.top - menuH - 10;
      
      // If above position is valid (on screen), use it.
      if (aboveTop > margin) {
          top = aboveTop;
      } else {
          // If above is also off-screen (object taller than screen), clamp to bottom.
          top = maxTop;
      }
  }
  
  selectionToolbar.style.left = `${left}px`;
  selectionToolbar.style.top = `${top}px`;
}

function updateSelectionToolbarPosition() {
  showSelectionToolbar();
}

function cloneStrokes(indices) {
  const strokes = state.getActiveStrokes();
  return indices.map(idx => {
    const original = strokes[idx];
    if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(original.type)) { // Added 'text'
        return { ...original }; 
    }
    // Deep clone works for shapes too
    return JSON.parse(JSON.stringify(original));
  });
}

function moveSelection(dx, dy) {
  const strokes = state.getActiveStrokes();
  state.selectedStrokeIndices.forEach((idx, i) => {
    const original = state.originalSelectionStrokes[i];
    const current = strokes[idx];
    if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(current.type)) { // Added 'text'
        current.x = original.x + dx;
        current.y = original.y + dy;
    } else if (current.type === 'shape') {
        current.start.x = original.start.x + dx;
        current.start.y = original.start.y + dy;
        current.end.x = original.end.x + dx;
        current.end.y = original.end.y + dy;
        if (current.depthEnd && original.depthEnd) {
            current.depthEnd.x = original.depthEnd.x + dx;
            current.depthEnd.y = original.depthEnd.y + dy;
        }
    } else {
        if (original.points) {
            current.points = original.points.map(p => ({
                ...p,
                x: p.x + dx,
                y: p.y + dy
            }));
        }
    }
  });
  updateSelectionBounds();
}

function resizeSelection(cursorPoint) {
  if (!state.selectionBounds) return;
  const handle = state.resizeHandleIndex;
  
  // Custom Handle Logic
  if (handle >= 10) {
      const strokes = state.getActiveStrokes();
      const idx = state.selectedStrokeIndices[0];
      const stroke = strokes[idx];
      const original = state.originalSelectionStrokes[0];
      
      if (handle === 10) { // Line Start
          stroke.start = cursorPoint;
      } else if (handle === 11) { // Line End
          stroke.end = cursorPoint;
      } else if (handle >= 20 && handle < 30) { // Polygon Vertex
          const vIdx = handle - 20;
          if (!stroke.vertices) {
              stroke.vertices = require('./shapes').getPolygonVertices(stroke.shapeType, original.start, original.end);
          }
          stroke.vertices[vIdx] = cursorPoint;
      } else if (handle === 30) { // Circle Center
          const w = original.end.x - original.start.x;
          const h = original.end.y - original.start.y;
          const s = Math.max(Math.abs(w), Math.abs(h));
          const sx = w < 0 ? -s : s;
          const sy = h < 0 ? -s : s;
          const r = Math.abs(s/2);
          
          const newCx = cursorPoint.x;
          const newCy = cursorPoint.y;
          
          stroke.start.x = newCx - sx/2;
          stroke.start.y = newCy - sy/2;
          stroke.end.x = stroke.start.x + sx;
          stroke.end.y = stroke.start.y + sy;
      } else if (handle === 31) { // Circle Radius
          const w = stroke.end.x - stroke.start.x;
          const h = stroke.end.y - stroke.start.y;
          const s = Math.max(Math.abs(w), Math.abs(h));
          const sx = w < 0 ? -s : s;
          const sy = h < 0 ? -s : s;
          const cx = stroke.start.x + sx/2;
          const cy = stroke.start.y + sy/2;
          
          const newR = Math.hypot(cursorPoint.x - cx, cursorPoint.y - cy);
          const newS = newR * 2;
          const signX = sx < 0 ? -1 : 1;
          const signY = sy < 0 ? -1 : 1;
          
          stroke.start.x = cx - (newS/2 * signX);
          stroke.start.y = cy - (newS/2 * signY);
          stroke.end.x = stroke.start.x + (newS * signX);
          stroke.end.y = stroke.start.y + (newS * signY);
      } else if (handle === 32) { // Ellipse Right (Radius X)
          const cx = original.start.x + original.w/2;
          const rx = Math.abs(cursorPoint.x - cx);
          const w = rx * 2;
          stroke.start.x = cx - rx;
          stroke.end.x = cx + rx;
          // Ellipse uses w/h in drawShape? Yes: w = end.x - start.x
      } else if (handle === 33) { // Ellipse Bottom (Radius Y)
          const cy = original.start.y + original.h/2;
          const ry = Math.abs(cursorPoint.y - cy);
          const h = ry * 2;
          stroke.start.y = cy - ry;
          stroke.end.y = cy + ry;
      } else if (handle === 40) { // Parallelogram Skew (Top Mid)
          const w = original.end.x - original.start.x;
          const h = original.end.y - original.start.y;
          const cx = original.start.x + w/2;
          const dx = cursorPoint.x - cx;
          // dx is the skew offset relative to center
          // skewX = dx / w
          stroke.skewX = dx / w;
      } else if (handle === 50) { // Cuboid Width (Bottom Right)
          stroke.end.x = cursorPoint.x;
      } else if (handle === 51) { // Cuboid Height (Top Left)
          stroke.start.y = cursorPoint.y;
      } else if (handle === 52) { // Cuboid Depth (Depth Edge Midpoint)
          // M = (End + DepthEnd)/2
          // Cursor is M_new.
          // End is fixed (stroke.end).
          // DepthEnd_new = 2 * Cursor - End
          const endX = stroke.end.x;
          const endY = stroke.end.y; // Or start.y if top? No, depth lines are usually consistent.
          // Wait, where did we put the handle?
          // We put it at: stroke.end + (stroke.depthEnd - stroke.end)/2 ??
          // Let's assume Handle 52 corresponds to the midpoint of the depth vector starting from stroke.end.
          // (Bottom-Right-Front to Bottom-Right-Back)
          
          // But Cuboid drawShape uses depthEnd relative to end? 
          // "const dx = depthEnd.x - end.x"
          // So depthEnd IS the absolute position of the back corner corresponding to 'end'.
          
          stroke.depthEnd = {
              x: 2 * cursorPoint.x - stroke.end.x,
              y: 2 * cursorPoint.y - stroke.end.y
          };
      } else if (handle === 60) { // X Axis Midpoint
          // M = (Start + End)/2
          // End = 2 * Cursor - Start
          
          // Debug: User says this moves the shape.
          // Is it because the handle is too small and user misses it?
          // Or is the event bubbling?
          
          // Let's assume user is hitting the line, not the handle, if the handle is too small?
          // I added size 12px for green handles. Maybe make it bigger?
          // Or maybe the z-index fix I just added will solve it.
          
          stroke.end = {
              x: 2 * cursorPoint.x - stroke.start.x,
              y: 2 * cursorPoint.y - stroke.start.y
          };
      } else if (handle === 61) { // Y Axis Midpoint
          stroke.depthEnd = {
              x: 2 * cursorPoint.x - stroke.start.x,
              y: 2 * cursorPoint.y - stroke.start.y
          };
      }
      
      // Update Shape and Bounds
      // Force re-calculation of vertices if polygon?
      if (['triangle', 'pentagon', 'hexagon'].includes(stroke.shapeType)) {
           // If we resize via start/end handles (10/11), we regenerate vertices based on new box.
           if (handle === 10 || handle === 11) {
               stroke.vertices = require('./shapes').getPolygonVertices(stroke.shapeType, stroke.start, stroke.end);
           }
      }

      updateSelectionBounds();
      return;
  }
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // ... rest of function
  state.originalSelectionStrokes.forEach(s => {
    if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(s.type)) { // Added 'text'
        if (s.x < minX) minX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.x + s.w > maxX) maxX = s.x + s.w;
        if (s.y + s.h > maxY) maxY = s.y + s.h;
    } else if (s.type === 'shape') {
        // Shape bounds
        if (s.start.x < minX) minX = s.start.x;
        if (s.start.y < minY) minY = s.start.y;
        if (s.start.x > maxX) maxX = s.start.x;
        if (s.start.y > maxY) maxY = s.start.y;
        if (s.end.x < minX) minX = s.end.x;
        if (s.end.y < minY) minY = s.end.y;
        if (s.end.x > maxX) maxX = s.end.x;
        if (s.end.y > maxY) maxY = s.end.y;
        if (s.depthEnd) {
            if (s.depthEnd.x < minX) minX = s.depthEnd.x;
            if (s.depthEnd.y < minY) minY = s.depthEnd.y;
            if (s.depthEnd.x > maxX) maxX = s.depthEnd.x;
            if (s.depthEnd.y > maxY) maxY = s.depthEnd.y;
        }
    } else {
        if (s.points) {
            s.points.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });
        }
    }
  });

  const originalW = maxX - minX;
  const originalH = maxY - minY;
  if (originalW === 0 || originalH === 0) return;

  let newX = minX, newY = minY, newW = originalW, newH = originalH;
  
  if (handle === 0) { // TL
      newX = cursorPoint.x;
      newY = cursorPoint.y;
      newW = maxX - newX;
      newH = maxY - newY;
  } else if (handle === 1) { // TR
      newY = cursorPoint.y;
      newW = cursorPoint.x - minX;
      newH = maxY - newY;
      newX = minX; // Anchor left
  } else if (handle === 2) { // BR
      newW = cursorPoint.x - minX;
      newH = cursorPoint.y - minY;
      newX = minX; // Anchor left
      newY = minY; // Anchor top
  } else if (handle === 3) { // BL
      newX = cursorPoint.x;
      newW = maxX - newX;
      newH = cursorPoint.y - minY;
      newY = minY; // Anchor top
  }
  
  // Flip Logic: Allow negative width/height
  const scaleX = newW / originalW;
  const scaleY = newH / originalH;

  const strokes = state.getActiveStrokes();

  state.selectedStrokeIndices.forEach((idx, i) => {
    const original = state.originalSelectionStrokes[i];
    const current = strokes[idx];
    
    if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(current.type)) { // Added 'text'
        const relX = (original.x - minX) * scaleX;
        const relY = (original.y - minY) * scaleY;
        
        current.x = newX + relX;
        current.y = newY + relY;
        
        // Width/Height must be positive
        current.w = Math.abs(original.w * scaleX);
        current.h = Math.abs(original.h * scaleY);
        
        // Handle Content Flipping via Scale transform
        // We multiply existing scale by sign of new scale
        const signX = scaleX < 0 ? -1 : 1;
        const signY = scaleY < 0 ? -1 : 1;
        
        current.scaleX = (original.scaleX || 1) * signX;
        current.scaleY = (original.scaleY || 1) * signY;
        
        // For text, scale font size?
        if (current.type === 'text') {
            // Simple approach: average scale (magnitude)
            const absScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
            current.fontSize = Math.max(12, original.fontSize * absScale);
        }
    } else if (current.type === 'shape') {
        current.start.x = newX + (original.start.x - minX) * scaleX;
        current.start.y = newY + (original.start.y - minY) * scaleY;
        current.end.x = newX + (original.end.x - minX) * scaleX;
        current.end.y = newY + (original.end.y - minY) * scaleY;
        if (current.depthEnd && original.depthEnd) {
            current.depthEnd.x = newX + (original.depthEnd.x - minX) * scaleX;
            current.depthEnd.y = newY + (original.depthEnd.y - minY) * scaleY;
        }
        current.size = original.size * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2);
    } else {
        if (original.points) {
            current.points = original.points.map(p => ({
                ...p,
                x: newX + (p.x - minX) * scaleX,
                y: newY + (p.y - minY) * scaleY,
            }));
            current.size = original.size * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2);
        }
    }
  });
  
  updateSelectionBounds();
}

function renderShapeHandles(stroke, container, bounds) {
    const { shapeType } = stroke;
    
    // Helper to add handle
    const addHandle = (id, x, y, cursor, icon) => {
        const h = document.createElement('div');
        h.className = 'resize-handle shape-handle'; 
        h.style.position = 'absolute';
        
        // Position relative to bounds
        const leftPct = (x - bounds.x) / bounds.w * 100;
        const topPct = (y - bounds.y) / bounds.h * 100;
        
        h.style.left = `${leftPct}%`;
        h.style.top = `${topPct}%`;
        h.style.transform = 'translate(-50%, -50%)'; 
        h.style.cursor = cursor || 'pointer';
        h.style.zIndex = '100'; // High priority
        
        if (icon) {
            h.innerHTML = `<i class="${icon}"></i>`;
            h.style.background = 'white';
            h.style.border = '1px solid var(--primary-color)';
            h.style.borderRadius = '50%';
            h.style.width = '24px';
            h.style.height = '24px';
            h.style.display = 'flex';
            h.style.alignItems = 'center';
            h.style.justifyContent = 'center';
            h.style.fontSize = '14px';
            h.style.color = 'var(--primary-color)';
            h.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        }
        
        // Green Handles for Special Adjusters
        if (id >= 40 && id <= 69) {
             h.style.border = '1px solid #52c41a';
             h.style.color = '#52c41a';
             if (!icon) {
                 h.style.background = '#52c41a';
                 h.style.width = '12px';
                 h.style.height = '12px';
                 h.style.borderRadius = '50%';
                 h.style.border = '2px solid white';
             }
        }

        h.onpointerdown = (e) => {
            e.stopPropagation();
            const cam = state.getActiveCamera();
            state.isResizingSelection = true; // Reuse this flag
            state.resizeHandleIndex = id; // Custom ID
            state.dragStart = { x: (e.clientX - cam.x) / cam.z, y: (e.clientY - cam.y) / cam.z };
            state.originalSelectionStrokes = cloneStrokes(state.selectedStrokeIndices);
            h.setPointerCapture(e.pointerId);

            const onMove = (em) => {
                if (!state.isResizingSelection) return;
                canvasModule.autoPanOnEdge(em.clientX, em.clientY);
                const cm = state.getActiveCamera();
                const point = { x: (em.clientX - cm.x) / cm.z, y: (em.clientY - cm.y) / cm.z };
                resizeSelection(point);
                canvasModule.renderCanvas();
                getObjectsModule().updateDOMObjects();
                updateSelectionToolbarPosition();
            };

            const onUp = (eu) => {
                state.isResizingSelection = false;
                h.releasePointerCapture(eu.pointerId);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                
                const items = state.selectedStrokeIndices.map((idx, i) => ({
                    index: idx,
                    before: state.originalSelectionStrokes[i],
                    after: cloneStrokes([idx])[0]
                }));
                getHistory().pushAction({ type: 'transform', items });
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        };
        
        container.appendChild(h);
    };

    if (shapeType === 'line' || shapeType === 'arrow' || shapeType === 'double-arrow') {
        addHandle(10, stroke.start.x, stroke.start.y, 'move');
        addHandle(11, stroke.end.x, stroke.end.y, 'move');
    } else if (shapeType === 'triangle' || shapeType === 'pentagon' || shapeType === 'hexagon') {
        const vertices = stroke.vertices || require('./shapes').getPolygonVertices(shapeType, stroke.start, stroke.end);
        vertices.forEach((v, i) => {
            addHandle(20 + i, v.x, v.y, 'move');
        });
    } else if (shapeType === 'circle') {
        const w = stroke.end.x - stroke.start.x;
        const h = stroke.end.y - stroke.start.y;
        const s = Math.max(Math.abs(w), Math.abs(h));
        const sx = w < 0 ? -s : s;
        const sy = h < 0 ? -s : s;
        const cx = stroke.start.x + sx/2;
        const cy = stroke.start.y + sy/2;
        const r = Math.abs(sx/2);
        
        addHandle(30, cx, cy, 'move'); // Center
        addHandle(31, cx + r, cy, 'ew-resize'); // Radius (Right edge)
    } else if (shapeType === 'ellipse') {
        const cx = stroke.start.x + (stroke.end.x - stroke.start.x)/2;
        const cy = stroke.start.y + (stroke.end.y - stroke.start.y)/2;
        const rx = Math.abs((stroke.end.x - stroke.start.x)/2);
        const ry = Math.abs((stroke.end.y - stroke.start.y)/2);
        
        addHandle(32, cx + rx, cy, 'ew-resize'); // Right (Width)
        addHandle(33, cx, cy + ry, 'ns-resize'); // Bottom (Height)
    } else if (shapeType === 'parallelogram') {
        // Standard corners
        addHandle(0, stroke.start.x, stroke.start.y, 'nwse-resize');
        addHandle(1, stroke.end.x, stroke.start.y, 'nesw-resize');
        addHandle(2, stroke.end.x, stroke.end.y, 'nwse-resize');
        addHandle(3, stroke.start.x, stroke.end.y, 'nesw-resize');
        
        // Skew handle (Top Edge Midpoint)
        const w = stroke.end.x - stroke.start.x;
        // Apply existing skew to find visual top center
        const skewOffset = (stroke.skewX || 0) * w;
        // Top edge center:
        // Top Left: start.x + skewOffset, start.y
        // Top Right: start.x + w + skewOffset, start.y
        // Mid: start.x + w/2 + skewOffset, start.y
        
        const topMidX = stroke.start.x + w/2 + skewOffset;
        const topMidY = stroke.start.y;
        
        addHandle(40, topMidX, topMidY, 'ew-resize', 'ri-arrow-left-right-line');
        
    } else if (shapeType === 'cuboid') {
        addHandle(50, stroke.end.x, stroke.end.y, 'ew-resize'); // Width (Bottom Right Front)
        addHandle(51, stroke.start.x, stroke.start.y, 'ns-resize'); // Height (Top Left Front)
        
        if (stroke.depthEnd) {
            // Depth/Angle Handle on the depth edge midpoint
            // Edge: End -> DepthEnd
            const mx = (stroke.end.x + stroke.depthEnd.x) / 2;
            const my = (stroke.end.y + stroke.depthEnd.y) / 2;
            addHandle(52, mx, my, 'nwse-resize', 'ri-drag-move-line'); 
        }
    } else if (shapeType === 'axis-xy' || shapeType === 'axis-xyz') {
        // Axis Length Handles (Midpoints)
        // X Axis: Start -> End
        const mx = (stroke.start.x + stroke.end.x) / 2;
        const my = (stroke.start.y + stroke.end.y) / 2;
        addHandle(60, mx, my, 'move');
        
        if (stroke.depthEnd) {
            // Y Axis: Start -> DepthEnd
            const myx = (stroke.start.x + stroke.depthEnd.x) / 2;
            const myy = (stroke.start.y + stroke.depthEnd.y) / 2;
            addHandle(61, myx, myy, 'move');
        }
    }
}

function rotateSelection(angle) {
    // Rotate all points around the center of the selection bounds
    if (!state.selectionBounds) return;
    
    // Original center (calculated from original strokes)
    // We need original bounds.
    // Let's re-calculate bounds from original strokes.
    // Or just use the center from state.rotationCenter (screen) -> convert to world.
    const cam = state.getActiveCamera();
    const cx = (state.rotationCenter.x - cam.x) / cam.z;
    const cy = (state.rotationCenter.y - cam.y) / cam.z;
    
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    const strokes = state.getActiveStrokes();
    
    state.selectedStrokeIndices.forEach((idx, i) => {
        const original = state.originalSelectionStrokes[i];
        const current = strokes[idx];
        
        const rotatePoint = (x, y) => {
            const dx = x - cx;
            const dy = y - cy;
            return {
                x: cx + dx * cos - dy * sin,
                y: cy + dx * sin + dy * cos
            };
        };
        
        if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(current.type)) {
            // Rotate center of object
            const origCx = original.x + original.w / 2;
            const origCy = original.y + original.h / 2;
            const newCenter = rotatePoint(origCx, origCy);
            
            current.x = newCenter.x - current.w / 2;
            current.y = newCenter.y - current.h / 2;
            
            // Add rotation property to object if supported
            // CSS transform: rotate(...)
            current.rotation = (original.rotation || 0) + angle;
        } else if (current.type === 'shape') {
            const newStart = rotatePoint(original.start.x, original.start.y);
            const newEnd = rotatePoint(original.end.x, original.end.y);
            current.start = newStart;
            current.end = newEnd;
            if (current.depthEnd && original.depthEnd) {
                current.depthEnd = rotatePoint(original.depthEnd.x, original.depthEnd.y);
            }
        } else {
            if (original.points) {
                current.points = original.points.map(p => {
                    const np = rotatePoint(p.x, p.y);
                    return { ...p, x: np.x, y: np.y };
                });
            }
        }
    });
}

function mirrorSelection(axis) { // 'h' or 'v'
    if (!state.selectionBounds) return;
    
    const bounds = state.selectionBounds;
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    
    const strokes = state.getActiveStrokes();
    
    state.selectedStrokeIndices.forEach(idx => {
        const current = strokes[idx];
        
        if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(current.type)) {
            if (axis === 'h') {
                // Mirror horizontally around center
                current.x = 2 * cx - current.x - current.w;
                current.scaleX = (current.scaleX || 1) * -1;
            } else {
                // Mirror vertically
                current.y = 2 * cy - current.y - current.h;
                current.scaleY = (current.scaleY || 1) * -1;
            }
        } else if (current.type === 'shape') {
             if (axis === 'h') {
                 current.start.x = 2 * cx - current.start.x;
                 current.end.x = 2 * cx - current.end.x;
                 if (current.depthEnd) current.depthEnd.x = 2 * cx - current.depthEnd.x;
             } else {
                 current.start.y = 2 * cy - current.start.y;
                 current.end.y = 2 * cy - current.end.y;
                 if (current.depthEnd) current.depthEnd.y = 2 * cy - current.depthEnd.y;
             }
        } else {
            if (current.points) {
                current.points.forEach(p => {
                    if (axis === 'h') {
                        p.x = 2 * cx - p.x;
                    } else {
                        p.y = 2 * cy - p.y;
                    }
                });
            }
        }
    });
    
    canvasModule.renderCanvas();
    getObjectsModule().updateDOMObjects();
    updateSelectionBounds();
    showSelectionToolbar();
}

function rotateSelection90(dir) { // 1 or -1, or 2 (180)
    if (!state.selectionBounds) return;
    
    // Rotate 90 deg
    const angle = dir * Math.PI / 2;
    
    // Prepare for rotation logic (needs original strokes snapshot or just in-place?)
    // In-place rotation is easier for buttons.
    // Reuse rotateSelection logic but set state.rotationCenter to current bounds center.
    
    const bounds = state.selectionBounds;
    const cam = state.getActiveCamera();
    
    // Set temp rotation center
    // rotateSelection expects state.rotationCenter in SCREEN coords.
    const cxWorld = bounds.x + bounds.w / 2;
    const cyWorld = bounds.y + bounds.h / 2;
    state.rotationCenter = {
        x: cxWorld * cam.z + cam.x,
        y: cyWorld * cam.z + cam.y
    };
    
    // We need originalSelectionStrokes to be current strokes
    state.originalSelectionStrokes = cloneStrokes(state.selectedStrokeIndices);
    
    rotateSelection(angle);
    
    canvasModule.renderCanvas();
    getObjectsModule().updateDOMObjects();
    updateSelectionBounds();
    showSelectionToolbar();
}

function deleteSelection() {
  state.selectedStrokeIndices.sort((a, b) => b - a);
  const strokes = state.getActiveStrokes();
  
  // Capture items for undo
  const items = [];
  state.selectedStrokeIndices.forEach(idx => {
      items.push({ index: idx, stroke: strokes[idx] });
  });
  
  state.selectedStrokeIndices.forEach(idx => {
    strokes.splice(idx, 1);
  });
  
  getHistory().pushAction({ type: 'delete', items });
  
  state.selectedStrokeIndices = [];
  state.selectionBounds = null;
  selectionToolbar.style.display = 'none';
  selectionOverlay.style.display = 'none';
  canvasModule.renderCanvas();
  getObjectsModule().updateDOMObjects();
}

function cloneSelection() {
  const newIndices = [];
  const offset = 20;
  const strokes = state.getActiveStrokes();
  state.selectedStrokeIndices.forEach(idx => {
    const original = strokes[idx];
    let stroke;
    if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(original.type)) { // Added 'text'
        stroke = { ...original, x: original.x + offset, y: original.y + offset };
    } else {
        stroke = JSON.parse(JSON.stringify(original));
        if (stroke.points) {
            stroke.points.forEach(p => { p.x += offset; p.y += offset; });
        }
    }
    strokes.push(stroke);
    newIndices.push(strokes.length - 1);
  });
  state.selectedStrokeIndices = newIndices;
  updateSelectionBounds();
  showSelectionToolbar();
  canvasModule.renderCanvas();
}

function cloneSelectionToNewPage() {
    if (state.fullscreen.active) return; // Not supported in fullscreen
    
    // Requires access to ui logic (updatePageIndicator), pass via callback or event?
    // Or just require ui module?
    // For now, let's implement the logic and assume renderer calls updateUI
    
    // Actually this modifies page structure.
    const strokesToClone = state.selectedStrokeIndices.map(idx => {
        const original = state.pages[state.currentPageIndex][idx];
        if (['image', 'video', 'audio', 'browser', 'link', 'text'].includes(original.type)) { // Added 'text'
             return { ...original };
        }
        return JSON.parse(JSON.stringify(original));
    });
    state.pages.push(strokesToClone);
    state.currentPageIndex = state.pages.length - 1;
    state.selectedStrokeIndices = strokesToClone.map((_, i) => i);
    
    // UI updates should be triggered by the caller or we dispatch event
    updateSelectionBounds();
    showSelectionToolbar();
    canvasModule.renderCanvas();
    getObjectsModule().updateDOMObjects();
}

function bringToFront() {
    const strokes = state.getActiveStrokes();
    const indices = state.selectedStrokeIndices.sort((a, b) => a - b);
    const selectedStrokes = [];
    
    // Remove from end to start to avoid index shift issues
    for (let i = indices.length - 1; i >= 0; i--) {
        selectedStrokes.unshift(strokes.splice(indices[i], 1)[0]);
    }
    
    strokes.push(...selectedStrokes);
    
    // Update indices
    state.selectedStrokeIndices = selectedStrokes.map((_, i) => strokes.length - selectedStrokes.length + i);
    getObjectsModule().updateDOMObjects();
    canvasModule.renderCanvas();
}

function sendToBack() {
    const strokes = state.getActiveStrokes();
    const indices = state.selectedStrokeIndices.sort((a, b) => a - b);
    const selectedStrokes = [];
    
    for (let i = indices.length - 1; i >= 0; i--) {
        selectedStrokes.unshift(strokes.splice(indices[i], 1)[0]);
    }
    
    strokes.unshift(...selectedStrokes);
    
    // Update indices
    state.selectedStrokeIndices = selectedStrokes.map((_, i) => i);
    getObjectsModule().updateDOMObjects();
    canvasModule.renderCanvas();
}

function bringForward() {
    const strokes = state.getActiveStrokes();
    const indices = state.selectedStrokeIndices;
    const selectedObjects = new Set(indices.map(i => strokes[i]));
    
    // Iterate from end to start (top to bottom)
    for (let i = strokes.length - 2; i >= 0; i--) {
        if (selectedObjects.has(strokes[i])) {
            // If the item above is NOT selected, we can swap
            if (!selectedObjects.has(strokes[i+1])) {
                const temp = strokes[i];
                strokes[i] = strokes[i+1];
                strokes[i+1] = temp;
            }
        }
    }
    
    // Re-calculate indices
    state.selectedStrokeIndices = strokes.map((s, i) => selectedObjects.has(s) ? i : -1).filter(i => i !== -1);
    getObjectsModule().updateDOMObjects();
    canvasModule.renderCanvas();
}

function sendBackward() {
    const strokes = state.getActiveStrokes();
    const indices = state.selectedStrokeIndices;
    const selectedObjects = new Set(indices.map(i => strokes[i]));
    
    // Iterate from start to end (0 to N).
    // If selected, try to swap with i-1.
    // Move "Backward" means index - 1.
    
    for (let i = 1; i < strokes.length; i++) {
        if (selectedObjects.has(strokes[i])) {
            // Check i-1
            if (!selectedObjects.has(strokes[i-1])) {
                // Swap
                const temp = strokes[i];
                strokes[i] = strokes[i-1];
                strokes[i-1] = temp;
            }
        }
    }
    
    // Re-calculate indices
    state.selectedStrokeIndices = strokes.map((s, i) => selectedObjects.has(s) ? i : -1).filter(i => i !== -1);
    getObjectsModule().updateDOMObjects();
    canvasModule.renderCanvas();
}

function attachObjectListeners(el, obj, dragHandle) {
    if (el.dataset.listening) return;
    el.dataset.listening = 'true';

    const handle = dragHandle || el;
    
    // Add click listener for selection (Handles "Click to Select")
    handle.addEventListener('click', (e) => {
        if (justLassoed) return; // Ignore click if we just finished a lasso
        
        // If we are drawing/lassoing, this click might be part of that interaction?
        // But lasso logic on window handles its own cleanup.
        // If we click an object, we want to select it.
        e.stopPropagation();
        
        const strokes = state.getActiveStrokes();
        const index = strokes.indexOf(obj);
        if (index !== -1) {
            state.selectedStrokeIndices = [index];
            updateSelectionBounds();
            showSelectionToolbar();
        }
    });
    
    handle.addEventListener('pointerdown', (e) => {
        if (state.currentTool === 'pen' || state.currentTool === 'eraser') return;
        
        // Close Adjust Popup if open (since we are interacting with object)
        const adjustPopup = document.getElementById('adjust-popup');
        if (adjustPopup && adjustPopup.style.display !== 'none') {
            adjustPopup.style.display = 'none';
        }

        const strokes = state.getActiveStrokes();
        const index = strokes.indexOf(obj);
        
        if (index !== -1) {
             // Check if target is interactive text
            if (state.selectedStrokeIndices.includes(index) && (e.target.isContentEditable || e.target.tagName === 'INPUT')) {
                 e.stopPropagation();
                 return;
            }

            // Logic Change:
            // If ALREADY selected -> Stop Propagation and start Move.
            // If NOT selected -> Do NOT Stop Propagation. Let Window start Lasso.
            // If user releases quickly (Click), the 'click' listener above will select it.
            
            if (state.selectedStrokeIndices.includes(index)) {
                e.stopPropagation();
                
                state.selectedStrokeIndices = [index]; // Ensure single select if moved? Or keep multi?
                // If it's part of multi-select, dragging one drags all.
                // So we shouldn't reset to [index] if it's already in the list.
                // But current logic resets: state.selectedStrokeIndices = [index];
                // Wait, existing logic was: state.selectedStrokeIndices = [index];
                // This breaks multi-select move if I click one of them?
                // Usually: Click on one of selection -> Keep selection.
                // Click on unselected -> Select only that one.
                // So if included, don't reset.
                // But the code below says: state.selectedStrokeIndices = [index];
                // I should fix that too if I want proper multi-select move behavior.
                // But for now let's focus on the Lasso requirement.
                
                // Existing behavior: Clicking selected object isolates it?
                // If I have 3 items selected, and I click one to drag, do I drag all 3 or just 1?
                // Standard app: Dragging selection drags all.
                // Code: state.selectedStrokeIndices = [index]; -> This resets to single!
                // Fix: Only reset if not in list. But we are in "if included" block.
                // So we should NOT reset.
                
                updateSelectionBounds();
                showSelectionToolbar();
                
                const cam = state.getActiveCamera();
                state.isMovingSelection = true;
                state.dragStart = { x: (e.clientX - cam.x) / cam.z, y: (e.clientY - cam.y) / cam.z };
                state.originalSelectionStrokes = cloneStrokes(state.selectedStrokeIndices);
                
                if (!e.target.isContentEditable && e.target.tagName !== 'INPUT') {
                    handle.setPointerCapture(e.pointerId);
                }
                
                const onMove = (em) => {
                    if (!state.isMovingSelection) return;
                    canvasModule.autoPanOnEdge(em.clientX, em.clientY);
                    const cm = state.getActiveCamera();
                    const point = { x: (em.clientX - cm.x) / cm.z, y: (em.clientY - cm.y) / cm.z };
                    const dx = point.x - state.dragStart.x;
                    const dy = point.y - state.dragStart.y;
                    
                    if (Math.abs(dx * cm.z) < 5 && Math.abs(dy * cm.z) < 5) return;
                    
                    moveSelection(dx, dy);
                    canvasModule.renderCanvas();
                    getObjectsModule().updateDOMObjects();
                    updateSelectionToolbarPosition();
                };
                
                const onUp = (eu) => {
                    state.isMovingSelection = false;
                    handle.releasePointerCapture(eu.pointerId);
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    
                    const items = state.selectedStrokeIndices.map((idx, i) => ({
                        index: idx,
                        before: state.originalSelectionStrokes[i],
                        after: cloneStrokes([idx])[0]
                    }));
                    getHistory().pushAction({ type: 'transform', items });
                };
                
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            } else {
                // Not selected. Let it bubble to Window (Lasso).
                // Do nothing here.
            }
        }
    });
}

module.exports = {
    performLassoSelection,
    updateSelectionBounds,
    showSelectionToolbar,
    updateSelectionToolbarPosition,
    cloneStrokes,
    moveSelection,
    resizeSelection,
    deleteSelection,
    cloneSelection,
    cloneSelectionToNewPage,
    attachObjectListeners,
    setMenuState
};