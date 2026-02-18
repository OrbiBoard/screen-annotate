const fs = require('fs');
const path = require('path');
const state = require('./state');
const ui = require('./ui');
const canvasModule = require('./canvas');

let client = null;
let hasVideoBooth = false;

try {
    const pluginsDir = path.resolve(__dirname, '../..');
    const boothDir = path.join(pluginsDir, 'video-booth');
    
    if (fs.existsSync(boothDir)) {
        // Require client.js from video-booth plugin
        // Assuming standard structure: Plugins/video-booth/client.js
        client = require('../../video-booth/client.js');
        hasVideoBooth = true;
        
        // Initialize client with dependencies
        if (client && client.init) {
            client.init({ state, ui, canvasModule });
        }
    }
} catch (e) {
    console.warn('Video Booth plugin not found or failed to load:', e);
    hasVideoBooth = false;
    client = null;
}

function checkVideoBoothPlugin() {
    return hasVideoBooth;
}

function getHasVideoBooth() {
    return hasVideoBooth;
}

// Helper to proxy calls to client if available
const proxy = (methodName) => {
    return (...args) => {
        if (client && typeof client[methodName] === 'function') {
            return client[methodName](...args);
        }
        // Fail silently or warn? Original code would fail if called when not ready, 
        // but UI logic usually guards with hasVideoBooth check.
        // For safety, we can log a warning if debug needed.
    };
};

module.exports = {
    checkVideoBoothPlugin,
    getHasVideoBooth,
    initBoothListeners: proxy('initBoothListeners'),
    enterBoothMode: proxy('enterBoothMode'),
    exitBoothMode: (...args) => {
        const res = proxy('exitBoothMode')(...args);
        state.currentTool = 'pan';
        canvasModule.canvas.style.pointerEvents = 'auto';
        return res;
    },
    openGallery: proxy('openGallery'),
    initGalleryListeners: proxy('initGalleryListeners'),
    setHandleToolClick: proxy('setHandleToolClick'),
    updateBackgroundTransform: proxy('updateBackgroundTransform')
};
