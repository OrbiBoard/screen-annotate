const state = require('./state');
const utils = require('./utils');
const canvasModule = require('./canvas');
// Circular dependency: objects.js requires selection.js, so we might need to require objects.js inside functions or use a getter.

let objectsModule; // Lazy load
let uiModuleInstance;

const selectionToolbar = document.getElementById('selection-toolbar');
const selectionOverlay = document.getElementById('selection-overlay');
const selectionBoxDom = selectionOverlay.querySelector('.selection-box-dom');
let selectionHandles = [];
let isLayerMenuExpanded = false;

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

  const strokes = state.getActiveStrokes();
  state.selectedStrokeIndices = [];

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
        
        if (intersects) {
             state.selectedStrokeIndices.push(i);
        }
    } else if (stroke.type === 'pen' && stroke.points) {
        for (const p of stroke.points) {
            if (utils.isPointInPolygon(p, state.lassoPoints)) {
                state.selectedStrokeIndices.push(i);
                break;
            }
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
    if (['image', 'video', 'audio', 'browser', 'link'].includes(stroke.type)) {
        if (stroke.x < minX) minX = stroke.x;
        if (stroke.y < minY) minY = stroke.y;
        if (stroke.x + stroke.w > maxX) maxX = stroke.x + stroke.w;
        if (stroke.y + stroke.h > maxY) maxY = stroke.y + stroke.h;
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

  const padding = 10;
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

  // Fix for Issue 3: Optimization during drag
  // If moving selection, we don't need to re-render buttons, just update position.
  if (state.isMovingSelection) {
      selectionToolbar.style.left = `${screenX + screenW / 2 - selectionToolbar.offsetWidth / 2}px`;
      
      let toolbarTop = screenY + screenH + 10;
      
      // Check if media controls are visible and overlapping
      const mediaControls = document.getElementById('media-controls');
      if (mediaControls && mediaControls.style.display !== 'none' && state.activeMedia) {
          if (state.fullscreen.active) {
              const mcRect = mediaControls.getBoundingClientRect();
              const tbHeight = 50; 
              if (toolbarTop + tbHeight > mcRect.top) {
                  toolbarTop = screenY - tbHeight - 10;
              }
          } else if (state.selectedStrokeIndices.includes(state.activeMedia.index)) {
              const mcRect = mediaControls.getBoundingClientRect();
              if (mcRect.height > 0) {
                  toolbarTop = mcRect.bottom + 10;
              } else {
                  toolbarTop += 60; 
              }
          }
      }
      
      selectionToolbar.style.top = `${toolbarTop}px`;
      
      // Update overlay box position
      selectionBoxDom.style.left = `${screenX}px`;
      selectionBoxDom.style.top = `${screenY}px`;
      selectionBoxDom.style.width = `${screenW}px`;
      selectionBoxDom.style.height = `${screenH}px`;
      
      // Update handles position
      const handlePositions = [
        { x: 0, y: 0 }, // TL
        { x: screenW, y: 0 }, // TR
        { x: screenW, y: screenH }, // BR
        { x: 0, y: screenH } // BL
      ];
      
      selectionHandles.forEach((h, i) => {
          if (handlePositions[i]) {
            h.style.left = `${screenX + handlePositions[i].x}px`;
            h.style.top = `${screenY + handlePositions[i].y}px`;
          }
      });
      
      return;
  }
  
  // Clean up previous custom buttons
  const existingCustomBtns = selectionToolbar.querySelectorAll('.custom-action-btn');
  existingCustomBtns.forEach(btn => btn.remove());

  // Clean up layer buttons
  selectionToolbar.querySelectorAll('.custom-layer-btn').forEach(btn => btn.remove());

  // Add Action Button if single media selected
  // Only in Normal Mode (not fullscreen)
  if (!state.fullscreen.active && state.selectedStrokeIndices.length === 1) {
      const idx = state.selectedStrokeIndices[0];
      const obj = state.getActiveStrokes()[idx];
      let btnIcon = null;
      let btnLabel = null;
      let onClick = null;

      if (obj.type === 'video' || obj.type === 'audio') {
          // Check if playing
          const wrapper = document.querySelector(`.dom-object-wrapper[data-id="obj-${idx}"]`);
          const media = wrapper ? wrapper.querySelector(obj.type) : null;
          const isPlaying = media && !media.paused;
          
          btnIcon = isPlaying ? 'ri-pause-fill' : 'ri-play-fill';
          btnLabel = isPlaying ? '暂停' : '播放';
          
          onClick = () => {
             if (isPlaying) {
                 if (state.activeMedia && state.activeMedia.index === idx) {
                      media.pause();
                 } else {
                      getObjectsModule().startActiveMedia(idx);
                 }
             } else {
                 getObjectsModule().startActiveMedia(idx);
                 if (state.activeMedia && state.activeMedia.index === idx) {
                     media.play();
                 }
             }
             setTimeout(updateSelectionToolbarPosition, 100);
          };
          
          // Add Fullscreen Button for Video
          if (obj.type === 'video') {
              const fsBtn = document.createElement('button');
              fsBtn.className = 'tool-btn small custom-action-btn';
              fsBtn.innerHTML = `<i class="ri-fullscreen-line"></i><span>全屏</span>`;
              fsBtn.onclick = () => {
                  if (state.activeMedia && state.activeMedia.index === idx) {
                      getObjectsModule().enterFullscreen(idx);
                  } else {
                      getObjectsModule().startActiveMedia(idx);
                      setTimeout(() => getObjectsModule().enterFullscreen(idx), 100);
                  }
              };
              selectionToolbar.insertBefore(fsBtn, selectionToolbar.firstChild);
          }

      } else if (obj.type === 'browser') {
          btnIcon = 'ri-global-line';
          btnLabel = '打开';
          onClick = () => getUiModule().showFullscreenBrowser(obj.src);
      } else if (obj.type === 'link') {
          btnIcon = 'ri-external-link-line';
          btnLabel = '访问';
          onClick = () => require('electron').shell.openExternal(obj.src);
      }

      if (btnIcon) {
          const btn = document.createElement('button');
          btn.className = 'tool-btn small custom-action-btn';
          btn.innerHTML = `<i class="${btnIcon}"></i><span>${btnLabel}</span>`;
          btn.onclick = onClick;
          // Insert at the beginning
          selectionToolbar.insertBefore(btn, selectionToolbar.firstChild);
      }
      
      // Fix: Hide Adjust button for Media types (video/audio)
      // Fix: Change Adjust logic for Browser/Link
      const adjustBtn = document.getElementById('btn-sel-adjust');
      if (adjustBtn) {
          if (obj.type === 'video' || obj.type === 'audio') {
              adjustBtn.style.display = 'none';
          } else {
              adjustBtn.style.display = 'flex';
              // Override click for Browser/Link
              if (obj.type === 'browser' || obj.type === 'link') {
                  adjustBtn.onclick = () => {
                      getUiModule().showModal(obj.type === 'browser' ? '修改网页地址' : '修改链接', [
                          { label: '名称', value: obj.name },
                          { label: '地址', value: obj.src }
                      ], (values) => {
                          if (values) {
                              obj.name = values[0];
                              obj.src = values[1];
                              // Re-render
                              getObjectsModule().updateDOMObjects();
                          }
                      });
                  };
              } else {
                  adjustBtn.onclick = () => {
                      const rect = selectionToolbar.getBoundingClientRect();
                      const adjustPopup = document.getElementById('adjust-popup');
                      if (adjustPopup) {
                        adjustPopup.style.display = 'block';
                        adjustPopup.style.left = `${rect.left}px`;
                        adjustPopup.style.top = `${rect.bottom + 10}px`;
                        adjustPopup.style.transform = 'none';
                        adjustPopup.style.bottom = 'auto';
                      }
                  };
              }
          }
      }
  } else {
      // Multiple selection or ink
      const adjustBtn = document.getElementById('btn-sel-adjust');
      if (adjustBtn) {
          adjustBtn.style.display = 'flex';
          adjustBtn.onclick = () => {
              const rect = selectionToolbar.getBoundingClientRect();
              const adjustPopup = document.getElementById('adjust-popup');
              if (adjustPopup) {
                adjustPopup.style.display = 'block';
                adjustPopup.style.left = `${rect.left}px`;
                adjustPopup.style.top = `${rect.bottom + 10}px`;
                adjustPopup.style.transform = 'none';
                adjustPopup.style.bottom = 'auto';
              }
          };
      }
  }

  // Add Layer Controls to the right
  // Add Separator
  const sep = document.createElement('div');
  sep.className = 'separator custom-layer-btn';
  selectionToolbar.appendChild(sep);

  if (!isLayerMenuExpanded) {
      // Show single toggle button
      const btn = document.createElement('button');
      btn.className = 'tool-btn small custom-layer-btn';
      btn.innerHTML = `<i class="ri-stack-line"></i><span>层级</span>`;
      btn.onclick = () => {
          isLayerMenuExpanded = true;
          updateSelectionToolbarPosition(); 
      };
      selectionToolbar.appendChild(btn);
  } else {
      // Show Collapse button
      const collapseBtn = document.createElement('button');
      collapseBtn.className = 'tool-btn small custom-layer-btn';
      collapseBtn.innerHTML = `<i class="ri-arrow-left-s-line"></i><span>收起</span>`;
      collapseBtn.onclick = () => {
          isLayerMenuExpanded = false;
          updateSelectionToolbarPosition();
      };
      selectionToolbar.appendChild(collapseBtn);

      const layerControls = [
          { icon: 'ri-bring-to-front', title: '置于顶层', action: bringToFront },
          { icon: 'ri-send-to-back', title: '置于底层', action: sendToBack },
          { icon: 'ri-arrow-up-line', title: '上移一层', action: bringForward },
          { icon: 'ri-arrow-down-line', title: '下移一层', action: sendBackward }
      ];

      layerControls.forEach(ctrl => {
          const btn = document.createElement('button');
          btn.className = 'tool-btn small custom-layer-btn';
          btn.innerHTML = `<i class="${ctrl.icon}"></i><span>${ctrl.title}</span>`;
          btn.onclick = () => {
              ctrl.action();
              canvasModule.renderCanvas();
              getObjectsModule().updateDOMObjects();
          };
          selectionToolbar.appendChild(btn);
      });
  }
  
  // Add Deselect Button (Always visible at end or start?)
  // User asked for "Cancel Selection Button".
  // Let's add it at the very end.
  const deselectBtn = document.createElement('button');
  deselectBtn.className = 'tool-btn small custom-action-btn'; // custom-action-btn is cleared on re-render?
  // Wait, showSelectionToolbar clears .custom-action-btn at start.
  // But this is added AFTER clear. So it's fine.
  // But wait, if I add it here, it might be cleared next time. That's good.
  deselectBtn.innerHTML = `<i class="ri-close-circle-line"></i><span>取消</span>`;
  deselectBtn.onclick = () => {
      state.selectedStrokeIndices = [];
      state.selectionBounds = null;
      selectionToolbar.style.display = 'none';
      selectionOverlay.style.display = 'none';
      canvasModule.renderCanvas();
      getObjectsModule().updateDOMObjects();
  };
  selectionToolbar.appendChild(deselectBtn);
  
  
  // Update Overlay
  selectionOverlay.style.display = 'block';
  selectionBoxDom.style.left = `${screenX}px`;
  selectionBoxDom.style.top = `${screenY}px`;
  selectionBoxDom.style.width = `${screenW}px`;
  selectionBoxDom.style.height = `${screenH}px`;
  
  // Setup Interaction for Box
  if (!selectionBoxDom.hasAttribute('data-listening')) {
      selectionBoxDom.setAttribute('data-listening', 'true');
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
          };

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
      };
  }

  // Update Handles
  selectionHandles.forEach(h => h.remove());
  selectionHandles = [];
  
  const handlePositions = [
      { x: 0, y: 0, cursor: 'nwse-resize', id: 0 }, // TL
      { x: screenW, y: 0, cursor: 'nesw-resize', id: 1 }, // TR
      { x: screenW, y: screenH, cursor: 'nwse-resize', id: 2 }, // BR
      { x: 0, y: screenH, cursor: 'nesw-resize', id: 3 } // BL
  ];
  
  handlePositions.forEach(pos => {
      const h = document.createElement('div');
      h.className = 'resize-handle';
      h.style.left = `${screenX + pos.x}px`;
      h.style.top = `${screenY + pos.y}px`;
      h.style.cursor = pos.cursor;
      
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
          };

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
      };
      
      selectionOverlay.appendChild(h);
      selectionHandles.push(h);
  });
  
  selectionToolbar.style.display = 'flex';
  selectionToolbar.style.left = `${screenX + screenW / 2 - selectionToolbar.offsetWidth / 2}px`;
  
  // Calculate Top Position
  let toolbarTop = screenY + screenH + 10;
  
  // Check if media controls are visible and overlapping
  const mediaControls = document.getElementById('media-controls');
  if (mediaControls && mediaControls.style.display !== 'none' && state.activeMedia) {
      // Check if the active media is within current selection
      // Or if we are in fullscreen mode (media controls are fixed at bottom)
      
      if (state.fullscreen.active) {
          // In fullscreen, media controls are at bottom.
          // Selection toolbar should be above them if selection is near bottom?
          // Or just standard positioning.
          // But if we selected ink ON TOP of video, toolbar might be anywhere.
          // If toolbar overlaps controls?
          const mcRect = mediaControls.getBoundingClientRect();
          const tbHeight = 50; // Approx
          
          // If toolbar would be below viewport or overlapping controls
          if (toolbarTop + tbHeight > mcRect.top) {
              // Place ABOVE selection box
              toolbarTop = screenY - tbHeight - 10;
          }
      } else if (state.selectedStrokeIndices.includes(state.activeMedia.index)) {
          // It's likely the media controls are positioned under this object.
          // We should position under the media controls.
          const mcRect = mediaControls.getBoundingClientRect();
          if (mcRect.height > 0) {
              toolbarTop = mcRect.bottom + 10;
          } else {
              // Fallback if rect not ready
              toolbarTop += 60; 
          }
      }
  }
  
  selectionToolbar.style.top = `${toolbarTop}px`;
}

function updateSelectionToolbarPosition() {
  showSelectionToolbar();
}

function cloneStrokes(indices) {
  const strokes = state.getActiveStrokes();
  return indices.map(idx => {
    const original = strokes[idx];
    if (['image', 'video', 'audio', 'browser', 'link'].includes(original.type)) {
        return { ...original }; 
    }
    return JSON.parse(JSON.stringify(original));
  });
}

function moveSelection(dx, dy) {
  const strokes = state.getActiveStrokes();
  state.selectedStrokeIndices.forEach((idx, i) => {
    const original = state.originalSelectionStrokes[i];
    const current = strokes[idx];
    if (['image', 'video', 'audio', 'browser', 'link'].includes(current.type)) {
        current.x = original.x + dx;
        current.y = original.y + dy;
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
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.originalSelectionStrokes.forEach(s => {
    if (['image', 'video', 'audio', 'browser', 'link'].includes(s.type)) {
        if (s.x < minX) minX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.x + s.w > maxX) maxX = s.x + s.w;
        if (s.y + s.h > maxY) maxY = s.y + s.h;
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
      newX = Math.min(cursorPoint.x, maxX - 10);
      newY = Math.min(cursorPoint.y, maxY - 10);
      newW = maxX - newX;
      newH = maxY - newY;
  } else if (handle === 1) { // TR
      newY = Math.min(cursorPoint.y, maxY - 10);
      newW = Math.max(cursorPoint.x - minX, 10);
      newH = maxY - newY;
  } else if (handle === 2) { // BR
      newW = Math.max(cursorPoint.x - minX, 10);
      newH = Math.max(cursorPoint.y - minY, 10);
  } else if (handle === 3) { // BL
      newX = Math.min(cursorPoint.x, maxX - 10);
      newW = maxX - newX;
      newH = Math.max(cursorPoint.y - minY, 10);
  }
  
  const scaleX = newW / originalW;
  const scaleY = newH / originalH;

  const strokes = state.getActiveStrokes();

  state.selectedStrokeIndices.forEach((idx, i) => {
    const original = state.originalSelectionStrokes[i];
    const current = strokes[idx];
    
    if (['image', 'video', 'audio', 'browser', 'link'].includes(current.type)) {
        const relX = (original.x - minX) * scaleX;
        const relY = (original.y - minY) * scaleY;
        current.x = newX + relX;
        current.y = newY + relY;
        current.w = original.w * scaleX;
        current.h = original.h * scaleY;
    } else {
        if (original.points) {
            current.points = original.points.map(p => ({
                ...p,
                x: newX + (p.x - minX) * scaleX,
                y: newY + (p.y - minY) * scaleY,
            }));
            current.size = original.size * ((scaleX + scaleY) / 2);
        }
    }
  });
  
  updateSelectionBounds();
}

function deleteSelection() {
  state.selectedStrokeIndices.sort((a, b) => b - a);
  const strokes = state.getActiveStrokes();
  state.selectedStrokeIndices.forEach(idx => {
    strokes.splice(idx, 1);
  });
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
    if (['image', 'video', 'audio', 'browser', 'link'].includes(original.type)) {
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
        if (['image', 'video', 'audio', 'browser', 'link'].includes(original.type)) {
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
}

function bringForward() {
    const strokes = state.getActiveStrokes();
    const indices = state.selectedStrokeIndices.sort((a, b) => b - a); // Process from end
    
    // Check if we can move forward
    // If the last selected item is already at the end, and all selected items are consecutive at the end, we can't move.
    // But simple logic: try to move each item forward if possible.
    // To maintain relative order and handle groups correctly, we iterate from highest index.
    
    const newIndices = [];
    const movedIndices = new Set();
    
    // We need to be careful. If we have [A, B*, C, D] -> [A, C, B*, D]. 
    // If [A, B*, C*, D] -> [A, D, B*, C*] (Block move) or [A, C*, B*, D]? Usually block move is expected for "Bring Forward".
    // But standard behavior in tools often moves the whole selection one step up in the stack.
    // Let's implement: find the "block" of selected items, swap with the item immediately following the block.
    // But here we might have non-contiguous selection [A*, B, C*]. 
    // Simple approach: Iterate from highest index. If index < length - 1, and index + 1 is NOT selected, swap.
    
    for (const idx of indices) {
        if (idx < strokes.length - 1) {
            // Check if next item is selected. If so, don't swap with it (it will move too, or we are blocked by it).
            // Actually, if we process from highest index:
            // [A, B*, C*]. 
            // C*: next is nothing. Can't move.
            // B*: next is C*. C* is selected. Don't swap with selected.
            // So if next is selected, we only move if the next one moved? This gets complex.
            
            // Simpler logic: treat selection as a group? 
            // Or just swap with next non-selected item?
            // Let's try the simple swap logic: Swap with next element if next element is NOT selected.
            
            if (!state.selectedStrokeIndices.includes(idx + 1)) {
                // Swap
                const temp = strokes[idx];
                strokes[idx] = strokes[idx + 1];
                strokes[idx + 1] = temp;
                newIndices.push(idx + 1);
                movedIndices.add(idx); // Track that this original idx moved to idx+1
            } else {
                // Can't move because blocked by another selected item?
                // If the item above is selected, it should have tried to move first.
                // If it moved, then this one can follow.
                // If it didn't move (because it was at top), then this one is blocked.
                // Since we iterate from top (descending), we know if the upper one moved.
                
                // Wait, if [A, B*, C*]. 
                // Process C* (idx 2). At top. New idx = 2.
                // Process B* (idx 1). Next is C* (idx 2). Is C* in newIndices? 
                // C* didn't move. So B* shouldn't move.
                
                // Correct Logic:
                // If (idx + 1) is in newIndices (meaning the selected item above moved), then we can move too?
                // No, if [A, B*, C*], C* stays at 2. B* stays at 1.
                // If [A, B*, C, D]. 
                // C (idx 2) not selected. 
                // Process B* (idx 1). Next is C (not selected). Swap. B becomes 2. C becomes 1.
                newIndices.push(idx);
            }
        } else {
            newIndices.push(idx);
        }
    }
    
    // The above simple logic is flawed for contiguous blocks. 
    // Let's try a different approach:
    // Extract all selected items.
    // Find the insertion point.
    // This is hard for non-contiguous.
    
    // Let's go with the standard "move capable items" approach.
    // Iterate from high to low.
    // If strokes[i] is selected:
    //    if i < len - 1 and strokes[i+1] is NOT selected:
    //        swap(i, i+1)
    //        update index to i+1
    //    else if i < len - 1 and strokes[i+1] IS selected:
    //        check if strokes[i+1] moved? 
    //        Actually if we process from high to low, if the upper one moved, we can move.
    //        If the upper one didn't move (blocked by top), we can't move.
    
    // Re-eval:
    // [A, B*, C*]. 
    // Loop:
    // 1. C* (2). Next is null. Can't move. Stays 2.
    // 2. B* (1). Next is C* (2). C* is selected. Did C* move? No. So B* blocked.
    
    // [A, B*, C, D].
    // Loop:
    // 1. B* (1). Next is C (2). Not selected. Swap. B* -> 2.
    
    // [A, B*, C*, D].
    // Loop:
    // 1. C* (2). Next D (3). Not selected. Swap. C* -> 3. (Arr: A, B*, D, C*)
    // 2. B* (1). Next is D (2). Not selected. Swap. B* -> 2. (Arr: A, D, B*, C*)
    // Result: A, D, B*, C*. Correct.
    
    // So logic:
    // Iterate indices from high to low.
    // If idx < len - 1:
    //    If next (idx+1) is NOT selected: Swap. Track new index.
    //    If next (idx+1) IS selected: 
    //        Check if that selected item moved? 
    //        We need to know the mapping of old indices to new indices or status.
    //        Actually, since we modified the array in place in step 1, the "next" is the new neighbor.
    
    // Let's trace [A, B*, C*, D] again with in-place modification.
    // Indices: [1, 2]. Sorted desc: [2, 1].
    // 1. idx = 2 (C). Arr[2] is C. Arr[3] is D.
    //    Is index 3 selected? (Originally D was at 3). 
    //    Wait, "is selected" check must use current state or original state? 
    //    Usually "is selected" refers to the specific object.
    
    // Better implementation:
    // 1. Mark all selected objects with a temporary flag or set.
    // 2. Iterate array from end to start.
    // 3. If we find a selected object, try to swap it with the one below (index + 1).
    //    Condition to swap: index + 1 exists AND index + 1 is NOT selected.
    //    Wait, if we have [A, B*, C*, D].
    //    C* at 2. D at 3 (not selected). Swap. -> [A, B*, D, C*]. C is now at 3.
    //    B* at 1. D is now at 2 (not selected). Swap. -> [A, D, B*, C*]. B is now at 2.
    //    Correct.
    
    // What about [A, B*, C*]?
    // C* at 2. End. No swap.
    // B* at 1. C* at 2 (selected). No swap.
    // Correct.
    
    // What about [A, B*, C, D*].
    // D* at 3. End. No swap.
    // B* at 1. C at 2 (not selected). Swap. -> [A, C, B*, D*].
    // Correct.
    
    // Implementation:
    // Need to know which objects are selected. Using indices is tricky if we mutate array.
    // Use Set of objects.
    const selectedObjects = new Set(indices.map(i => strokes[i]));
    
    // Find current indices of these objects (in case they changed? No, we start fresh).
    // Actually we can just iterate indices from high to low.
    // But we need to check if neighbor is selected.
    
    // We can just check `selectedObjects.has(strokes[i+1])`.
    
    const newSelectedIndices = [];
    
    for (let i = strokes.length - 2; i >= 0; i--) {
        // We iterate the array. If current is selected, try to move down.
        // Wait, "Bring Forward" means increasing index (0 is bottom, N is top? usually 0 is bottom in canvas).
        // Yes, render order: 0 first, N last. N is on top.
        // So Bring Forward = index + 1.
        
        if (selectedObjects.has(strokes[i])) {
            // Check i+1
            if (!selectedObjects.has(strokes[i+1])) {
                // Swap
                const temp = strokes[i];
                strokes[i] = strokes[i+1];
                strokes[i+1] = temp;
                // It moved to i+1.
            }
        }
    }
    
    // Re-calculate indices
    state.selectedStrokeIndices = strokes.map((s, i) => selectedObjects.has(s) ? i : -1).filter(i => i !== -1);
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
}

function attachObjectListeners(el, obj, dragHandle) {
    if (el.dataset.listening) return;
    el.dataset.listening = 'true';

    const handle = dragHandle || el;
    
    handle.addEventListener('pointerdown', (e) => {
        if (state.currentTool === 'pen' || state.currentTool === 'eraser') return;
        e.stopPropagation();
        
        // Close Adjust Popup if open (since we are interacting with object)
        const adjustPopup = document.getElementById('adjust-popup');
        if (adjustPopup && adjustPopup.style.display !== 'none') {
            adjustPopup.style.display = 'none';
        }

        const strokes = state.getActiveStrokes();
        const index = strokes.indexOf(obj);
        if (index !== -1) {
            state.selectedStrokeIndices = [index];
            updateSelectionBounds();
            showSelectionToolbar();
            
            const cam = state.getActiveCamera();
            state.isMovingSelection = true;
            state.dragStart = { x: (e.clientX - cam.x) / cam.z, y: (e.clientY - cam.y) / cam.z };
            state.originalSelectionStrokes = cloneStrokes(state.selectedStrokeIndices);
            
            handle.setPointerCapture(e.pointerId);
            
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
                handle.releasePointerCapture(eu.pointerId);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            };
            
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
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
    attachObjectListeners
};
