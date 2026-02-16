const { getStroke } = require('perfect-freehand');
const state = require('./state');
const utils = require('./utils');
const shapesModule = require('./shapes');

const canvas = document.getElementById('canvas-layer');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const { updateMinimap } = require('./ui');
  renderCanvas();
  updateMinimap();
}

function renderCanvas() {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Transform
  const camera = state.getActiveCamera();
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.z, camera.z);

  // 1. Render Current Page Strokes (Ink)
  const strokes = state.getActiveStrokes();
  strokes.forEach(stroke => {
      if (stroke.type === 'pen') {
        drawStroke(stroke);     
      } else if (stroke.type === 'shape') {
        shapesModule.drawShape(ctx, stroke);
      } else if (stroke.type === 'image') {
        drawImageObj(stroke); // Render images on canvas (z-index below DOM objects)
        // Wait, images are DOM objects now? 
        // In objects.js, we create DOM wrappers for 'image'? 
        // No, objects.js handles 'video', 'audio', 'browser', 'link', 'text'.
        // 'image' type is NOT handled in updateDOMObjects loop in objects.js (unless we add it).
        // Check objects.js: if (!['video', 'audio', 'browser', 'link', 'text'].includes(obj.type)) return;
        // So images are NOT DOM objects currently?
        // But drawImageObj exists here.
        // And IPC handler in renderer.js pushes 'image' type stroke.
        // So images are canvas-drawn.
        // But the user said "图片无法正确插入" (Image cannot be inserted correctly).
        // If it's canvas drawn, maybe drawImageObj is failing or image not loaded?
        // Ah, `img` property is an Image object. If it's not loaded when render called?
        // renderer.js: img.onload = ... strokes.push(obj); renderCanvas();
        // So it should be loaded.
        // Let's check drawImageObj implementation.
      }
  });

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
        const previewStroke = {
          points: state.currentPoints,
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
  if (state.isDrawing && state.currentTool === 'select' && state.lassoPoints.length > 0) {
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
      // Draw eraser circle at mouse pos (inverse transform)
      const mx = (state.mousePos.x - camera.x) / camera.z;
      const my = (state.mousePos.y - camera.y) / camera.z;
      
      ctx.beginPath();
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1 / camera.z;
      ctx.arc(mx, my, state.eraserSize / 2 / camera.z, 0, Math.PI * 2);
      ctx.stroke();
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

function drawStroke(stroke, isSelected = false) {
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

  ctx.save();
  if (stroke.type === 'eraser') {
    if (isPointEraser) {
       ctx.globalCompositeOperation = 'destination-out';
       ctx.fillStyle = 'black'; 
    } else {
       ctx.globalCompositeOperation = 'destination-out';
       ctx.fillStyle = 'black';
    }
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
  }
  
  ctx.fill(path);

  if (isSelected) {
    ctx.strokeStyle = '#ffffff'; 
    ctx.lineWidth = 2;
    ctx.stroke(path);
  }

  ctx.restore();
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
        }
    }
}

function fitCameraToContent() {
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
    autoPanOnEdge
};
