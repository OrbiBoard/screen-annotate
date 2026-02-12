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
    const maxWidth = (window.innerWidth * 0.8) / state.camera.z;
    const maxHeight = (window.innerHeight * 0.8) / state.camera.z;
    let w = srcW;
    let h = srcH;
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

module.exports = {
    getPoint,
    getScreenCenterWorld,
    getFittedSize,
    isPointInPolygon,
    isPointInRect,
    getHitHandle,
    getSvgPathFromStroke,
    getSegmentCircleIntersections
};