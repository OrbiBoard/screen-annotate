const state = require('./state');

function applyTheme(mode, color) {
  const root = document.documentElement;
  const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'system' && isSystemDark);
  
  // Default to system/app theme
  let effectiveIsDark = isDark;
  
  // Override for Whiteboard Mode based on background brightness
  let preserveBg = false;
  if (state.MODE === 'whiteboard') {
      const bg = state.pageBackgrounds[state.currentPageIndex];
      if (bg && bg !== 'transparent' && bg !== 'var(--bg)') {
          effectiveIsDark = isColorDark(bg);
          preserveBg = true;
      } else {
          // If using default bg (var(--bg)), it follows the app theme (isDark)
          effectiveIsDark = isDark;
      }
  }

  // Adjust brightness helper
  const adjustBrightness = (hex, percent) => {
    if (!hex) return '#000000';
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (
      0x1000000 +
      (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255)
    ).toString(16).slice(1);
  };

  const accent = color || '#238f4a';
  root.style.setProperty('--accent', accent);
  const hex = accent.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);

  if (effectiveIsDark) {
    // Dark Mode
    if (!preserveBg) root.style.setProperty('--bg', '#071a12'); // Dark Green/Black default
    root.style.setProperty('--fg', '#ededed');
    root.style.setProperty('--muted', '#94a3b8');
    root.style.setProperty('--panel', 'rgba(22, 27, 34, 0.9)');
    root.style.setProperty('--border', 'rgba(255, 255, 255, 0.12)');
    root.style.setProperty('--hover', 'rgba(255, 255, 255, 0.08)');
    root.style.setProperty('--active', `rgba(${r}, ${g}, ${b}, 0.25)`);
    // New variables
    root.style.setProperty('--input-bg', 'rgba(255, 255, 255, 0.1)');
    root.style.setProperty('--secondary-bg', 'rgba(34, 46, 63, 0.95)');
    root.style.setProperty('--slider-bg', 'rgba(255, 255, 255, 0.2)');
    root.style.setProperty('--item-bg', 'rgba(255, 255, 255, 0.05)');
  } else {
    // Light Mode
    if (!preserveBg) root.style.setProperty('--bg', '#f3f4f6');
    root.style.setProperty('--fg', '#1f2937');
    root.style.setProperty('--muted', '#6b7280');
    root.style.setProperty('--panel', 'rgba(255, 255, 255, 0.9)'); // More opaque for light
    root.style.setProperty('--border', '#e5e7eb');
    root.style.setProperty('--hover', 'rgba(0, 0, 0, 0.05)');
    root.style.setProperty('--active', `rgba(${r}, ${g}, ${b}, 0.1)`);
    // New variables
    root.style.setProperty('--input-bg', 'rgba(0, 0, 0, 0.05)');
    root.style.setProperty('--secondary-bg', 'rgba(245, 245, 245, 0.95)');
    root.style.setProperty('--slider-bg', 'rgba(0, 0, 0, 0.1)');
    root.style.setProperty('--item-bg', 'rgba(0, 0, 0, 0.05)');
  }
}

function isColorDark(color) {
    if (!color) return true;
    if (color.startsWith('#')) {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return yiq < 128;
    }
    if (color.startsWith('rgb')) {
        const parts = color.match(/\d+/g);
        if (parts && parts.length >= 3) {
            const r = parseInt(parts[0]);
            const g = parseInt(parts[1]);
            const b = parseInt(parts[2]);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return yiq < 128;
        }
    }
    return true; // Default to dark if unknown
}

module.exports = { applyTheme };
