const fs = require('fs');
const path = require('path');
const { app } = require('electron').remote || require('electron'); // Try to get app path
const state = require('./state');

// --- Helper Functions ---

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

function pointsToInkmlTrace(points) {
    if (!points || !Array.isArray(points)) return '';
    const parts = [];
    for (const p of points) {
        if (p && typeof p.x === 'number' && typeof p.y === 'number') {
            parts.push(`${p.x} ${p.y}`);
        }
    }
    return parts.join(', ');
}

// --- Mapper: Internal Stroke -> PersistedAnnotationDocV1 ---

function convertStrokesToDoc(strokes) {
    const nodes = [];
    if (!strokes || !Array.isArray(strokes)) return { version: 1, nodes: [] };

    for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i];
        if (stroke.type === 'pen' || stroke.type === 'eraser') { // Eraser handled as stroke with role? No, separate role usually.
             // Check if eraser is point eraser (which is a stroke)
             // But internal eraser is usually action based.
             // If internal stroke has type 'eraser', map to eraserPixel?
             // Assuming internal strokes are just pen for now.
             
             // Map pen
             const points = [];
             if (stroke.points) {
                 stroke.points.forEach(p => points.push(p.x, p.y));
             }
             
             nodes.push({
                 role: 'stroke',
                 strokeWidth: stroke.size || 5,
                 color: stroke.color || '#000000',
                 opacity: 1, // Default opacity
                 pfh: !!stroke.taper, // Perfect freehand flag
                 points: points
             });
        }
        // Shapes/Images/etc. are not standard InkML. 
        // We might skip them or encode them in a custom way if needed.
        // For now, only pen strokes are standard InkML.
        // TODO: Handle shapes as special traces or metadata?
    }
    return { version: 1, nodes };
}

// --- InkML Encoder ---

function encodeDocToInkmlAndExc(doc) {
    const traces = [];
    const excTraces = [];

    const nodes = doc.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const id = `t${i}`;
        
        // InkML Trace
        // Convert [x1, y1, x2, y2...] to "x1 y1, x2 y2"
        const pts = [];
        for(let j=0; j<n.points.length; j+=2) {
            pts.push(`${n.points[j]} ${n.points[j+1]}`);
        }
        const traceBody = pts.join(', ');
        
        traces.push(`<trace id="${id}">${traceBody}</trace>`);
        
        // Exc (Metadata)
        excTraces.push({
            id,
            role: n.role,
            strokeWidth: n.strokeWidth,
            color: n.color,
            opacity: n.opacity,
            pfh: n.pfh
        });
    }

    const inkml = `<?xml version="1.0" encoding="UTF-8"?>
<ink xmlns="http://www.w3.org/2003/InkML">
${traces.map(t => '  ' + t).join('\n')}
</ink>`;

    const exc = { version: 1, traces: excTraces };
    
    return { inkml, inkmlexc: JSON.stringify(exc) };
}

// --- Saving Logic ---

let saveTimeout = null;
const SAVE_DELAY = 2000; // 2 seconds debounce

function triggerAutoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        performSave();
    }, SAVE_DELAY);
}

async function performSave() {
    console.log('[Cunox] Saving Board Data...');
    
    // Determine Save Path
    // Use UserData/BoardData/AutoSave.cunox
    // We need IPC to get path if remote is not available
    let userDataPath;
    try {
        const { ipcRenderer } = require('electron');
        userDataPath = await ipcRenderer.invoke('annotate-get-user-data-path');
    } catch (e) {
        console.error('Failed to get user data path via IPC:', e);
    }
    
    if (!userDataPath) {
         // Fallback for dev
         try {
            userDataPath = (require('electron').remote).app.getPath('userData');
         } catch(e) {}
    }
    
    if (!userDataPath) return; // Cannot save

    // Create date string YYYY-MM-DD
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + 
                   String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(now.getDate()).padStart(2, '0');
                   
    // Path: userData/OrbiBoard/data/screen-annotate/YYYY-MM-DD.cunox
    const baseDir = path.join(userDataPath, 'OrbiBoard', 'data', 'screen-annotate', `${dateStr}.cunox`);
    ensureDir(baseDir);

    // 1. Save Manifest (cunox.ucixml)
    const manifest = {
        formatVersion: 1,
        createdAt: Date.now(),
        resources: [], // TODO: Handle resources (images)
        scenes: []
    };

    // 2. Save Scenes
    
    // -- Board --
    const boardScene = { id: 'board', kind: 'board', pages: [] };
    const boardPages = state.whiteboard.pages || [];
    const boardDir = path.join(baseDir, 'board', 'ink');
    ensureDir(boardDir);
    
    for (let i = 0; i < boardPages.length; i++) {
        const pageStrokes = boardPages[i];
        const pageId = `board-${i}`;
        
        const doc = convertStrokesToDoc(pageStrokes);
        const { inkml, inkmlexc } = encodeDocToInkmlAndExc(doc);
        
        fs.writeFileSync(path.join(boardDir, `${pageId}.inkml`), inkml);
        fs.writeFileSync(path.join(boardDir, `${pageId}.inkmlexc`), inkmlexc);
        
        // TODO: Handle background resources
        
        boardScene.pages.push({
            id: pageId,
            type: 'screen',
            ink: {
                inkml: `board/ink/${pageId}.inkml`,
                inkmlexc: `board/ink/${pageId}.inkmlexc`
            }
        });
    }
    manifest.scenes.push(boardScene);

    // -- Screen (Annotate) --
    const screenScene = { id: 'screen', kind: 'screen', pages: [] };
    const screenStrokes = state.annotate.strokes || [];
    if (screenStrokes.length > 0) {
        const pageId = 'screen-0';
        const screenDir = path.join(baseDir, 'screen', 'ink');
        ensureDir(screenDir);
        
        const doc = convertStrokesToDoc(screenStrokes);
        const { inkml, inkmlexc } = encodeDocToInkmlAndExc(doc);
        
        fs.writeFileSync(path.join(screenDir, `${pageId}.inkml`), inkml);
        fs.writeFileSync(path.join(screenDir, `${pageId}.inkmlexc`), inkmlexc);
        
        screenScene.pages.push({
            id: pageId,
            type: 'screen',
            ink: {
                inkml: `screen/ink/${pageId}.inkml`,
                inkmlexc: `screen/ink/${pageId}.inkmlexc`
            }
        });
    }
    manifest.scenes.push(screenScene);

    // -- Video Booth --
    const boothScene = { id: 'video_booth', kind: 'video_booth', pages: [] };
    const boothStrokes = state.booth.strokes || []; // Assuming single page for now? Or multiple?
    // Booth usually has multiple pages in video show? 
    // State says: booth.strokes (current), but maybe there's a list?
    // state.booth doesn't seem to have pages array in state.js, just strokes.
    // So assume single page for current session or check if booth module handles pages.
    // We'll save current booth strokes.
    if (boothStrokes.length > 0) {
        const pageId = 'booth-0';
        const boothDir = path.join(baseDir, 'video_booth', 'ink');
        ensureDir(boothDir);
        
        const doc = convertStrokesToDoc(boothStrokes);
        const { inkml, inkmlexc } = encodeDocToInkmlAndExc(doc);
        
        fs.writeFileSync(path.join(boothDir, `${pageId}.inkml`), inkml);
        fs.writeFileSync(path.join(boothDir, `${pageId}.inkmlexc`), inkmlexc);
        
        boothScene.pages.push({
            id: pageId,
            type: 'image', // Booth pages are usually images
            ink: {
                inkml: `video_booth/ink/${pageId}.inkml`,
                inkmlexc: `video_booth/ink/${pageId}.inkmlexc`
            }
        });
    }
    manifest.scenes.push(boothScene);

    // 3. Write Manifest XML
    const xml = buildManifestXml(manifest);
    fs.writeFileSync(path.join(baseDir, 'cunox.ucixml'), xml);
    
    console.log('[Cunox] Saved to:', baseDir);
}

function buildManifestXml(manifest) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<cunox>
  <formatVersion>${manifest.formatVersion}</formatVersion>
  <createdAt>${manifest.createdAt}</createdAt>
  <resources>
`;
    // Resources
    // ...
    xml += `  </resources>
  <scenes>
`;
    for (const scene of manifest.scenes) {
        xml += `    <scene>
      <id>${scene.id}</id>
      <kind>${scene.kind}</kind>
`;
        for (const page of scene.pages) {
            xml += `      <page>
        <id>${page.id}</id>
        <type>${page.type}</type>
`;
            if (page.ink) {
                if (page.ink.inkml) xml += `        <inkml>${page.ink.inkml}</inkml>\n`;
                if (page.ink.inkmlexc) xml += `        <inkmlexc>${page.ink.inkmlexc}</inkmlexc>\n`;
            }
            xml += `      </page>\n`;
        }
        xml += `    </scene>\n`;
    }
    xml += `  </scenes>
</cunox>`;
    return xml;
}

module.exports = {
    triggerAutoSave,
    performSave
};
