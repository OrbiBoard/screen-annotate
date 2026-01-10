const { ipcRenderer, clipboard, nativeImage } = require('electron');
const { getStroke } = require('perfect-freehand');

// --- Configuration & State ---
const urlParams = new URLSearchParams(window.location.search);
const MODE = urlParams.get('mode') || 'whiteboard'; // 'annotate' or 'whiteboard'

const canvas = document.getElementById('canvas-layer');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('main-toolbar');
const pageControls = document.getElementById('page-controls');
const leftControls = document.getElementById('left-controls');

// State
let pages = [[]]; // Array of strokes for each page
let currentPageIndex = 0;
let redoStack = []; // For current page
let isDrawing = false;
let currentPoints = [];

// Tool State
let currentTool = MODE === 'annotate' ? 'mouse' : 'pen'; // 'pen', 'eraser', 'select', 'pan', 'mouse'
let penColor = '#ffffff';
let penSize = 4;
let eraserType = 'stroke'; // 'stroke' or 'point'
let eraserSize = 20;

// Camera (Pan/Zoom)
let camera = { x: 0, y: 0, z: 1 };
let isPanning = false;
let panStart = { x: 0, y: 0 };

// --- UI Initialization ---

function initUI() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  if (MODE === 'annotate') {
    setupAnnotateUI();
    // Transparent window needs special mouse handling
    setupMousePassthrough();
  } else {
    setupWhiteboardUI();
    pageControls.style.display = 'flex';
    leftControls.style.display = 'flex';
    canvas.style.backgroundColor = 'var(--bg)'; // Opaque background for whiteboard
  }

  renderToolbar();
  renderCanvas();
}

function setupAnnotateUI() {
  // Annotation specific logic
  // "When page has no ink: Start Annotate, Close"
  // "When page has ink: Annotate, Clear, Close, Hide"
  // Actually user said: "Select changed to Mouse button... click to exit annotation mode"
  // Implementation: The toolbar will dynamic update based on state.
}

function setupWhiteboardUI() {
  // Whiteboard specific logic
}

function setupMousePassthrough() {
  // Only for annotate mode
  const container = document.querySelector('.toolbar-container');
  
  container.addEventListener('mouseenter', () => {
    ipcRenderer.send('annotate-set-ignore-mouse-events', false);
  });
  
  container.addEventListener('mouseleave', () => {
    // If we are in 'mouse' mode, we ignore mouse on the canvas area
    if (currentTool === 'mouse') {
      ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
    }
  });

  // Initial state
  if (currentTool === 'mouse') {
    ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
  }
}

// --- Tools & Toolbar ---

const TOOLS = {
  annotate: [
    { id: 'mouse', icon: 'ri-cursor-line', label: '鼠标' },
    { id: 'pen', icon: 'ri-pencil-fill', label: '批注' },
    { id: 'eraser', icon: 'ri-eraser-line', label: '橡皮' },
    // { id: 'pan', icon: 'ri-hand-coin-line', label: 'Roam' }, // User said no roam in annotate
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
    { id: 'pan', icon: 'ri-hand-coin-line', label: '漫游' },
    { id: 'undo', icon: 'ri-arrow-go-back-line', label: '撤销' },
    { id: 'redo', icon: 'ri-arrow-go-forward-line', label: '还原' }
  ]
};

function renderToolbar() {
  toolbar.innerHTML = '';
  
  let toolSet = MODE === 'annotate' ? TOOLS.annotate : TOOLS.whiteboard;

  // Filter tools based on user requirement for Annotate mode
  if (MODE === 'annotate') {
    const hasInk = pages[currentPageIndex].length > 0;
    if (!hasInk && currentTool === 'mouse') {
       // "When no ink: Start Annotate (Pen), Close"
       // But we need a way to switch to Pen.
       // Let's just show 'Pen' and 'Close'.
       // User said: "When page no ink: Start Annotate, Close".
       // "Start Annotate" implies switching to Pen tool.
       toolSet = [
         { id: 'pen', icon: 'ri-pencil-fill', label: '开始批注' },
         { id: 'close', icon: 'ri-close-circle-line', label: '关闭' }
       ];
    } else {
       // "When has ink: Annotate, Clear, Close... + Mouse to exit"
       toolSet = TOOLS.annotate;
    }
  }

  toolSet.forEach(tool => {
    const btn = document.createElement('button');
    btn.className = `tool-btn ${currentTool === tool.id ? 'active' : ''}`;
    btn.innerHTML = `<i class="${tool.icon}"></i><span>${tool.label}</span>`;
    
    btn.onclick = () => handleToolClick(tool.id);
    
    toolbar.appendChild(btn);
  });
}

function handleToolClick(toolId) {
  if (toolId === 'close') {
    ipcRenderer.send('annotate-close');
    return;
  }
  if (toolId === 'undo') {
    performUndo();
    return;
  }
  if (toolId === 'redo') {
    performRedo();
    return;
  }
  if (toolId === 'clear') {
    pages[currentPageIndex] = [];
    renderCanvas();
    renderToolbar(); // Update state if needed
    return;
  }
  if (toolId === 'save') {
    exportImage();
    return;
  }

  currentTool = toolId;
  
  // Handle Mouse/Annotate switching for Transparent Window
  if (MODE === 'annotate') {
    if (currentTool === 'mouse') {
       // Exit annotation mode
       ipcRenderer.send('annotate-set-ignore-mouse-events', true, { forward: true });
    } else {
       // Enter annotation mode
       ipcRenderer.send('annotate-set-ignore-mouse-events', false);
    }
  }

  renderToolbar();
}

// --- Canvas Logic ---

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  renderCanvas();
}

function getPoint(e) {
  return {
    x: (e.clientX - camera.x) / camera.z,
    y: (e.clientY - camera.y) / camera.z,
    pressure: e.pressure || 0.5
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (currentTool === 'mouse') return;
  if (e.button !== 0) return; // Only left click
  
  canvas.setPointerCapture(e.pointerId);
  isDrawing = true;
  const point = getPoint(e);
  
  if (currentTool === 'pan') {
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    return;
  }
  
  if (currentTool === 'select') {
    const point = getPoint(e);
    const index = hitTest(point.x, point.y);
    if (index !== -1) {
      selectedStrokeIndex = index;
      dragStart = point;
      renderCanvas();
    } else {
      selectedStrokeIndex = -1;
      renderCanvas();
    }
    return;
  }

  if (currentTool === 'pen' || (currentTool === 'eraser' && eraserType === 'point')) {
    currentPoints = [point];
  }
  
  // Select logic (hit test) would go here
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDrawing) return;
  
  if (currentTool === 'pan' && isPanning) {
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    camera.x += dx;
    camera.y += dy;
    panStart = { x: e.clientX, y: e.clientY };
    renderCanvas();
    return;
  }

  if (currentTool === 'pen' || (currentTool === 'eraser' && eraserType === 'point')) {
    const point = getPoint(e);
    currentPoints.push(point);
    renderCanvas(); // Render current stroke live
  } else if (currentTool === 'eraser' && eraserType === 'stroke') {
    const point = getPoint(e);
    const hitIndex = hitTest(point.x, point.y);
    if (hitIndex !== -1) {
        pages[currentPageIndex].splice(hitIndex, 1);
        renderCanvas();
    }
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (!isDrawing) return;
  isDrawing = false;
  isPanning = false;
  canvas.releasePointerCapture(e.pointerId);
  
  if (currentTool === 'pen' || (currentTool === 'eraser' && eraserType === 'point')) {
    // Finalize stroke
    const stroke = {
      type: currentTool, // 'pen' or 'eraser' (if stroke eraser)
      points: currentPoints,
      color: currentTool === 'eraser' ? 'transparent' : penColor,
      size: currentTool === 'eraser' ? eraserSize : penSize,
      isPointEraser: currentTool === 'eraser' && eraserType === 'point'
    };
    
    // Add to pages
    pages[currentPageIndex].push(stroke);
    redoStack = []; // Clear redo
    
    renderCanvas();
    renderToolbar(); // Update toolbar (e.g., to show Clear/Save)
  }
});

function hitTest(x, y) {
  const threshold = 10;
  const strokes = pages[currentPageIndex];
  // Check in reverse order (top to bottom)
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (stroke.isPointEraser) continue; // Skip point eraser strokes

    for (const p of stroke.points) {
      // Simple distance check
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < stroke.size / 2 + threshold) {
        return i;
      }
    }
  }
  return -1;
}

// --- Rendering ---

function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.z, camera.z);
  
  const strokes = pages[currentPageIndex] || [];
  
  // Render committed strokes
  strokes.forEach((stroke, index) => {
    drawStroke(stroke, index === selectedStrokeIndex);
  });
  
  // Render current stroke
  if (isDrawing && (currentTool === 'pen' || currentTool === 'eraser')) {
    const tempStroke = {
      type: currentTool,
      points: currentPoints,
      color: currentTool === 'eraser' ? 'rgba(255,255,255,0.5)' : penColor,
      size: currentTool === 'eraser' ? eraserSize : penSize,
      isPointEraser: currentTool === 'eraser' && eraserType === 'point'
    };
    drawStroke(tempStroke);
  }
  
  ctx.restore();
}

function drawStroke(stroke, isSelected = false) {
  const { points, color, size, isPointEraser } = stroke;
  
  if (points.length < 2) return;

  const outlinePoints = getStroke(points, {
    size: size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    start: { taper: 0, easing: (t) => t },
    end: { taper: 0, easing: (t) => t }
  });

  const pathData = getSvgPathFromStroke(outlinePoints);
  const path = new Path2D(pathData);

  ctx.save();
  if (stroke.type === 'eraser') {
    if (isPointEraser) {
       ctx.globalCompositeOperation = 'destination-out';
       ctx.fillStyle = 'black'; // Color doesn't matter for destination-out
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
    ctx.strokeStyle = '#238f4a'; // Accent color
    ctx.lineWidth = 2;
    ctx.stroke(path);
  }

  ctx.restore();
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

// --- Undo/Redo ---

function performUndo() {
  if (pages[currentPageIndex].length === 0) return;
  const stroke = pages[currentPageIndex].pop();
  redoStack.push(stroke);
  renderCanvas();
  renderToolbar();
}

function performRedo() {
  if (redoStack.length === 0) return;
  const stroke = redoStack.pop();
  pages[currentPageIndex].push(stroke);
  renderCanvas();
  renderToolbar();
}

// --- Export ---
function exportImage() {
    const dataUrl = canvas.toDataURL('image/png');
    ipcRenderer.send('annotate-save-image', dataUrl);
}

// --- Page Controls ---
document.getElementById('btn-add-page').onclick = () => {
    pages.push([]);
    currentPageIndex = pages.length - 1;
    redoStack = [];
    updatePageIndicator();
    renderCanvas();
};

document.getElementById('btn-prev-page').onclick = () => {
    if (currentPageIndex > 0) {
        currentPageIndex--;
        redoStack = [];
        updatePageIndicator();
        renderCanvas();
    }
};

document.getElementById('btn-next-page').onclick = () => {
    if (currentPageIndex < pages.length - 1) {
        currentPageIndex++;
        redoStack = [];
        updatePageIndicator();
        renderCanvas();
    }
};

document.getElementById('btn-close-wb').onclick = () => {
    ipcRenderer.send('annotate-close');
};

document.getElementById('btn-save').onclick = () => {
    exportImage();
};

function updatePageIndicator() {
    document.getElementById('page-indicator').textContent = `${currentPageIndex + 1} / ${pages.length}`;
}

// Start
initUI();
