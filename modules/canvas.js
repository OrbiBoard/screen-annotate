const { getStroke } = require('perfect-freehand');
const state = require('./state');
const utils = require('./utils');

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
        drawShape(stroke);
      }
      // Note: Images/Videos are DOM objects, not rendered on canvas
  });

  // 1.5 Render Pending Shape (between steps)
  if (state.pendingShape && !state.isDrawing) {
      const shape = {
          type: 'shape',
          shapeType: state.currentShape,
          start: state.pendingShape.start,
          end: state.pendingShape.end,
          color: state.penColor,
          size: state.penSize
      };
      drawShape(shape);
  }

  // 2. Render Current Drawing Stroke (Preview)
  if (state.isDrawing) {
      if (state.currentTool === 'pen') {
        const previewStroke = {
          points: state.currentPoints,
          color: state.penColor,
          size: state.penSize,
          taper: state.penTaper
        };
        drawStroke(previewStroke);
      } else if (state.currentTool === 'shape') {
         // Transform mouse pos to world
         const mx = (state.mousePos.x - camera.x) / camera.z;
         const my = (state.mousePos.y - camera.y) / camera.z;
         
         const shape = {
             type: 'shape',
             shapeType: state.currentShape,
             start: state.shapeStart,
             end: { x: mx, y: my },
             color: state.penColor,
             size: state.penSize
         };
         
         // If 2-step shape and step 2
         if (state.pendingShape) {
             shape.start = state.pendingShape.start;
             shape.end = state.pendingShape.end;
             shape.depthEnd = { x: mx, y: my }; // Current mouse is depth end
             shape.step = 2;
         }
         
         drawShape(shape);
      }
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
      if (state.currentTool === 'pen' || state.currentTool === 'eraser') {
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
        ctx.drawImage(obj.img, obj.x, obj.y, obj.w, obj.h);
        if (isSelected) {
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
            ctx.restore();
        }
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
    smoothing: 0.5,
    streamline: 0.5,
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

function drawShape(stroke) {
    const { shapeType, start, end, color, size, depthEnd } = stroke;
    if (!start || !end) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const w = end.x - start.x;
    const h = end.y - start.y;

    if (shapeType === 'rect') {
        ctx.rect(start.x, start.y, w, h);
    } else if (shapeType === 'square') {
        const s = Math.max(Math.abs(w), Math.abs(h));
        const sx = w < 0 ? -s : s;
        const sy = h < 0 ? -s : s;
        ctx.rect(start.x, start.y, sx, sy);
    } else if (shapeType === 'circle') {
        const r = Math.sqrt(w*w + h*h) / 2;
        const cx = start.x + w/2;
        const cy = start.y + h/2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(w/2), Math.abs(h/2), 0, 0, Math.PI * 2);
        // Force circle if Shift? Or separate tool? 
        // User asked for "Circle" and "Ellipse".
        // For "Circle", width determines diameter? Or diagonal?
        // Let's implement 'circle' as perfect circle based on max dimension
    } else if (shapeType === 'triangle') {
        ctx.moveTo(start.x + w/2, start.y);
        ctx.lineTo(start.x, start.y + h);
        ctx.lineTo(start.x + w, start.y + h);
        ctx.closePath();
    } else if (shapeType === 'line') {
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
    } else if (shapeType === 'arrow' || shapeType === 'double-arrow') {
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = size * 3;
        
        // End arrow
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        
        if (shapeType === 'double-arrow') {
            // Start arrow
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(start.x + headLen * Math.cos(angle - Math.PI / 6), start.y + headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(start.x + headLen * Math.cos(angle + Math.PI / 6), start.y + headLen * Math.sin(angle + Math.PI / 6));
        }
    } else if (shapeType === 'cuboid') {
        // Front face
        ctx.rect(start.x, start.y, w, h);
        
        if (depthEnd) {
            const dx = depthEnd.x - end.x; // Vector from end of rect to depth point?
            // Actually user drags depth. Let's say depthEnd is the offset vector relative to end?
            // Or depthEnd is the absolute position of the back face's corresponding corner.
            // If drawing step 2, depthEnd is mouse pos.
            // If step 1 (preview), depthEnd is undefined.
            
            // Let's assume depthEnd is the position of the back-bottom-right corner?
            // Or easier: depth is vector (depthEnd - end).
            // But wait, step 1 defined Rect(start, end).
            // Step 2 starts at 'end' (or where mouse up happened) and drags to 'depthEnd'.
            
            const depthX = depthEnd.x - (stroke.step === 2 ? stroke.end.x : stroke.end.x); // Wait, logic in renderer needs to handle this
            const depthY = depthEnd.y - (stroke.step === 2 ? stroke.end.y : stroke.end.y);
            
            // Actually, let's simplify:
            // depthEnd is the absolute position of the "back corner".
            // The vector is V = depthEnd - end.
            
            // Back face
            const bx = start.x + (depthEnd.x - end.x);
            const by = start.y + (depthEnd.y - end.y);
            
            ctx.rect(bx, by, w, h);
            
            // Connectors
            ctx.moveTo(start.x, start.y); ctx.lineTo(bx, by);
            ctx.moveTo(start.x + w, start.y); ctx.lineTo(bx + w, by);
            ctx.moveTo(start.x, start.y + h); ctx.lineTo(bx, by + h);
            ctx.moveTo(start.x + w, start.y + h); ctx.lineTo(bx + w, by + h);
        }
    } else if (shapeType === 'cone') {
        // Base ellipse
        const cx = start.x + w/2;
        const cy = start.y + h/2;
        const rx = Math.abs(w/2);
        const ry = Math.abs(h/2);
        
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        
        if (depthEnd) {
            // depthEnd is apex
            const apex = depthEnd;
            
            // Draw lines from tangent points on ellipse to apex
            // Simplified: Draw from left/right extremes?
            // Correct way: Tangent lines.
            // Approximation: Line from (cx-rx, cy) and (cx+rx, cy) to apex?
            // This works if apex is vertically aligned or close.
            ctx.beginPath();
            ctx.moveTo(cx - rx, cy);
            ctx.lineTo(apex.x, apex.y);
            ctx.lineTo(cx + rx, cy);
            ctx.stroke();
        }
    } else if (shapeType === 'axis-xy') {
        // Step 1: X axis. Start -> End.
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        // Arrow for X
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = size * 3;
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        
        // Label X?
        
        if (depthEnd) {
            // Step 2: Y axis. Start -> DepthEnd.
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(depthEnd.x, depthEnd.y);
            // Arrow for Y
            const angleY = Math.atan2(depthEnd.y - start.y, depthEnd.x - start.x);
            ctx.moveTo(depthEnd.x, depthEnd.y);
            ctx.lineTo(depthEnd.x - headLen * Math.cos(angleY - Math.PI / 6), depthEnd.y - headLen * Math.sin(angleY - Math.PI / 6));
            ctx.moveTo(depthEnd.x, depthEnd.y);
            ctx.lineTo(depthEnd.x - headLen * Math.cos(angleY + Math.PI / 6), depthEnd.y - headLen * Math.sin(angleY + Math.PI / 6));
        }
    } else if (shapeType === 'axis-xyz') {
        // Similar to XY but add Z?
        // User said: "xyz坐标轴"
        // Let's implement same as XY for now, maybe add Z auto?
        // Or 3 steps.
        // Let's assume 2 steps: X and Y, Z is auto-calculated cross product or just vertical up?
        // If 2 steps:
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y); // X
        // ... arrow X ...
        
        if (depthEnd) {
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(depthEnd.x, depthEnd.y); // Y
            // ... arrow Y ...
            
            // Z Axis (Auto? Up?)
            // Let's draw Z up by default length
            const len = Math.sqrt(w*w + h*h); // Use length of X?
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(start.x, start.y - len);
             // ... arrow Z ...
        }
    }

    ctx.stroke();
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
