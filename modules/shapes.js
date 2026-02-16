const SHAPE_NAMES = {
    'line': '直线', 'arrow': '单箭头', 'double-arrow': '双箭头',
    'rect': '矩形', 'square': '正方形', 'triangle': '三角形',
    'circle': '圆形', 'ellipse': '椭圆',
    'parallelogram': '平行四边形',
    'pentagon': '五边形', 'hexagon': '六边形',
    'cuboid': '长方体', 'cone': '圆锥', 'axis-xy': 'XY坐标轴', 'axis-xyz': 'XYZ坐标轴'
};

const COMPLEX_SHAPES = ['cuboid', 'cone', 'axis-xy', 'axis-xyz'];

function isComplexShape(type) {
    return COMPLEX_SHAPES.includes(type);
}

function getShapeSteps(shapeType) {
    const isMultiStep = isComplexShape(shapeType);
    return isMultiStep ? [
        { id: 1, desc: '绘制底面/主视图' },
        { id: 2, desc: '调整深度/高度' }
    ] : [
        { id: 1, desc: '拖拽绘制' }
    ];
}

function adjustShapePoints(shapeType, start, end) {
    if (shapeType === 'square' || shapeType === 'circle' || shapeType === 'pentagon' || shapeType === 'hexagon') {
        const w = end.x - start.x;
        const h = end.y - start.y;
        const s = Math.max(Math.abs(w), Math.abs(h));
        return {
            x: start.x + (w < 0 ? -s : s),
            y: start.y + (h < 0 ? -s : s)
        };
    }
    return end;
}

function snapToPerpendicular(start, referenceEnd, current) {
    const angle1 = Math.atan2(referenceEnd.y - start.y, referenceEnd.x - start.x);
    const angle2 = Math.atan2(current.y - start.y, current.x - start.x);
    
    let diff = angle2 - angle1;
    // Normalize to -PI to PI
    while (diff <= -Math.PI) diff += 2*Math.PI;
    while (diff > Math.PI) diff -= 2*Math.PI;
    
    const threshold = 10 * (Math.PI / 180); // 10 degrees
    
    let targetAngle = null;
    if (Math.abs(diff - Math.PI/2) < threshold) {
        targetAngle = angle1 + Math.PI/2;
    } else if (Math.abs(diff + Math.PI/2) < threshold) {
        targetAngle = angle1 - Math.PI/2;
    } else if (Math.abs(diff) < threshold) { // Snap to parallel?
         // Optional: Snap to 0 degrees (Collinear)
    } else if (Math.abs(Math.abs(diff) - Math.PI) < threshold) {
         // Optional: Snap to 180 degrees
    }
    
    if (targetAngle !== null) {
        const dist = Math.hypot(current.x - start.x, current.y - start.y);
        return {
            x: start.x + dist * Math.cos(targetAngle),
            y: start.y + dist * Math.sin(targetAngle)
        };
    }
    
    return current;
}

function getPolygonVertices(shapeType, start, end) {
    const w = end.x - start.x;
    const h = end.y - start.y;
    const cx = start.x + w / 2;
    const cy = start.y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    
    const vertices = [];
    let sides = 3;
    let angleOffset = -Math.PI / 2; // Start at top
    
    if (shapeType === 'triangle') sides = 3;
    else if (shapeType === 'pentagon') sides = 5;
    else if (shapeType === 'hexagon') sides = 6;
    
    for (let i = 0; i < sides; i++) {
        const theta = angleOffset + (i * 2 * Math.PI / sides);
        vertices.push({
            x: cx + rx * Math.cos(theta),
            y: cy + ry * Math.sin(theta)
        });
    }
    return vertices;
}

function drawShape(ctx, stroke) {
    const { shapeType, start, end, color, size, depthEnd, vertices, skewX } = stroke;
    if (!start || !end) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const w = end.x - start.x;
    const h = end.y - start.y;

    if (vertices && vertices.length > 0) {
        // Draw custom vertices (Triangle, Pentagon, Hexagon after adjustment)
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
            ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        ctx.closePath();
    } else if (shapeType === 'rect') {
        ctx.rect(start.x, start.y, w, h);
    } else if (shapeType === 'square') {
        const s = Math.max(Math.abs(w), Math.abs(h));
        const sx = w < 0 ? -s : s;
        const sy = h < 0 ? -s : s;
        ctx.rect(start.x, start.y, sx, sy);
    } else if (shapeType === 'parallelogram') {
        const skewOffset = (stroke.skewX || 0) * w;
        ctx.moveTo(start.x + skewOffset, start.y);
        ctx.lineTo(start.x + w + skewOffset, start.y);
        ctx.lineTo(start.x + w - skewOffset, start.y + h);
        ctx.lineTo(start.x - skewOffset, start.y + h);
        ctx.closePath();
    } else if (shapeType === 'triangle' || shapeType === 'pentagon' || shapeType === 'hexagon') {
        const v = stroke.vertices || getPolygonVertices(shapeType, start, end);
        ctx.moveTo(v[0].x, v[0].y);
        for (let i = 1; i < v.length; i++) {
            ctx.lineTo(v[i].x, v[i].y);
        }
        ctx.closePath();
    } else if (shapeType === 'circle') {
        const s = Math.max(Math.abs(w), Math.abs(h));
        const sx = w < 0 ? -s : s;
        const sy = h < 0 ? -s : s;
        
        const cx = start.x + sx/2;
        const cy = start.y + sy/2;
        const r = Math.abs(sx/2);
        
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (shapeType === 'ellipse') {
        const cx = start.x + w/2;
        const cy = start.y + h/2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(w/2), Math.abs(h/2), 0, 0, Math.PI * 2);
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
            // Calculate depth vector relative to end point
            const dx = depthEnd.x - (stroke.step === 2 ? stroke.end.x : end.x);
            const dy = depthEnd.y - (stroke.step === 2 ? stroke.end.y : end.y);
            
            // For preview (stroke.step is undefined or handled in renderCanvas), 
            // if we are dragging depth, depthEnd is mouse pos, end is fixed.
            // So depth vector is depthEnd - end.
            
            // Back face top-left
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
        ctx.beginPath(); // New path for lines
        
        if (depthEnd) {
            const apex = depthEnd;
            ctx.moveTo(cx - rx, cy);
            ctx.lineTo(apex.x, apex.y);
            ctx.lineTo(cx + rx, cy);
        }
    } else if (shapeType === 'axis-xy') {
        // Step 1: X axis
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        // Arrow for X
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = size * 3;
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        
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
        // Step 1: X axis
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = size * 3;
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));

        if (depthEnd) {
             // Y axis
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(depthEnd.x, depthEnd.y);
            const angleY = Math.atan2(depthEnd.y - start.y, depthEnd.x - start.x);
            ctx.moveTo(depthEnd.x, depthEnd.y);
            ctx.lineTo(depthEnd.x - headLen * Math.cos(angleY - Math.PI / 6), depthEnd.y - headLen * Math.sin(angleY - Math.PI / 6));
            ctx.moveTo(depthEnd.x, depthEnd.y);
            ctx.lineTo(depthEnd.x - headLen * Math.cos(angleY + Math.PI / 6), depthEnd.y - headLen * Math.sin(angleY + Math.PI / 6));
            
            // Z axis (Auto - Upward/Outward?)
            const lenX = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
            const lenY = Math.sqrt(Math.pow(depthEnd.x - start.x, 2) + Math.pow(depthEnd.y - start.y, 2));
            const lenZ = (lenX + lenY) / 2;
            
            // Draw Z pointing UP relative to screen (negative Y)
            const zEnd = { x: start.x, y: start.y - lenZ };
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(zEnd.x, zEnd.y);
            // Arrow Z
             const angleZ = -Math.PI / 2;
            ctx.moveTo(zEnd.x, zEnd.y);
            ctx.lineTo(zEnd.x - headLen * Math.cos(angleZ - Math.PI / 6), zEnd.y - headLen * Math.sin(angleZ - Math.PI / 6));
            ctx.moveTo(zEnd.x, zEnd.y);
            ctx.lineTo(zEnd.x - headLen * Math.cos(angleZ + Math.PI / 6), zEnd.y - headLen * Math.sin(angleZ + Math.PI / 6));
        }
    }

    ctx.stroke();
    ctx.restore();
}

function convertShapeToStrokes(stroke) {
    const paths = [];
    let currentPath = [];
    
    const addLine = (p1, p2) => {
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.ceil(dist / 5); // Higher density for better fidelity
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            currentPath.push({
                x: p1.x + (p2.x - p1.x) * t,
                y: p1.y + (p2.y - p1.y) * t,
                pressure: 0.5
            });
        }
    };
    
    const mockCtx = {
        save: () => {},
        restore: () => {},
        beginPath: () => { currentPath = []; },
        moveTo: (x, y) => { 
            if (currentPath.length > 0) paths.push([...currentPath]);
            currentPath = [{x, y, pressure: 0.5}]; 
        },
        lineTo: (x, y) => {
            if (currentPath.length === 0) {
                currentPath = [{x, y, pressure: 0.5}];
                return;
            }
            const last = currentPath[currentPath.length - 1];
            addLine(last, {x, y});
        },
        rect: (x, y, w, h) => {
            if (currentPath.length > 0) paths.push([...currentPath]);
            currentPath = [{x, y, pressure: 0.5}]; // Start
            
            // Top
            addLine({x, y}, {x: x+w, y});
            // Right
            addLine({x: x+w, y}, {x: x+w, y: y+h});
            // Bottom
            addLine({x: x+w, y: y+h}, {x, y: y+h});
            // Left (Close)
            addLine({x, y: y+h}, {x, y});
            
            paths.push([...currentPath]);
            currentPath = [];
        },
        arc: (cx, cy, r, startAngle, endAngle) => {
            if (currentPath.length > 0) paths.push([...currentPath]);
            currentPath = [];
            const steps = 72; // More steps for circle
            for (let i = 0; i <= steps; i++) {
                const theta = startAngle + (endAngle - startAngle) * (i / steps);
                const px = cx + r * Math.cos(theta);
                const py = cy + r * Math.sin(theta);
                currentPath.push({x: px, y: py, pressure: 0.5});
            }
            paths.push([...currentPath]);
            currentPath = [];
        },
        ellipse: (cx, cy, rx, ry, rot, startAngle, endAngle) => {
            if (currentPath.length > 0) paths.push([...currentPath]);
            currentPath = [];
            const steps = 72;
            for (let i = 0; i <= steps; i++) {
                const theta = startAngle + (endAngle - startAngle) * (i / steps);
                const px = cx + rx * Math.cos(theta);
                const py = cy + ry * Math.sin(theta);
                currentPath.push({x: px, y: py, pressure: 0.5});
            }
            paths.push([...currentPath]);
            currentPath = [];
        },
        closePath: () => {
            if (currentPath.length > 0) {
                const first = currentPath[0];
                const last = currentPath[currentPath.length - 1];
                if (first.x !== last.x || first.y !== last.y) {
                    addLine(last, first);
                }
                paths.push([...currentPath]);
                currentPath = [];
            }
        },
        stroke: () => {
            if (currentPath.length > 0) {
                paths.push([...currentPath]);
                currentPath = [];
            }
        },
        strokeStyle: null,
        lineWidth: null,
        lineCap: null,
        lineJoin: null
    };
    
    drawShape(mockCtx, stroke);
    
    // Capture any remaining path
    if (currentPath.length > 0) paths.push([...currentPath]);

    return paths.map(points => ({
        type: 'pen',
        points: points,
        color: stroke.color,
        size: stroke.size,
        taper: false,
        smoothing: 0,
        streamline: 0
    }));
}

module.exports = {
    SHAPE_NAMES,
    COMPLEX_SHAPES,
    isComplexShape,
    getShapeSteps,
    adjustShapePoints,
    snapToPerpendicular,
    getPolygonVertices,
    drawShape,
    convertShapeToStrokes
};
