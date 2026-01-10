const { BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');

let annotateWindow = null;
let whiteboardWindow = null;

// Helper to remove listeners to avoid duplicates on reload
function cleanupListeners() {
  ipcMain.removeAllListeners('annotate-set-ignore-mouse-events');
  ipcMain.removeAllListeners('annotate-close');
  ipcMain.removeAllListeners('annotate-save-image');
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
          webSecurity: false
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
        if (whiteboardWindow.isMinimized()) whiteboardWindow.restore();
        whiteboardWindow.focus();
        return;
      }

      whiteboardWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        frame: false,
        backgroundColor: '#071a12',
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false
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
