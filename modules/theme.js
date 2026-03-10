const state = require('./state');

const CSS_VARS = {
  dark: {
    '--bg': '#071a12',
    '--fg': '#ededed',
    '--muted': '#94a3b8',
    '--panel': 'rgba(22, 27, 34, 0.9)',
    '--border': 'rgba(255, 255, 255, 0.12)',
    '--hover': 'rgba(255, 255, 255, 0.08)',
    '--input-bg': 'rgba(255, 255, 255, 0.1)',
    '--secondary-bg': 'rgba(34, 46, 63, 0.95)',
    '--slider-bg': 'rgba(255, 255, 255, 0.2)',
    '--item-bg': 'rgba(255, 255, 255, 0.05)'
  },
  light: {
    '--bg': '#f3f4f6',
    '--fg': '#1f2937',
    '--muted': '#6b7280',
    '--panel': 'rgba(255, 255, 255, 0.9)',
    '--border': '#e5e7eb',
    '--hover': 'rgba(0, 0, 0, 0.05)',
    '--input-bg': 'rgba(0, 0, 0, 0.05)',
    '--secondary-bg': 'rgba(245, 245, 245, 0.95)',
    '--slider-bg': 'rgba(0, 0, 0, 0.1)',
    '--item-bg': 'rgba(0, 0, 0, 0.05)'
  }
};

function adjustBrightness(hex, percent) {
  if (!hex || typeof hex !== 'string') return '#238f4a';
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return hex;
  const num = parseInt(cleanHex, 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, (num >> 8 & 0x00FF) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
  return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 35, g: 143, b: 74 };
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return { r: 35, g: 143, b: 74 };
  return {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16)
  };
}

function getSystemDarkMode() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    return false;
  }
}

function getEffectiveMode(mode) {
  if (mode === 'system') {
    return getSystemDarkMode() ? 'dark' : 'light';
  }
  return mode === 'dark' ? 'dark' : 'light';
}

function isColorDark(color) {
  if (!color) return true;
  let r, g, b;
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else if (color.startsWith('rgb')) {
    const parts = color.match(/\d+/g);
    if (parts && parts.length >= 3) {
      r = parseInt(parts[0]);
      g = parseInt(parts[1]);
      b = parseInt(parts[2]);
    } else {
      return true;
    }
  } else {
    return true;
  }
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq < 128;
}

function applyTheme(mode, color) {
  const root = document.documentElement;
  const isSystemDark = getSystemDarkMode();
  const isDark = mode === 'dark' || (mode === 'system' && isSystemDark);
  
  let effectiveIsDark = isDark;
  let preserveBg = false;
  
  if (state.MODE === 'whiteboard') {
    const bg = state.pageBackgrounds[state.currentPageIndex];
    if (bg && bg !== 'transparent' && bg !== 'var(--bg)') {
      effectiveIsDark = isColorDark(bg);
      preserveBg = true;
    } else {
      effectiveIsDark = isDark;
    }
  }

  const accent = color || '#238f4a';
  const { r, g, b } = hexToRgb(accent);
  
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  
  const vars = CSS_VARS[effectiveIsDark ? 'dark' : 'light'];
  Object.entries(vars).forEach(([key, value]) => {
    if (key === '--bg' && preserveBg) return;
    root.style.setProperty(key, value);
  });
  
  const activeColor = effectiveIsDark 
    ? `rgba(${r}, ${g}, ${b}, 0.25)`
    : `rgba(${r}, ${g}, ${b}, 0.1)`;
  root.style.setProperty('--active', activeColor);
  
  if (effectiveIsDark) {
    root.classList.remove('theme-light');
    root.classList.add('theme-dark');
  } else {
    root.classList.remove('theme-dark');
    root.classList.add('theme-light');
  }
}

module.exports = { applyTheme, isColorDark, getSystemDarkMode, getEffectiveMode };
