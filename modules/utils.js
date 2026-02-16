const state = require('./state');

function getPoint(e) {
  const camera = state.getActiveCamera();
  return {
    x: (e.clientX - camera.x) / camera.z,
    y: (e.clientY - camera.y) / camera.z,
    pressure: e.pressure || 0.5
  };
}

function getScreenCenterWorld() {
    return {
        x: (window.innerWidth / 2 - state.camera.x) / state.camera.z,
        y: (window.innerHeight / 2 - state.camera.y) / state.camera.z
    };
}

function getFittedSize(srcW, srcH) {
    // If invalid dimensions, return default
    if (!srcW || !srcH) return { w: 200, h: 150 };
    
    const maxWidth = (window.innerWidth * 0.8) / state.camera.z;
    const maxHeight = (window.innerHeight * 0.8) / state.camera.z;
    let w = srcW;
    let h = srcH;
    
    // Scale down if too big
    const ratio = Math.min(maxWidth / w, maxHeight / h);
    if (ratio < 1) {
        w *= ratio;
        h *= ratio;
    }
    
    return { w, h };
}

function isPointInPolygon(point, vs) {
    var x = point.x, y = point.y;
    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i].x, yi = vs[i].y;
        var xj = vs[j].x, yj = vs[j].y;
        var intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function isPointInRect(p, rect) {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

function getHitHandle(point) {
  if (!state.selectionBounds) return -1;
  const r = 10 / state.camera.z; // Handle radius in world space
  const handles = [
    { x: state.selectionBounds.x, y: state.selectionBounds.y }, // TL
    { x: state.selectionBounds.x + state.selectionBounds.w, y: state.selectionBounds.y }, // TR
    { x: state.selectionBounds.x + state.selectionBounds.w, y: state.selectionBounds.y + state.selectionBounds.h }, // BR
    { x: state.selectionBounds.x, y: state.selectionBounds.y + state.selectionBounds.h } // BL
  ];

  for (let i = 0; i < 4; i++) {
    const h = handles[i];
    if (Math.hypot(point.x - h.x, point.y - h.y) < r) return i;
  }
  return -1;
}

function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return '';

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );

  d.push('Z');
  return d.join(' ');
}

function getSegmentCircleIntersections(p1, p2, center, r) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const fx = p1.x - center.x;
    const fy = p1.y - center.y;

    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = (fx * fx + fy * fy) - r * r;

    let discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
        return [];
    }

    discriminant = Math.sqrt(discriminant);
    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);

    const points = [];
    if (t1 >= 0 && t1 <= 1) {
        points.push({ x: p1.x + t1 * dx, y: p1.y + t1 * dy, pressure: p1.pressure });
    }
    if (t2 >= 0 && t2 <= 1) {
        points.push({ x: p1.x + t2 * dx, y: p1.y + t2 * dy, pressure: p2.pressure });
    }
    return points;
}

function isPointInShape(point, shape) {
    const { shapeType, start, end } = shape;
    if (!start || !end) return false;

    const w = end.x - start.x;
    const h = end.y - start.y;

    if (shapeType === 'rect' || shapeType === 'cuboid') {
        // Simple rect check (for cuboid, just check front face for now, or bounding box?)
        // Let's use bounding box of start/end.
        // Note: w/h can be negative.
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(w);
        const height = Math.abs(h);
        return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
    } else if (shapeType === 'square') {
        const s = Math.max(Math.abs(w), Math.abs(h));
        const sx = w < 0 ? -s : s;
        const sy = h < 0 ? -s : s;
        const x = Math.min(start.x, start.x + sx);
        const y = Math.min(start.y, start.y + sy);
        return point.x >= x && point.x <= x + s && point.y >= y && point.y <= y + s;
    } else if (shapeType === 'circle') {
        const s = Math.max(Math.abs(w), Math.abs(h));
        const sx = w < 0 ? -s : s;
        const sy = h < 0 ? -s : s;
        const cx = start.x + sx/2;
        const cy = start.y + sy/2;
        const r = Math.abs(sx/2);
        return Math.hypot(point.x - cx, point.y - cy) <= r;
    } else if (shapeType === 'ellipse' || shapeType === 'cone') {
        // Cone base is ellipse
        const cx = start.x + w/2;
        const cy = start.y + h/2;
        const rx = Math.abs(w/2);
        const ry = Math.abs(h/2);
        if (rx === 0 || ry === 0) return false;
        return (Math.pow(point.x - cx, 2) / (rx * rx) + Math.pow(point.y - cy, 2) / (ry * ry)) <= 1;
    } else if (shapeType === 'line' || shapeType === 'arrow' || shapeType === 'double-arrow' || shapeType === 'axis-xy' || shapeType === 'axis-xyz') {
        // Distance to line segment
        // Threshold
        const threshold = (shape.size || 5) + 5; 
        return distToSegmentSquared(point, start, end) < threshold * threshold;
    } else if (shapeType === 'triangle') {
        const p1 = { x: start.x + w/2, y: start.y };
        const p2 = { x: start.x, y: start.y + h };
        const p3 = { x: start.x + w, y: start.y + h };
        return isPointInPolygon(point, [p1, p2, p3]);
    }
    
    return false;
}

function distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 == 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
}

function isEraserHittingShape(shape, eraserCenter, threshold) {
    // Check if eraser circle intersects shape
    // Simple approach: Check if shape contains eraser center (for filled shapes)
    // or if distance to shape < threshold (for lines)
    // But shapes are currently "hollow" or "filled"?
    // Canvas draw is "stroke" only in drawShape (except maybe fill?).
    // shapes.js only does ctx.stroke(). So they are hollow.
    // So we should check distance to border?
    // User probably expects "touching" the line deletes it.
    
    // For simplicity, let's reuse isPointInShape for "inside" check, 
    // but strictly speaking for hollow shapes we want "on border".
    // However, isPointInShape for rect/circle above checks "inside".
    // If shapes are hollow, deleting by clicking inside is convenient.
    // But erasing by dragging inside might be annoying if you want to erase text inside?
    // But text is not part of shape.
    // Let's stick to "touching bounding box or inside" for now.
    // For lines, isPointInShape checks distance.
    
    // Actually, let's just use isPointInShape with a slightly expanded point (eraser size).
    // Or just pass eraserCenter to isPointInShape.
    // If eraser is large, we should check if circle overlaps shape.
    // But point check is often enough if user moves mouse over it.
    
    // Exception: For hollow rect, if I erase inside, should it delete?
    // If I want to keep the rect but erase something inside it (like ink), 
    // I don't want to delete rect.
    // So for hollow shapes, we should check distance to edges.
    
    const { shapeType, start, end } = shape;
    if (!start || !end) return false;
    
    // For Line/Arrow: isPointInShape is distance based, so it's fine.
    if (['line', 'arrow', 'double-arrow', 'axis-xy', 'axis-xyz'].includes(shapeType)) {
        return isPointInShape(eraserCenter, shape); // shape.size is used as threshold base
    }
    
    // For closed shapes (Rect, Circle, Triangle...)
    // Check if eraser touches the *outline*.
    // We can iterate edges for Polygon-like shapes (Rect, Triangle).
    // For Circle/Ellipse/Cone, check distance from center approx radius.
    
    const w = end.x - start.x;
    const h = end.y - start.y;
    const thresholdSq = threshold * threshold;

    if (shapeType === 'rect' || shapeType === 'cuboid' || shapeType === 'square') {
        let x, y, width, height;
        if (shapeType === 'square') {
            const s = Math.max(Math.abs(w), Math.abs(h));
            const sx = w < 0 ? -s : s;
            const sy = h < 0 ? -s : s;
            x = start.x; y = start.y; width = sx; height = sy;
        } else {
            x = start.x; y = start.y; width = w; height = h;
        }
        
        // 4 segments
        const p1 = {x, y};
        const p2 = {x: x+width, y};
        const p3 = {x: x+width, y: y+height};
        const p4 = {x, y: y+height};
        
        if (distToSegmentSquared(eraserCenter, p1, p2) < thresholdSq) return true;
        if (distToSegmentSquared(eraserCenter, p2, p3) < thresholdSq) return true;
        if (distToSegmentSquared(eraserCenter, p3, p4) < thresholdSq) return true;
        if (distToSegmentSquared(eraserCenter, p4, p1) < thresholdSq) return true;
        return false;
    } else if (shapeType === 'triangle') {
        const p1 = { x: start.x + w/2, y: start.y };
        const p2 = { x: start.x, y: start.y + h };
        const p3 = { x: start.x + w, y: start.y + h };
        
        if (distToSegmentSquared(eraserCenter, p1, p2) < thresholdSq) return true;
        if (distToSegmentSquared(eraserCenter, p2, p3) < thresholdSq) return true;
        if (distToSegmentSquared(eraserCenter, p3, p1) < thresholdSq) return true;
        return false;
    } else if (shapeType === 'circle') {
         const s = Math.max(Math.abs(w), Math.abs(h));
         const r = Math.abs(s/2);
         const cx = start.x + (w < 0 ? -s : s)/2;
         const cy = start.y + (h < 0 ? -s : s)/2;
         
         const dist = Math.hypot(eraserCenter.x - cx, eraserCenter.y - cy);
         return Math.abs(dist - r) < threshold;
    }
    
    // Fallback: use isPointInShape (inside check)
    return isPointInShape(eraserCenter, shape);
}

module.exports = {
    getPoint,
    getScreenCenterWorld,
    getFittedSize,
    isPointInPolygon,
    isPointInRect,
    getHitHandle,
    getSvgPathFromStroke,
    getSegmentCircleIntersections,
    isPointInShape,
    isEraserHittingShape
};