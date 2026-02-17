const { BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');

let annotateWindow = null;
let whiteboardWindow = null;
let pluginApi = null;

// Helper to remove listeners to avoid duplicates on reload
function cleanupListeners() {
  ipcMain.removeAllListeners('annotate-set-ignore-mouse-events');
  ipcMain.removeAllListeners('annotate-close');
  ipcMain.removeAllListeners('annotate-minimize');
  ipcMain.removeAllListeners('annotate-save-image');
  ipcMain.removeAllListeners('annotate-insert-media');
  ipcMain.removeAllListeners('annotate-get-theme-config');
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

    ipcMain.on('annotate-close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.close();
    });

    ipcMain.on('annotate-minimize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        win.hide();
        win.setSkipTaskbar(true); // Ensure it's hidden from taskbar
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

    // Screenshot Handlers
    let screenshotRequestor = null;

    ipcMain.on('annotate-start-screenshot', (event) => {
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        
        // Identify requestor
        if (whiteboardWindow && senderWin === whiteboardWindow) {
            screenshotRequestor = 'whiteboard';
            whiteboardWindow.minimize();
        } else {
            screenshotRequestor = 'annotate';
        }
        
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
            }
            return null;
        }
    });
    
    ipcMain.on('annotate-screenshot-complete', (event, dataUrl) => {
        if (screenshotRequestor === 'whiteboard' && whiteboardWindow) {
            if (whiteboardWindow.isMinimized()) whiteboardWindow.restore();
            whiteboardWindow.show();
            whiteboardWindow.focus();
            whiteboardWindow.webContents.send('annotate-insert-media-reply', { type: 'image-data', dataUrl });
            
            // Hide helper window
            if (annotateWindow) {
                 annotateWindow.hide();
            }
        } else {
            // Requestor was annotate (or null), so we stay in annotate window
            // If we are using annotateWindow (we should be), send reply there
            if (annotateWindow) {
                annotateWindow.webContents.send('annotate-insert-media-reply', { type: 'image-data', dataUrl });
                // Do NOT hide. Just restore UI state in renderer.
            }
        }
        screenshotRequestor = null; // Reset
    });
  },

  functions: {
    openAnnotate() {
      console.log('[ScreenAnnotate] openAnnotate called');
      if (annotateWindow) {
        if (annotateWindow.isMinimized()) annotateWindow.restore();
        annotateWindow.focus();
        return;
      }

      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      // Use full screen size (including taskbar area) for overlay
      const display = screen.getPrimaryDisplay();
      
      annotateWindow = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        transparent: true,
        frame: false,
        fullscreen: true, // Use fullscreen to cover everything
        alwaysOnTop: true,
        type: 'toolbar', // Helps with keeping it on top
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false,
          webviewTag: true
        }
      });

      annotateWindow.setAlwaysOnTop(true, 'screen-saver'); // Ensure highest level
      annotateWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'annotate' } });
      
      annotateWindow.on('closed', () => {
        annotateWindow = null;
      });
    },

    openWhiteboard() {
      console.log('[ScreenAnnotate] openWhiteboard called');
      if (whiteboardWindow) {
        if (!whiteboardWindow.isVisible()) {
            whiteboardWindow.show();
            whiteboardWindow.setSkipTaskbar(false);
        }
        if (whiteboardWindow.isMinimized()) whiteboardWindow.restore();
        whiteboardWindow.focus();
        return;
      }

      whiteboardWindow = new BrowserWindow({
        fullscreen: true,
        frame: false,
        backgroundColor: '#071a12',
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false,
          webviewTag: true
        }
      });

      whiteboardWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'whiteboard' } });

      whiteboardWindow.on('closed', () => {
        whiteboardWindow = null;
      });
    },

    disabled() {
      if (annotateWindow) annotateWindow.close();
      if (whiteboardWindow) whiteboardWindow.close();
      cleanupListeners();
    }
  }
};
