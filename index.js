const { BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');

let annotateWindow = null;
let whiteboardWindow = null;

// Helper to remove listeners to avoid duplicates on reload
function cleanupListeners() {
  ipcMain.removeAllListeners('annotate-set-ignore-mouse-events');
  ipcMain.removeAllListeners('annotate-close');
  ipcMain.removeAllListeners('annotate-minimize');
  ipcMain.removeAllListeners('annotate-save-image');
  ipcMain.removeAllListeners('annotate-insert-media');
}

module.exports = {
  init(plugin) {
    console.log('[ScreenAnnotate] Plugin loaded');
    
    // Ensure clean state
    cleanupListeners();

    // Register IPC handlers
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
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false,
          webviewTag: true
        }
      });

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
