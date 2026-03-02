const state = require('./state');
const canvasModule = require('./canvas');
const objects = require('./objects');
const selection = require('./selection');
const booth = require('./booth');
const cunox = require('./cunox');

function getHistoryState() {
    return state.getActiveHistory();
}

function pushAction(action) {
    const historyState = getHistoryState();
    
    // Clear redo stack (anything after current index)
    if (historyState.historyIndex < historyState.history.length - 1) {
        historyState.history.splice(historyState.historyIndex + 1);
    }
    historyState.history.push(action);
    historyState.historyIndex++;
    
    // Limit stack size
    if (historyState.history.length > 50) {
        historyState.history.shift();
        historyState.historyIndex--;
    }
    
    cunox.triggerAutoSave();
}

function undo() {
    const historyState = getHistoryState();
    if (historyState.historyIndex < 0) return;
    
    const action = historyState.history[historyState.historyIndex];
    historyState.historyIndex--;
    
    applyAction(action, true);
    cunox.triggerAutoSave();
}

function redo() {
    const historyState = getHistoryState();
    if (historyState.historyIndex >= historyState.history.length - 1) return;
    
    historyState.historyIndex++;
    const action = historyState.history[historyState.historyIndex];
    
    applyAction(action, false);
    cunox.triggerAutoSave();
}

function applyAction(action, isUndo) {
    const strokes = state.getActiveStrokes();
    
    if (action.type === 'add') {
        if (isUndo) {
             // Remove added strokes
             // We need to find them by reference.
             // If we just pushed them, they are at the end?
             // Not necessarily if we did other things.
             // Let's iterate backwards.
             action.strokes.forEach(s => {
                 const idx = strokes.indexOf(s);
                 if (idx > -1) strokes.splice(idx, 1);
             });
             state.selectedStrokeIndices = [];
        } else {
             // Redo Add
             strokes.push(...action.strokes);
        }
    } else if (action.type === 'delete') {
        if (isUndo) {
            // Undo Delete -> Restore
            // Sort by index ascending to insert correctly
            // We need to restore them at original indices.
            // action.items = [{index, stroke}]
            // If we have multiple, we must insert in order.
            const items = [...action.items].sort((a,b) => a.index - b.index);
            items.forEach(item => {
                 strokes.splice(item.index, 0, item.stroke);
            });
        } else {
            // Redo Delete -> Remove
            // Remove from highest index to lowest
            const indices = action.items.map(i => i.index).sort((a,b) => b - a);
            indices.forEach(idx => {
                strokes.splice(idx, 1);
            });
            state.selectedStrokeIndices = [];
        }
    } else if (action.type === 'transform') {
        // action.items = [{index, before, after}]
        action.items.forEach(item => {
             // We rely on index being stable. 
             // If strokes array changed size (add/delete), this might be wrong.
             // But we only transform existing strokes.
             const stroke = strokes[item.index];
             if (stroke) {
                 const props = isUndo ? item.before : item.after;
                 Object.assign(stroke, props);
             }
        });
    } else if (action.type === 'pan') {
        const cam = state.getActiveCamera();
        const target = isUndo ? action.before : action.after;
        cam.x = target.x;
        cam.y = target.y;
        cam.z = target.z;
        
        if (state.MODE === 'booth') {
            booth.updateBackgroundTransform(cam);
        }
    }
    
    canvasModule.renderCanvas();
    objects.updateDOMObjects();
    selection.updateSelectionBounds();
    selection.showSelectionToolbar();
}

module.exports = {
    pushAction,
    undo,
    redo
};
