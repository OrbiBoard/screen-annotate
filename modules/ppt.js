const fs = require('fs');
const path = require('path');
const state = require('./state');
const ui = require('./ui');
const canvasModule = require('./canvas');

let client = null;
let hasPPTPlugin = false;

try {
    const pluginsDir = path.resolve(__dirname, '../..');
    const pptDir = path.join(pluginsDir, 'ppt-annotate');
    
    if (fs.existsSync(pptDir)) {
        client = require('../../ppt-annotate/client.js');
        hasPPTPlugin = true;
        
        if (client && client.init) {
            client.init({ state, ui, canvasModule });
        }
    }
} catch (e) {
    console.warn('PPT Annotation plugin not found or failed to load:', e);
    hasPPTPlugin = false;
    client = null;
}

function checkPPTPlugin() {
    return hasPPTPlugin;
}

function getHasPPTPlugin() {
    return hasPPTPlugin;
}

const proxy = (methodName) => {
    return (...args) => {
        if (client && typeof client[methodName] === 'function') {
            return client[methodName](...args);
        }
    };
};

module.exports = {
    checkPPTPlugin,
    getHasPPTPlugin,
    enterPPTMode: proxy('enterPPTMode'),
    exitPPTMode: proxy('exitPPTMode'),
    setHandleToolClick: proxy('setHandleToolClick')
};
