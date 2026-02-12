const state = {
    pages: [[]], // Array of strokes for each page
    pageBackgrounds: ['var(--bg)'], // Fix for Issue 1: Store background per page
    pageSnapshots: [], // Cache of dataURLs for previews
    currentPageIndex: 0,
    redoStack: [], // For current page
    isDrawing: false,
    currentPoints: [],
    selectedStrokeIndices: [], // Array of indices for multi-selection
    lassoPoints: [], // For Lasso Selection
    mousePos: { x: -100, y: -100 }, // For Eraser Cursor
    isMenuOpen: false,
    isMovingSelection: false,
    isResizingSelection: false,
    resizeHandleIndex: -1, // 0: TL, 1: TR, 2: BR, 3: BL
    selectionBounds: null, // {x, y, w, h}
    originalSelectionStrokes: null, // Snapshot for resizing/moving
    selectionHandles: [], // Array of DOM elements for handles
    
    // Tool State
    currentTool: 'pen', // 'pen', 'eraser', 'select', 'pan'
    penColor: '#ffffff',
    penSize: 6, // Fix: Default size 6
    penTaper: true, // Fix: Default taper on
    eraserType: 'point', // 'stroke' or 'point'
    currentShape: 'rect', // default shape
    isShapePinned: false, // is shape window pinned
    pendingShape: null, // for multi-step shapes
    eraserSize: 100,
    
    // Camera (Pan/Zoom)
    camera: { x: 0, y: 0, z: 1 },
    isPanning: false,
    panStart: { x: 0, y: 0 },
    // Fix: Track pan offset for accurate subsequent drawing
    // Actually camera x/y IS the offset. 
    // But issue description says: "after pan, ink moves, but new writing has offset error".
    // This usually means input coordinates are not being transformed by camera correctly.
    // In renderer.js: 
    // const point = utils.getPoint(e); 
    // utils.getPoint uses (e.clientX - camera.x) / camera.z. 
    // If camera updates correctly, point should be correct world coord.
    // Let's check utils.js.

    // Active Media (for playback)
    activeMedia: null, // { index: number, el: DOMElement, timeout: Timer }

    // Fullscreen Mode
    fullscreen: {
        active: false,
        strokes: [], // Strokes drawn on top of fullscreen video
        camera: { x: 0, y: 0, z: 1 },
        videoId: null, // Index of the video element in the original page
        originalParent: null, // To restore video
        redoStack: [] // Separate redo stack
    },

    // Initial Mode
    MODE: new URLSearchParams(window.location.search).get('mode') || 'whiteboard',

    // Helper to get current strokes
    getActiveStrokes() {
        if (this.fullscreen.active) {
            return this.fullscreen.strokes;
        }
        return this.pages[this.currentPageIndex];
    },

    // Helper to get active camera
    getActiveCamera() {
        if (this.fullscreen.active) {
            return this.fullscreen.camera;
        }
        return this.camera;
    },

    // Helper to get active redo stack
    getActiveRedoStack() {
        if (this.fullscreen.active) {
            return this.fullscreen.redoStack;
        }
        return this.redoStack;
    }
};

// Set initial tool based on mode
state.currentTool = state.MODE === 'annotate' ? 'mouse' : 'pen';

module.exports = state;
