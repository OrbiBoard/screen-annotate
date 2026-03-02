const { BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');

let annotateWindow = null;
let controlsWindow = null; // New separate window for controls
let desktopToolbarWindow = null; // Small toolbar window for Desktop Annotation
let pluginApi = null;

let currentMode = 'whiteboard';

// Helper to remove listeners to avoid duplicates on reload
function cleanupListeners() {
    ipcMain.removeAllListeners('annotate-set-ignore-mouse-events');
    ipcMain.removeAllListeners('annotate-close');
    ipcMain.removeAllListeners('annotate-minimize');
    ipcMain.removeAllListeners('annotate-save-image');
    ipcMain.removeAllListeners('annotate-insert-media');
    ipcMain.removeAllListeners('annotate-get-theme-config');
    ipcMain.removeAllListeners('annotate-forward-event');
    ipcMain.removeAllListeners('annotate-open-desktop-toolbar');
    ipcMain.removeAllListeners('annotate-close-desktop-toolbar');
    ipcMain.removeAllListeners('annotate-window-move');
}

module.exports = {
    init(api) {
        console.log('[ScreenAnnotate] Plugin loaded');
        pluginApi = api;

        // Ensure clean state
        cleanupListeners();

        // Register IPC handlers
        ipcMain.handle('annotate-get-screen-info', () => {
            const primaryDisplay = screen.getPrimaryDisplay();
            return {
                bounds: primaryDisplay.bounds,
                workArea: primaryDisplay.workArea
            };
        });

        ipcMain.handle('annotate-get-config', () => {
            if (pluginApi && pluginApi.store) {
                return pluginApi.store.getAll();
            }
            return {};
        });

        ipcMain.on('annotate-get-theme-config', (event) => {
            if (pluginApi && pluginApi.theme) {
                const res = pluginApi.theme.get();
                if (res.ok) {
                    event.reply('annotate-theme-config-reply', { mode: res.mode, color: res.color });
                }
            }
        });

        ipcMain.on('annotate-set-ignore-mouse-events', (event, ignore, options) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                win.setIgnoreMouseEvents(ignore, options);
            }
        });

        // Forward events from controls window to annotate window
        ipcMain.on('annotate-forward-event', (event, { channel, args }) => {
            // Forward to controls window (main window for drawing)
            if (controlsWindow && !controlsWindow.isDestroyed()) {
                controlsWindow.webContents.send(channel, ...args);
            }
            // Also forward to desktop toolbar for UI sync
            if (desktopToolbarWindow && !desktopToolbarWindow.isDestroyed()) {
                desktopToolbarWindow.webContents.send(channel, ...args);
            }
        });

        ipcMain.on('annotate-close', (event) => {
            if (annotateWindow) annotateWindow.close();
            if (controlsWindow) controlsWindow.close();
            if (desktopToolbarWindow) desktopToolbarWindow.close();
        });

        ipcMain.on('annotate-minimize', (event) => {
            if (annotateWindow) {
                annotateWindow.hide();
                annotateWindow.setSkipTaskbar(true);
            }
            if (controlsWindow) {
                controlsWindow.hide();
                controlsWindow.setSkipTaskbar(true);
            }
            if (desktopToolbarWindow) {
                desktopToolbarWindow.hide();
                desktopToolbarWindow.setSkipTaskbar(true);
            }
        });

        // --- Desktop Toolbar Handlers ---
        ipcMain.on('annotate-open-desktop-toolbar', (event) => {
            // Only allow desktop toolbar in Desktop Annotation mode
            if (currentMode !== 'annotate') {
                console.log('[ScreenAnnotate] Desktop toolbar can only be opened in annotate mode, current mode:', currentMode);
                return;
            }

            if (desktopToolbarWindow) {
                if (desktopToolbarWindow.isMinimized()) desktopToolbarWindow.restore();
                desktopToolbarWindow.show();
                desktopToolbarWindow.moveTop();
            } else {
                const point = screen.getCursorScreenPoint();
                const display = screen.getDisplayNearestPoint(point);
                // Calculate center position or use saved
                const width = 600; // Estimated
                const height = 80;
                const x = display.bounds.x + (display.bounds.width - width) / 2;
                const y = display.bounds.y + display.bounds.height - height - 20;

                desktopToolbarWindow = new BrowserWindow({
                    x: x,
                    y: y,
                    width: width, // Initial, will resize dynamically
                    height: height,
                    transparent: true,
                    frame: false,
                    alwaysOnTop: true,
                    type: 'toolbar',
                    skipTaskbar: true,
                    hasShadow: false,
                    focusable: true,
                    resizable: false,
                    title: 'Annotate Toolbar',
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false,
                        webSecurity: false
                    }
                });

                desktopToolbarWindow.setAlwaysOnTop(true, 'screen-saver');
                desktopToolbarWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'annotate', role: 'desktop-toolbar' } });

                // Ensure desktop toolbar window is interactable
                desktopToolbarWindow.setIgnoreMouseEvents(false);
                desktopToolbarWindow.setFocusable(true);
                
                // Show and focus after load
                desktopToolbarWindow.once('ready-to-show', () => {
                    desktopToolbarWindow.show();
                    desktopToolbarWindow.focus();
                });

                desktopToolbarWindow.on('closed', () => {
                    desktopToolbarWindow = null;
                    // Don't close other windows when toolbar closes - user might just want to hide it
                });
            }

            // Hide Main Toolbar in Controls Window
            if (controlsWindow) {
                controlsWindow.webContents.send('toggle-toolbar-visibility', false);
            }
        });

        ipcMain.on('annotate-close-desktop-toolbar', (event) => {
            if (desktopToolbarWindow) {
                desktopToolbarWindow.hide();
            }
            // Show Main Toolbar in Controls Window
            if (controlsWindow) {
                controlsWindow.webContents.send('toggle-toolbar-visibility', true);
            }
        });

        ipcMain.on('annotate-window-move', (event, { x, y }) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                const bounds = win.getBounds();
                win.setPosition(bounds.x + x, bounds.y + y);
            }
        });

        ipcMain.on('resize-window', (event, { width, height }) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                win.setSize(width, height);
            }
        });

        ipcMain.on('annotate-set-background-color', (event, color) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                try {
                    win.setBackgroundColor(color || '#071a12');
                } catch (e) {
                    // console.error('Failed to set background color:', e);
                }
            }
        });

        ipcMain.on('annotate-update-shape', (event, rects) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                try {
                    const url = win.webContents.getURL();
                    const isDesktopToolbar = url.includes('role=desktop-toolbar');
                    const isCanvas = url.includes('role=canvas');
                    const mode = url.match(/mode=([^&]+)/)?.[1] || 'whiteboard';
                    
                    if (isDesktopToolbar) {
                        // Desktop toolbar window - use the provided rects (calculated from toolbar position)
                        // If rects is empty or invalid, use full window as fallback
                        if (rects && rects.length > 0 && rects[0].width > 0 && rects[0].height > 0) {
                            win.setShape(rects);
                        } else {
                            const bounds = win.getBounds();
                            win.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }]);
                        }
                    } else if (isCanvas) {
                        // Canvas window in annotate mode - set shape for interactive areas
                        // In whiteboard/booth mode, canvas should be fully interactive (no shape restriction)
                        if (mode === 'annotate') {
                            win.setShape(rects);
                        } else {
                            // Whiteboard/Booth mode - no shape restriction
                            win.setShape([]);
                        }
                    } else {
                        // Controls window - use provided rects
                        win.setShape(rects);
                    }
                } catch (e) {
                    // console.error('Failed to set shape:', e);
                }
            }
        });

        ipcMain.on('annotate-save-image', async (event, dataUrl) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            const { filePath } = await dialog.showSaveDialog(win, {
                title: '保存批注',
                defaultPath: `annotation-${Date.now()}.png`,
                filters: [{ name: 'Images', extensions: ['png'] }]
            });

            if (filePath) {
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
                require('fs').writeFile(filePath, base64Data, 'base64', (err) => {
                    if (err) console.error(err);
                });
            }
        });

        // New IPC for Save Menu
        ipcMain.handle('annotate-select-path', async (event) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            const { filePaths } = await dialog.showOpenDialog(win, {
                title: '选择保存目录',
                properties: ['openDirectory']
            });
            return filePaths && filePaths.length > 0 ? filePaths[0] : null;
        });

        ipcMain.on('annotate-save-file', async (event, { path: savePath, dataUrl, type, name }) => {
            // Fix for saving
            if (!dataUrl) return;

            const win = BrowserWindow.fromWebContents(event.sender);
            const ext = type === 'pdf' ? 'pdf' : 'png';
            const defaultName = name || `annotation-${Date.now()}.${ext}`;
            const fs = require('fs');
            const path = require('path');

            let targetPath = null;
            if (savePath) {
                targetPath = path.join(savePath, defaultName);
            }

            if (!targetPath) {
                const result = await dialog.showSaveDialog(win, {
                    title: '保存文件',
                    defaultPath: defaultName,
                    filters: [
                        { name: 'Images', extensions: ['png'] },
                        { name: 'PDF', extensions: ['pdf'] }
                    ]
                });
                if (!result.canceled) targetPath = result.filePath;
            }

            if (targetPath) {
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
                fs.writeFile(targetPath, base64Data, 'base64', (err) => {
                    if (err) console.error('Save failed:', err);
                    else console.log('Saved to:', targetPath);
                });
            }
        });

        ipcMain.on('annotate-set-always-on-top', (event, flag) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                win.setAlwaysOnTop(flag, 'screen-saver'); // Higher priority
            }
        });

        ipcMain.on('annotate-insert-media', async (event, type) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (type === 'file') {
                const { filePaths } = await dialog.showOpenDialog(win, {
                    title: '选择文件',
                    properties: ['openFile'],
                    filters: [
                        { name: 'Media', extensions: ['jpg', 'png', 'gif', 'mp3', 'mp4', 'webm'] },
                        { name: 'All Files', extensions: ['*'] }
                    ]
                });
                if (filePaths && filePaths.length > 0) {
                    // Send back the path to renderer
                    event.reply('annotate-insert-media-reply', { type, path: filePaths[0] });
                    console.log('Selected file:', filePaths[0]);
                }
            } else if (type === 'browser') {
                event.reply('annotate-insert-media-reply', { type, path: null });
            } else if (type === 'link') {
                event.reply('annotate-insert-media-reply', { type, path: null });
            }
        });

        ipcMain.on('annotate-open-settings', (event) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                win.webContents.send('annotate-open-settings-view');
            } else if (annotateWindow) {
                annotateWindow.webContents.send('annotate-open-settings-view');
            } else {
                // Should not happen if triggered from plugin, but if so, open window first
                module.exports.functions.openSettings();
            }
        });

        ipcMain.on('annotate-open-path', (event, path) => {
            if (path) require('electron').shell.openPath(path);
        });

        // Sync mode changes between windows
        ipcMain.on('annotate-mode-change', (event, mode) => {
            currentMode = mode;
            if (annotateWindow && !annotateWindow.isDestroyed()) {
                annotateWindow.webContents.send('annotate-mode-change', mode);
            }
            if (controlsWindow && !controlsWindow.isDestroyed()) {
                controlsWindow.webContents.send('annotate-mode-change', mode);
            }

            // Adjust window behaviors based on mode
            if (mode === 'annotate') {
                // Desktop Annotation Mode
                if (annotateWindow) {
                    annotateWindow.setIgnoreMouseEvents(true, { forward: true });
                }
                if (controlsWindow) {
                    controlsWindow.setIgnoreMouseEvents(false);
                }
                // Open desktop toolbar for annotation mode
                if (!desktopToolbarWindow || desktopToolbarWindow.isDestroyed()) {
                    // Will be opened by renderer when needed
                } else {
                    desktopToolbarWindow.show();
                    desktopToolbarWindow.setIgnoreMouseEvents(false);
                }
            } else if (mode === 'ppt') {
                // PPT Mode - similar to annotate but with different tool set
                if (annotateWindow) {
                    annotateWindow.setIgnoreMouseEvents(true, { forward: true });
                }
                if (controlsWindow) {
                    controlsWindow.setIgnoreMouseEvents(false);
                }
                // Close desktop toolbar in PPT mode
                if (desktopToolbarWindow && !desktopToolbarWindow.isDestroyed()) {
                    desktopToolbarWindow.hide();
                }
            } else {
                // Whiteboard/Booth Mode
                if (annotateWindow) {
                    annotateWindow.setIgnoreMouseEvents(false);
                }
                if (controlsWindow) {
                    controlsWindow.setIgnoreMouseEvents(false);
                }
                // Close desktop toolbar in whiteboard/booth mode
                if (desktopToolbarWindow && !desktopToolbarWindow.isDestroyed()) {
                    desktopToolbarWindow.hide();
                }
            }
        });

        // Screenshot Handlers
        let screenshotRequestor = null;

        ipcMain.on('annotate-start-screenshot', (event) => {
            const senderWin = BrowserWindow.fromWebContents(event.sender);

            // Identify requestor
            screenshotRequestor = 'annotate';

            // Ensure Annotate Window is ready
            if (!annotateWindow) {
                module.exports.functions.openAnnotate();
                // Wait for load
                annotateWindow.webContents.once('did-finish-load', () => {
                    annotateWindow.webContents.send('annotate-enter-screenshot-mode');
                });
            } else {
                if (annotateWindow.isMinimized()) annotateWindow.restore();
                annotateWindow.show();
                annotateWindow.setAlwaysOnTop(true, 'screen-saver');
                // If it's already loaded, send immediately
                annotateWindow.webContents.send('annotate-enter-screenshot-mode');
            }
        });

        ipcMain.handle('annotate-capture-screen', async (event, { rect, full, hideWindow }) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            const wasVisible = win.isVisible();

            if (hideWindow && wasVisible) {
                win.hide();
                if (controlsWindow) controlsWindow.hide(); // Hide controls too
                // Wait for repaint
                await new Promise(r => setTimeout(r, 200));
            }

            try {
                const sources = await require('electron').desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: { width: screen.getPrimaryDisplay().size.width, height: screen.getPrimaryDisplay().size.height }
                });
                let source = sources[0];
                const image = source.thumbnail;

                if (hideWindow && wasVisible) {
                    win.show();
                    win.focus();
                    if (controlsWindow) controlsWindow.show();
                }

                if (full) {
                    return image.toDataURL();
                } else if (rect) {
                    const cropped = image.crop({
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    });
                    return cropped.toDataURL();
                }
            } catch (e) {
                console.error('Capture failed:', e);
                if (hideWindow && wasVisible) {
                    win.show();
                    win.focus();
                    if (controlsWindow) controlsWindow.show();
                }
                return null;
            }
        });

        ipcMain.on('annotate-screenshot-complete', (event, dataUrl) => {
            // Requestor was annotate (or null), so we stay in annotate window
            // If we are using annotateWindow (we should be), send reply there
            if (annotateWindow) {
                annotateWindow.webContents.send('annotate-insert-media-reply', { type: 'image-data', dataUrl });
                // Do NOT hide. Just restore UI state in renderer.
            }
            screenshotRequestor = null; // Reset
        });

        ipcMain.handle('annotate-get-user-data-path', () => {
            return require('electron').app.getPath('userData');
        });
    },

    functions: {
        openBoardCenter() {
            console.log('[ScreenAnnotate] openBoardCenter called');
            const { app, shell } = require('electron');
            const fs = require('fs');
            const path = require('path');

            const possiblePaths = [
                // Dev path
                path.join(process.cwd(), 'Auxiliary', 'LanStartWrite', 'dist', 'win-unpacked', 'LanStartWrite.exe'),
                path.join(process.cwd(), 'Auxiliary', 'LanStartWrite', 'LanStartWrite.exe'),
                'e:\\OrbiBoard\\Auxiliary\\LanStartWrite\\dist\\win-unpacked\\LanStartWrite.exe',
                'e:\\OrbiBoard\\Auxiliary\\LanStartWrite\\LanStartWrite.exe',
                // Relative to app (Prod)
                path.join(path.dirname(app.getPath('exe')), 'resources', 'LanStartWrite', 'LanStartWrite.exe'),
                path.join(path.dirname(app.getPath('exe')), 'LanStartWrite', 'LanStartWrite.exe'),
            ];

            let exePath = null;
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    exePath = p;
                    break;
                }
            }

            if (exePath) {
                console.log('Launching Board Center:', exePath);
                shell.openPath(exePath);
            } else {
                console.log('Board Center app not found, opening data folder');
                const dataPath = path.join(app.getPath('userData'), 'OrbiBoard', 'data', 'screen-annotate');
                if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
                shell.openPath(dataPath);
            }
        },

        openAnnotate() {
            console.log('[ScreenAnnotate] openAnnotate called');
            
            // Set mode to annotate
            currentMode = 'annotate';

            const { screen } = require('electron');
            const point = screen.getCursorScreenPoint();
            const display = screen.getDisplayNearestPoint(point);

            // Create Annotate Window (Canvas Layer) - this is the main drawing surface
            if (annotateWindow) {
                if (annotateWindow.isMinimized()) annotateWindow.restore();
                // Move to current display if needed
                const currentBounds = annotateWindow.getBounds();
                if (currentBounds.x !== display.bounds.x || currentBounds.y !== display.bounds.y) {
                    annotateWindow.setBounds(display.bounds);
                }
                annotateWindow.show();
                annotateWindow.setAlwaysOnTop(true, 'screen-saver');
            } else {
                annotateWindow = new BrowserWindow({
                    x: display.bounds.x,
                    y: display.bounds.y,
                    width: display.bounds.width,
                    height: display.bounds.height,
                    transparent: true,
                    frame: false,
                    fullscreen: true,
                    alwaysOnTop: true,
                    skipTaskbar: true,
                    hasShadow: false,
                    title: 'Annotate Layer',
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false,
                        webSecurity: false,
                        webviewTag: true
                    }
                });

                annotateWindow.setAlwaysOnTop(true, 'screen-saver');
                annotateWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'annotate', role: 'canvas' } });

                annotateWindow.on('closed', () => {
                    annotateWindow = null;
                    if (controlsWindow && !controlsWindow.isDestroyed()) controlsWindow.close();
                });
            }

            // Create Controls Window (Overlay) - this contains the toolbar for whiteboard/booth
            if (controlsWindow) {
                if (controlsWindow.isMinimized()) controlsWindow.restore();
                controlsWindow.setBounds(display.bounds);
                controlsWindow.show();
                controlsWindow.setAlwaysOnTop(true, 'screen-saver');
            } else {
                controlsWindow = new BrowserWindow({
                    x: display.bounds.x,
                    y: display.bounds.y,
                    width: display.bounds.width,
                    height: display.bounds.height,
                    transparent: true,
                    frame: false,
                    fullscreen: true,
                    alwaysOnTop: true,
                    type: 'toolbar',
                    skipTaskbar: true,
                    hasShadow: false,
                    title: 'Annotate Controls',
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false,
                        webSecurity: false,
                        webviewTag: true
                    }
                });

                controlsWindow.setAlwaysOnTop(true, 'screen-saver');
                controlsWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'annotate', role: 'controls' } });

                controlsWindow.on('closed', () => {
                    controlsWindow = null;
                    if (annotateWindow && !annotateWindow.isDestroyed()) annotateWindow.close();
                });
                
                // Open desktop toolbar after controls window is ready
                controlsWindow.webContents.once('did-finish-load', () => {
                    // Open desktop toolbar for annotation mode
                    setTimeout(() => {
                        if (currentMode === 'annotate') {
                            // Trigger desktop toolbar opening via IPC
                            controlsWindow.webContents.send('request-open-desktop-toolbar');
                        }
                    }, 100);
                });
            }

            // Focus annotate window for drawing
            if (annotateWindow) {
                annotateWindow.show();
                annotateWindow.focus();
            }
            
            // If controls window already exists, open desktop toolbar
            if (controlsWindow && controlsWindow.webContents && !controlsWindow.webContents.isLoading()) {
                controlsWindow.webContents.send('request-open-desktop-toolbar');
            }
        },

        openWhiteboard() {
            console.log('[ScreenAnnotate] openWhiteboard called');
            this.openAnnotate();

            // Switch both to whiteboard mode
            const sendAction = () => {
                if (annotateWindow) annotateWindow.webContents.send('action-whiteboard');
                if (controlsWindow) controlsWindow.webContents.send('action-whiteboard');
            };

            if (annotateWindow && annotateWindow.isLoading()) {
                annotateWindow.webContents.once('did-finish-load', sendAction);
            } else {
                sendAction();
            }
        },

        openBooth() {
            console.log('[ScreenAnnotate] openBooth called');
            this.openAnnotate();

            const sendAction = () => {
                if (annotateWindow) annotateWindow.webContents.send('action-booth');
                if (controlsWindow) controlsWindow.webContents.send('action-booth');
            };

            if (annotateWindow && annotateWindow.isLoading()) {
                annotateWindow.webContents.once('did-finish-load', sendAction);
            } else {
                sendAction();
            }
        },

        openSettings() {
            console.log('[ScreenAnnotate] openSettings called');
            this.openAnnotate();
            if (controlsWindow) {
                controlsWindow.webContents.send('annotate-open-settings-view');
            }
        },

        disabled() {
            if (annotateWindow) annotateWindow.close();
            if (controlsWindow) controlsWindow.close();
            cleanupListeners();
        }
    }
};
