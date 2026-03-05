const state = {
    variant: null,
    persistKey: null,
    
    // --- Whiteboard State ---
    whiteboard: {
        pages: [[]],
        pageBackgrounds: ['var(--bg)'],
        pageSnapshots: [],
        currentPageIndex: 0,
        camera: { x: 0, y: 0, z: 1 },
        history: [], // Separate history for whiteboard
        historyIndex: -1
    },

    // --- Annotate State ---
    annotate: {
        strokes: [], // Single page for annotation
        camera: { x: 0, y: 0, z: 1 },
        history: [], // Separate history for annotation
        historyIndex: -1
    },

    // --- Booth State ---
    booth: {
        strokes: [],
        camera: { x: 0, y: 0, z: 1 },
        history: [],
        historyIndex: -1,
        videoOrigin: { x: 0, y: 0 }, // Tracks background origin in World Space
        bgRotation: 0 // Tracks background rotation
    },

    // --- Shared/Transient State ---
    // (Used by interaction logic, cleared on tool switch usually)
    isDrawing: false,
    drawStartTime: 0,
    drawStartPoint: { x: 0, y: 0 },
    currentPoints: [],
    selectedStrokeIndices: [], 
    lassoPoints: [],
    mousePos: { x: -100, y: -100 },
    isMenuOpen: false,
    isMovingSelection: false,
    isResizingSelection: false,
    isRotatingSelection: false,
    rotationHandleIndex: -1,
    resizeHandleIndex: -1,
    selectionBounds: null,
    originalSelectionStrokes: null,
    selectionHandles: [],
    isPanning: false,
    panStart: null,
    panStartCamera: null,
    shapeStart: null,
    
    // Theme State
    themeMode: 'system',
    themeColor: '#238f4a',

    // Render Mode State
    renderMode: 'canvas2d', // 'canvas2d' or 'webgpu'

    // Tool State
    currentTool: 'pen', 
    penColor: '#ffffff',
    penSize: 6,
    penTaper: true,
    eraserType: 'point',
    currentShape: null,
    isShapePinned: false,
    pendingShape: null,
    eraserSize: 100,
    
    // Text Tool State
    textSettings: {
        fontSize: 24,
        fontFamily: 'Arial',
        bold: false,
        italic: false,
        underline: false,
        color: '#ffffff'
    },
    
    // Active Media (for playback)
    activeMedia: null,

    // Fullscreen Video Mode (Transient Overlay)
    fullscreen: {
        active: false,
        strokes: [],
        camera: { x: 0, y: 0, z: 1 },
        videoId: null,
        originalParent: null,
        history: [], // Separate history
        historyIndex: -1
    },

    // Screenshot Mode State
    screenshot: {
        active: false,
        start: null,
        end: null
    },

    // Initial Mode
    MODE: new URLSearchParams(window.location.search).get('mode') || 'whiteboard',

    // --- Accessors ---

    // Get active strokes array
    getActiveStrokes() {
        if (this.fullscreen.active) return this.fullscreen.strokes;
        if (this.MODE === 'annotate') return this.annotate.strokes;
        if (this.MODE === 'booth') return this.booth.strokes;
        return this.whiteboard.pages[this.whiteboard.currentPageIndex];
    },

    // Get active camera
    getActiveCamera() {
        if (this.fullscreen.active) return this.fullscreen.camera;
        if (this.MODE === 'annotate') return this.annotate.camera;
        if (this.MODE === 'booth') return this.booth.camera;
        return this.whiteboard.camera;
    },

    // Get active history
    getActiveHistory() {
        if (this.fullscreen.active) return this.fullscreen;
        if (this.MODE === 'annotate') return this.annotate;
        if (this.MODE === 'booth') return this.booth;
        return this.whiteboard;
    },

    // Backwards compatibility accessors (proxies)
    get pages() { return this.whiteboard.pages; },
    set pages(v) { this.whiteboard.pages = v; },
    
    get pageBackgrounds() { return this.whiteboard.pageBackgrounds; },
    get pageSnapshots() { return this.whiteboard.pageSnapshots; },
    
    get currentPageIndex() { return this.whiteboard.currentPageIndex; },
    set currentPageIndex(v) { this.whiteboard.currentPageIndex = v; },
    
    get camera() { return this.getActiveCamera(); },
    set camera(v) { 
        if (this.fullscreen.active) this.fullscreen.camera = v;
        else if (this.MODE === 'annotate') this.annotate.camera = v;
        else this.whiteboard.camera = v;
    }
};

// Set initial tool based on mode
state.currentTool = state.MODE === 'annotate' ? 'mouse' : 'pen';

module.exports = state;
