const { getStroke } = require('perfect-freehand');
const state = require('./state');
const utils = require('./utils');
const shapesModule = require('./shapes');
const webgpuRenderer = require('./renderer-webgpu');

const canvas = document.getElementById('canvas-layer');
const ctx = canvas.getContext('2d');

let webgpuInitialized = false;
let webgpuAvailable = false;

async function initRenderer() {
    if (state.renderMode === 'webgpu' && !webgpuInitialized) {
        webgpuAvailable = await webgpuRenderer.initWebGPU(canvas);
        webgpuInitialized = true;
        if (!webgpuAvailable) {
            console.warn('[Canvas] WebGPU not available, falling back to Canvas2D');
            state.renderMode = 'canvas2d';
        }
    }
}

function setRenderMode(mode) {
    if (mode === state.renderMode) return;
    
    if (mode === 'webgpu') {
        if (!webgpuInitialized) {
            initRenderer().then(() => {
                if (webgpuAvailable) {
                    state.renderMode = 'webgpu';
                    renderCanvas();
                }
            });
        } else if (webgpuAvailable) {
            state.renderMode = 'webgpu';
            renderCanvas();
        }
    } else {
        state.renderMode = 'canvas2d';
        renderCanvas();
    }
}

function getRenderMode() {
    return state.renderMode;
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  
  const ctx2d = canvas.getContext('2d');
  ctx2d.scale(dpr, dpr);
  
  renderCanvas();
  try {
    const { updateMinimap } = require('./ui');
    updateMinimap();
  } catch (e) {
    // Minimap not available in embed mode
  }
}

function renderCanvas() {
  if (state.renderMode === 'webgpu' && webgpuAvailable) {
      const success = webgpuRenderer.renderCanvasWebGPU(canvas);
      if (success) {
          try {
              const { updateMinimap } = require('./ui');
              updateMinimap();
          } catch (e) {}
          return;
      }
  }
  
  renderCanvas2D();
}

function renderCanvas2D() {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  
  ctx.save();
  
  const camera = state.getActiveCamera();
  
  // Note: Canvas transform order is reverse of CSS?
  // CSS: translate(cx, cy) rotate(r) translate(-cx, -cy) translate(x, y) scale(z)
  // Canvas: translate(cx, cy) -> rotate(r) -> translate(-cx, -cy) -> translate(x, y) -> scale(z)
  // But wait, ink is already rotated in world coordinates by tool action.
  // So we DO NOT apply rotation to the camera transform here for Ink.
  // Ink points are physically moved.
  // BUT, we still need to pan/zoom correctly.
  
  // Standard Camera Transform:
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.z, camera.z);
  
  // If we were rotating the VIEW (like a camera tilt), we would rotate here.
  // But we chose to "Transform Ink" + "Rotate Background Layer".
  // So the coordinate system for ink remains axis-aligned to the screen?
  // Yes, because we rotated the points.
  
  // So NO rotation here.
  // Wait, previous code had rotation logic here. I removed it in Step 2.
  // "Reverted ctx.rotate: Removed the canvas context rotation from canvas.js."
  // So currently there is NO rotation in renderCanvas.
  
  // However, the user says "Roaming direction is wrong after rotation".
  // "漫游传递方向错误".
  // When panning, we change camera.x/y.
  // If background is rotated 90deg, dragging RIGHT on screen should move background RIGHT relative to screen.
  // But the background transform logic might be interpreting x/y differently?
  
  // Let's look at CSS transform in index.html:
  // `translate(${cx}px, ${cy}px) rotate(${r}deg) translate(${tx}px, ${ty}px) scale(${transform.scale})`
  // where tx = camera.x - cx.
  // If I drag mouse right, camera.x increases. tx increases.
  // The translation `translate(tx, ty)` is applied *before* rotation?
  // No, in CSS `transform: A B C` applies C then B then A (right to left) to the coordinate system?
  // Actually standard CSS is applied left to right on the element.
  // 1. Move to center.
  // 2. Rotate.
  // 3. Move by (tx, ty). <--- This move is now in the ROTATED coordinate system!
  
  // If I rotate 90deg, the "X axis" of the element is now pointing Down (or Up depending on direction).
  // So translating X moves it vertically on screen.
  // THIS IS THE BUG.
  
  // We want (tx, ty) to be in SCREEN coordinates (global), not local to the rotated element.
  // To achieve "Screen Relative Pan", we must apply translation *before* rotation?
  // Or undo rotation?
  
  // If we want visual result: ScreenCenter + Rotation + ScreenPan + Scale.
  // Order:
  // 1. Scale (local)
  // 2. Translate (Screen Pan - applied in screen coords)
  // 3. Rotate (Around Screen Center - applied to the whole composition?)
  
  // Wait, if I rotate the camera 90deg, and then pan right.
  // The image should move right on screen.
  // If I use `rotate(90deg) translate(100px, 0)`, it moves down (assuming CW).
  // If I want it to move right, I need `translate(100px, 0) rotate(90deg)`.
  
  // So the CSS order should be:
  // `translate(cx, cy) translate(tx, ty) rotate(r) translate(-cx, -cy) ...`
  // But wait, rotation is around center.
  
  // Correct Logic for "Screen Pan" + "Center Rotation":
  // We want the image to be at `camera.x, camera.y` (top-left) but rotated around screen center?
  // No, "Rotate around Center" means the pivot is fixed.
  // If I pan, the pivot moves?
  // Or do we rotate the *View*?
  
  // Let's stick to the definition:
  // Ink is rotated. Background is rotated.
  // Panning moves everything (Ink + Background) in Screen X/Y.
  
  // Ink: `ctx.translate(camera.x, camera.y)` -> This is Screen Pan.
  // Since ink points are already rotated, this is correct.
  // Ink moves right when camera.x increases.
  
  // Background (CSS):
  // We need `translate(tx, ty)` to happen in SCREEN coordinates.
  // Current: `translate(cx, cy) rotate(r) translate(tx, ty) ...`
  // The `translate(tx, ty)` is inside the rotation frame.
  
  // FIX: Move `translate(tx, ty)` OUTSIDE (before) the rotation.
  // `translate(cx + tx, cy + ty) rotate(r) translate(-cx, -cy) scale(z)`
  // Let's trace:
  // 1. Origin at top-left.
  // 2. Move to Center + Pan Offset: `translate(cx + tx, cy + ty)`
  //    Now origin is at the visual center of the rotated/panned object on screen.
  // 3. Rotate: `rotate(r)`
  // 4. Move back to align top-left of image to origin?
  //    `translate(-cx, -cy)`?
  //    The image was originally centered at cx,cy? No, video is full screen.
  //    Center of video is at cx,cy.
  
  // Let's verify standard video centering:
  // Video is 100vw x 100vh.
  // `translate(tx, ty)` moves it.
  
  // If we rotate:
  // We want to rotate around the center of the SCREEN, not the video?
  // "Rotate camera picture... around center of screen".
  
  // Math:
  // P_screen = R * (P_local - C) + C + Offset
  // P_screen = R * P_local - R * C + C + Offset
  
  // CSS equivalent:
  // translate(C.x + Offset.x, C.y + Offset.y) rotate(angle) translate(-C.x, -C.y)
  
  // So `translate(cx + tx, cy + ty) rotate(r) translate(-cx, -cy)`
  
  // Let's apply this change to index.html and client.js.
  
  // And for the Minimap issue:
  // "Left bottom live previewer not following rotation".
  // The minimap in `Plugins/screen-annotate/modules/ui.js` renders a preview.
  // It likely uses `state.booth.previewImage` or video feed.
  // We need to apply rotation to the minimap rendering context too.
  


  // 1. Render Current Page Strokes (Ink)
  if (!state.hideStrokes) {
      const strokes = state.getActiveStrokes();
      strokes.forEach(stroke => {
          if (stroke.type === 'pen') {
            drawStroke(stroke);     
          } else if (stroke.type === 'shape') {
            shapesModule.drawShape(ctx, stroke);
          } else if (stroke.type === 'image') {
            drawImageObj(stroke); 
          } else if (['video', 'audio', 'browser', 'link'].includes(stroke.type)) {
              // Also render these if implemented
              // Currently objects.js handles DOM elements, but maybe we want placeholders on canvas for capture?
              // For captureCanvas, DOM elements are NOT captured by toDataURL!
              // We need to draw them on canvas if we want them in the image.
              // This is a known limitation of canvas.toDataURL vs desktopCapturer.
              // If we are in Whiteboard mode, we rely on canvas.
              // So we should try to draw images/videos to canvas?
              // drawImageObj handles 'image'.
              // For 'video', we can draw current frame?
          }
      });
  }

  // 1.5 Render Pending Shape (between steps) OR Shape Preview
  if (state.currentTool === 'shape' && (state.isDrawing || state.pendingShape)) {
      // Transform mouse pos to world
      const camera = state.getActiveCamera();
      // Ensure mousePos is valid
      if (state.mousePos) {
        const mx = (state.mousePos.x - camera.x) / camera.z;
        const my = (state.mousePos.y - camera.y) / camera.z;
        
        let shape;
        
        if (state.pendingShape) {
            // Step 2: Adjust depth/height
             let dEnd = { x: mx, y: my };
             
             if (state.currentShape === 'axis-xy' || state.currentShape === 'axis-xyz') {
                 // Snap to perpendicular relative to first axis
                 dEnd = shapesModule.snapToPerpendicular(state.pendingShape.start, state.pendingShape.end, dEnd);
             } else if (state.currentShape === 'cuboid') {
                 // Snap to vertical (relative to horizontal)
                 // Reference: Horizontal line from start
                 const ref = { x: state.pendingShape.start.x + 1, y: state.pendingShape.start.y };
                 dEnd = shapesModule.snapToPerpendicular(state.pendingShape.start, ref, dEnd);
             }
             
             shape = {
                 type: 'shape',
                 shapeType: state.currentShape,
                 start: state.pendingShape.start,
                 end: state.pendingShape.end,
                 color: state.penColor,
                 size: state.penSize,
                 depthEnd: dEnd,
                 step: 2
             };
        } else if (state.isDrawing && state.shapeStart) {
             // Step 1: Dragging to draw base
             shape = {
                 type: 'shape',
                 shapeType: state.currentShape,
                 start: state.shapeStart,
                 end: { x: mx, y: my },
                 color: state.penColor,
                 size: state.penSize
             };
        }
        
        if (shape) {
            shapesModule.drawShape(ctx, shape);
        }
      }
  }

  // 2. Render Current Drawing Stroke (Pen Preview)
  if (state.isDrawing) {
      if (state.currentTool === 'pen') {
        // 复制当前点数组
        let points = [...state.currentPoints];
        
        // 检查是否有预测点，如果有则添加到数组中
        if (typeof window.lastPredictedPoint !== 'undefined' && window.lastPredictedPoint) {
          points.push(window.lastPredictedPoint);
        }
        
        const previewStroke = {
          points: points,
          color: state.penColor,
          size: state.penSize,
          taper: state.penTaper
        };
        drawStroke(previewStroke);
      } 
      // Shape handled above
  }

  // 3. Render Selection Box (if active)
  // Moved to DOM overlay, so no canvas rendering for box itself.
  
  // 4. Render Lasso Line
  if (state.isDrawing && (state.currentTool === 'select' || state.currentTool === 'lasso') && state.lassoPoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#238f4a';
      ctx.lineWidth = 2 / camera.z;
      ctx.setLineDash([5 / camera.z, 5 / camera.z]);
      
      const p0 = state.lassoPoints[0];
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < state.lassoPoints.length; i++) {
          ctx.lineTo(state.lassoPoints[i].x, state.lassoPoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Close loop visual hint
      ctx.fillStyle = 'rgba(35, 143, 74, 0.1)';
      ctx.fill();
  }
  
  // 5. Render Eraser Cursor
  if (state.currentTool === 'eraser' && state.mousePos) {
      // Check if hidden (e.g. during booth photo capture)
      if (state.booth && state.booth.hideEraserCursor) {
          // Do not render
      } else {
          // Draw eraser circle at mouse pos (inverse transform)
          const mx = (state.mousePos.x - camera.x) / camera.z;
          const my = (state.mousePos.y - camera.y) / camera.z;
          
          ctx.beginPath();
          ctx.strokeStyle = '#666';
          ctx.lineWidth = 1 / camera.z;
          ctx.arc(mx, my, state.eraserSize / 2 / camera.z, 0, Math.PI * 2);
          ctx.stroke();
      }
  }

  ctx.restore();
  
  // Update Canvas Z-Index based on Tool and Fullscreen Browser
  const fsBrowser = document.getElementById('fullscreen-browser-layer');
  if (fsBrowser && fsBrowser.style.display !== 'none') {
      if (state.currentTool === 'pen' || state.currentTool === 'eraser' || state.currentTool === 'shape') {
          canvas.style.zIndex = '95'; // Above browser (90) but below toolbar (100)
          canvas.style.pointerEvents = 'auto'; // Capture events
      } else {
          canvas.style.zIndex = '20'; // Default
          // pointer-events handled by updateObjectInteraction
      }
  } else {
      canvas.style.zIndex = '20';
  }
  if (state.currentTool === 'pan' && state.isPanning) {
    const { updateMinimap } = require('./ui');
    updateMinimap();
  }
}

function drawImageObj(obj, isSelected = false) {
    if (!obj.img) return;
    try {
        ctx.save();
        
        // Transform
        const rotation = obj.rotation || 0;
        const scaleX = obj.scaleX || 1;
        const scaleY = obj.scaleY || 1;
        
        if (rotation !== 0 || scaleX !== 1 || scaleY !== 1) {
            const cx = obj.x + obj.w / 2;
            const cy = obj.y + obj.h / 2;
            ctx.translate(cx, cy);
            ctx.rotate(rotation);
            ctx.scale(scaleX, scaleY);
            ctx.drawImage(obj.img, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
            
            if (isSelected) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(-obj.w / 2, -obj.h / 2, obj.w, obj.h);
            }
        } else {
            ctx.drawImage(obj.img, obj.x, obj.y, obj.w, obj.h);
            if (isSelected) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
            }
        }
        
        ctx.restore();
    } catch (e) {
        console.error('Error drawing image:', e);
    }
}

function drawStroke(stroke, isSelected = false, context = ctx) {
  const { points, color, size, isPointEraser, taper } = stroke;
  
  if (points.length < 2) return;

  const outlinePoints = getStroke(points, {
    size: taper ? size : Math.max(1, size - 1), // Fix: Reduce size if no taper
    thinning: taper ? 0.7 : 0,
    smoothing: stroke.smoothing !== undefined ? stroke.smoothing : 0.5,
    streamline: stroke.streamline !== undefined ? stroke.streamline : 0.5,
    start: { taper: taper ? size : 0, easing: (t) => t },
    end: { taper: taper ? size : 0, easing: (t) => t }
  });

  const pathData = utils.getSvgPathFromStroke(outlinePoints);
  const path = new Path2D(pathData);

  context.save();
  if (stroke.type === 'eraser') {
    if (isPointEraser) {
       context.globalCompositeOperation = 'destination-out';
       context.fillStyle = 'black'; 
    } else {
       context.globalCompositeOperation = 'destination-out';
       context.fillStyle = 'black';
    }
  } else {
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = color;
  }
  
  context.fill(path);

  if (isSelected) {
    context.strokeStyle = '#ffffff'; 
    context.lineWidth = 2;
    context.stroke(path);
  }

  context.restore();
}

function performEraserAction(point) {
    const strokes = state.getActiveStrokes();
    const camera = state.getActiveCamera();
    const threshold = state.eraserSize / 2 / camera.z;
    const thresholdSq = threshold * threshold;
    
    // Use eraser point in world coordinates directly
    const eraserCenter = point;

    for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
        if (stroke.type === 'shape') {
             // Check intersection with eraser circle
             if (utils.isEraserHittingShape(stroke, eraserCenter, threshold)) {
                 // Automatically convert and erase (Fix for Issue 2)
                 const shapes = require('./shapes');
                 const objects = require('./objects');
                 
                 const currentStrokes = state.getActiveStrokes();
                 
                 // Find stroke index again to be safe
                 const idx = currentStrokes.indexOf(stroke);
                 if (idx === -1) return;

                 const newStrokes = shapes.convertShapeToStrokes(stroke);
                 currentStrokes.splice(idx, 1, ...newStrokes);
                 
                 // Adjust loop index to process new strokes immediately
                 i += newStrokes.length;
                 
                 // Fix for Issue: Update minimap after erase
                 const { updateMinimap } = require('./ui');
                 updateMinimap();

                 // Continue loop to process these new strokes with eraser
                 continue;
             }
             continue;
        }

        if (stroke.type !== 'pen') continue; 
        
        let newStrokes = [];
        let currentSegment = [];
        let modified = false;
        
        // Check if we need to process this stroke at all
        // Quick bounding box check (optional but good for performance)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of stroke.points) {
             if (p.x < minX) minX = p.x;
             if (p.y < minY) minY = p.y;
             if (p.x > maxX) maxX = p.x;
             if (p.y > maxY) maxY = p.y;
        }
        // Expand bounds by threshold
        if (minX > eraserCenter.x + threshold || maxX < eraserCenter.x - threshold ||
            minY > eraserCenter.y + threshold || maxY < eraserCenter.y - threshold) {
            continue;
        }

        // Detailed Check
        let lastPoint = null;
        let lastInside = false;

        for (let j = 0; j < stroke.points.length; j++) {
            const p = stroke.points[j];
            const dx = p.x - eraserCenter.x;
            const dy = p.y - eraserCenter.y;
            const distSq = dx*dx + dy*dy;
            const isInside = distSq <= thresholdSq;

            if (j === 0) {
                if (!isInside) {
                    currentSegment.push(p);
                } else {
                    modified = true;
                }
            } else {
                // Check intersection with previous segment
                if (isInside !== lastInside) {
                    // Crossed boundary
                    const intersections = utils.getSegmentCircleIntersections(lastPoint, p, eraserCenter, threshold);
                    if (intersections.length > 0) {
                        // Usually 1 intersection if crossing once
                        // Add intersection point to the appropriate segment
                        if (lastInside && !isInside) {
                            // Exiting eraser: Start new segment with intersection
                            currentSegment.push(intersections[0]);
                            currentSegment.push(p);
                        } else {
                            // Entering eraser: End current segment with intersection
                            currentSegment.push(intersections[0]);
                            newStrokes.push({ ...stroke, points: currentSegment });
                            currentSegment = [];
                            modified = true;
                        }
                    } else {
                        // Fallback (shouldn't happen if crossing, but maybe tangential?)
                         if (!isInside) currentSegment.push(p);
                         else if (!lastInside) {
                             newStrokes.push({ ...stroke, points: currentSegment });
                             currentSegment = [];
                             modified = true;
                         }
                    }
                } else {
                    // No crossing
                    if (!isInside) {
                        // Both outside
                        // But wait, the segment *could* cross the circle and come back out?
                        // (Chord intersection).
                        // Check distance from center to line segment?
                        // For simplicity, we assume if points are close enough, checking endpoints is okay.
                        // But fast strokes might jump over.
                        // We should check intersection even if both are outside?
                        // Only if segment is long? 
                        // Let's rely on standard endpoint check for now, as user issue was about "erasing OUTSIDE",
                        // which implies we were deleting points that shouldn't be deleted, or splitting poorly.
                        // With intersection points added, we preserve the line up to the circle edge.
                        currentSegment.push(p);
                    } else {
                        // Both inside - discard
                        modified = true;
                    }
                }
            }
            
            lastPoint = p;
            lastInside = isInside;
        }
        
        if (currentSegment.length > 0) {
            newStrokes.push({ ...stroke, points: currentSegment });
        }
        
        if (modified) {
            newStrokes = newStrokes.filter(s => s.points.length > 1);
            if (newStrokes.length === 0) {
                strokes.splice(i, 1);
            } else {
                strokes.splice(i, 1, ...newStrokes);
            }
            // Fix for Issue: Update minimap after erase
            const { updateMinimap } = require('./ui');
            updateMinimap();
        }
    }
}

function fitCameraToContent() {
    // Check if in Booth Mode
    if (state.MODE === 'booth') {
        // "Reset should let camera picture and ink roam to longest edge touches screen edge and horizontally centered"
        // Booth content is fundamentally the camera feed (screen size) + ink.
        // Usually camera feed is 1920x1080 (or window size).
        // Let's assume the "Content" includes the video frame (0,0 to window.innerWidth, window.innerHeight in world coords?)
        // In booth mode, camera starts at 0,0, scale 1. Video fills screen.
        // Ink is drawn relative to this.
        
        // 1. Calculate bounding box of Ink + Video Frame
        let minX = 0;
        let minY = 0;
        let maxX = window.innerWidth;
        let maxY = window.innerHeight;
        
        const strokes = state.getActiveStrokes();
        strokes.forEach(stroke => {
            if (stroke.type === 'pen' && stroke.points) {
                stroke.points.forEach(p => {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                });
            }
            // Add other types if needed
        });
        
        // 2. Fit this bounding box to screen
        const contentW = maxX - minX;
        const contentH = maxY - minY;
        
        // "Longest edge touches screen edge" -> Contain fit
        const scaleX = window.innerWidth / contentW;
        const scaleY = window.innerHeight / contentH;
        const scale = Math.min(scaleX, scaleY);
        
        state.camera.z = scale;
        
        // "Horizontally centered"
        // Center X of content should match Center X of Screen
        // Content Center X in World = minX + contentW / 2
        // Screen Center X in World = (ScreenW / 2 - CameraX) / CameraZ
        // So: CameraX = ScreenW / 2 - (minX + contentW / 2) * CameraZ
        
        state.camera.x = window.innerWidth / 2 - (minX + contentW / 2) * scale;
        
        // Vertically? Usually center too.
        state.camera.y = window.innerHeight / 2 - (minY + contentH / 2) * scale;
        
        renderCanvas();
        require('./objects').updateDOMObjects();
        return;
    }

    const strokes = state.getActiveStrokes();
    if (strokes.length === 0) {
        state.camera = { x: 0, y: 0, z: 1 };
        renderCanvas();
        require('./objects').updateDOMObjects();
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    strokes.forEach(stroke => {
        if (stroke.type === 'pen' && stroke.points) {
            stroke.points.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });
        } else if (['image', 'video', 'audio', 'browser', 'link'].includes(stroke.type)) {
            if (stroke.x < minX) minX = stroke.x;
            if (stroke.y < minY) minY = stroke.y;
            if (stroke.x + stroke.w > maxX) maxX = stroke.x + stroke.w;
            if (stroke.y + stroke.h > maxY) maxY = stroke.y + stroke.h;
        }
    });

    if (minX === Infinity) return;

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const padding = 50;
    
    const availW = window.innerWidth - padding * 2;
    const availH = window.innerHeight - padding * 2;
    
    const scaleX = availW / contentW;
    const scaleY = availH / contentH;
    const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in too much if content is small
    
    state.camera.z = scale;
    state.camera.x = (window.innerWidth - contentW * scale) / 2 - minX * scale;
    state.camera.y = (window.innerHeight - contentH * scale) / 2 - minY * scale;
    
    renderCanvas();
    require('./objects').updateDOMObjects();
}

function captureCanvas(options = {}) {
    const { area = 'viewport', includeBackground = true, includeInk = true } = options;
    
    const dpr = window.devicePixelRatio || 1;
    const originalW = canvas.width;
    const originalH = canvas.height;
    const originalCam = { ...state.getActiveCamera() };
    
    let width = window.innerWidth;
    let height = window.innerHeight;
    let minX = 0;
    let minY = 0;
    
    if (area === 'canvas') {
        // Calculate bounds of all content
        minX = Infinity; minY = Infinity; 
        let maxX = -Infinity; maxY = -Infinity;
        
        const strokes = state.getActiveStrokes();
        if (strokes.length === 0) {
            minX = 0; minY = 0; maxX = width; maxY = height;
        } else {
            strokes.forEach(stroke => {
                if (stroke.type === 'pen' && stroke.points) {
                    stroke.points.forEach(p => {
                        if (p.x < minX) minX = p.x;
                        if (p.y < minY) minY = p.y;
                        if (p.x > maxX) maxX = p.x;
                        if (p.y > maxY) maxY = p.y;
                    });
                } else if (['image', 'video', 'audio', 'browser', 'link'].includes(stroke.type)) {
                    if (stroke.x < minX) minX = stroke.x;
                    if (stroke.y < minY) minY = stroke.y;
                    if (stroke.x + stroke.w > maxX) maxX = stroke.x + stroke.w;
                    if (stroke.y + stroke.h > maxY) maxY = stroke.y + stroke.h;
                } else if (stroke.type === 'shape') {
                     if (stroke.start) {
                         minX = Math.min(minX, stroke.start.x);
                         maxX = Math.max(maxX, stroke.start.x);
                         minY = Math.min(minY, stroke.start.y);
                         maxY = Math.max(maxY, stroke.start.y);
                     }
                     if (stroke.end) {
                         minX = Math.min(minX, stroke.end.x);
                         maxX = Math.max(maxX, stroke.end.x);
                         minY = Math.min(minY, stroke.end.y);
                         maxY = Math.max(maxY, stroke.end.y);
                     }
                }
            });
            
            if (minX === Infinity) {
                minX = 0; minY = 0; maxX = width; maxY = height;
            } else {
                const padding = 50;
                minX -= padding;
                minY -= padding;
                maxX += padding;
                maxY += padding;
            }
        }
        
        width = Math.ceil(maxX - minX);
        height = Math.ceil(maxY - minY);
        
        width = Math.max(1, width);
        height = Math.max(1, height);
        
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        
        const ctx2d = canvas.getContext('2d');
        ctx2d.scale(dpr, dpr);
        
        const cam = state.getActiveCamera();
        cam.x = -minX;
        cam.y = -minY;
        cam.z = 1;
        cam.rotation = 0;
    }
    
    if (!includeInk) state.hideStrokes = true;
    renderCanvas();
    if (!includeInk) state.hideStrokes = false;
    
    if (includeBackground && state.MODE !== 'annotate') {
        const ctx2d = canvas.getContext('2d');
        ctx2d.save();
        ctx2d.globalCompositeOperation = 'destination-over';
        const bg = state.pageBackgrounds[state.currentPageIndex] || '#071a12';
        ctx2d.fillStyle = bg;
        ctx2d.fillRect(0, 0, width, height);
        ctx2d.restore();
    }
    
    const dataUrl = canvas.toDataURL('image/png');
    
    canvas.width = originalW;
    canvas.height = originalH;
    Object.assign(state.getActiveCamera(), originalCam);
    renderCanvas();
    
    return dataUrl;
}

function autoPanOnEdge(clientX, clientY) {
    const edgeThreshold = 50; 
    const panSpeed = 10; 
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toolbarHeight = 100;
    
    let dx = 0;
    let dy = 0;
    
    if (clientX < edgeThreshold) dx = panSpeed;
    if (clientX > w - edgeThreshold) dx = -panSpeed;
    if (clientY < edgeThreshold) dy = panSpeed;
    if (clientY > h - toolbarHeight) dy = -panSpeed;
    
    if (dx !== 0 || dy !== 0) {
        const camera = state.getActiveCamera();
        camera.x += dx;
        camera.y += dy;
        return true;
    }
    return false;
}

module.exports = {
    canvas,
    ctx,
    resizeCanvas,
    renderCanvas,
    drawStroke,
    drawImageObj,
    performEraserAction,
    fitCameraToContent,
    autoPanOnEdge,
    captureCanvas,
    initRenderer,
    setRenderMode,
    getRenderMode
};
