const state = require('./state');
const canvasModule = require('./canvas');

// Lazy load selection module to avoid circular dependency
let selectionModule;
function getSelectionModule() {
    if (!selectionModule) selectionModule = require('./selection');
    return selectionModule;
}

let mediaControlsTimeout;

function updateDOMObjects() {
    // If in fullscreen mode, handle differently
    if (state.fullscreen.active) {
        updateFullscreenObjects();
        return;
    }

    const strokes = state.pages[state.currentPageIndex] || [];
    const selection = getSelectionModule();

    // Map existing wrappers by ID
    const existingWrappers = new Map();
    document.querySelectorAll('.dom-object-wrapper').forEach(el => {
        if (el.dataset.id) existingWrappers.set(el.dataset.id, el);
    });

    // Track used IDs
    const usedIds = new Set();

    strokes.forEach((obj, index) => {
        if (!['video', 'audio', 'browser', 'link'].includes(obj.type)) return;

        const id = `obj-${index}`;
        usedIds.add(id);

        let wrapper = existingWrappers.get(id);
        const isActive = state.activeMedia && state.activeMedia.index === index;

        // Calculate Screen Coords
        const screenX = obj.x * state.camera.z + state.camera.x;
        const screenY = obj.y * state.camera.z + state.camera.y;
        const screenW = obj.w * state.camera.z;
        const screenH = obj.h * state.camera.z;

        // Determine if content rebuild is needed
        let needsRebuild = !wrapper;
        if (wrapper) {
            const hasMedia = wrapper.querySelector('video, audio');
            const shouldHaveMedia = isActive && (obj.type === 'video' || obj.type === 'audio');
            if (!!hasMedia !== shouldHaveMedia) needsRebuild = true;
            
            // Fix: Check if content changed (for reordering or object update)
            if (wrapper.dataset.src !== obj.src || wrapper.dataset.type !== obj.type) {
                needsRebuild = true;
            }
        }

        if (needsRebuild) {
            if (wrapper) wrapper.remove();
            wrapper = document.createElement('div');
            wrapper.className = 'dom-object-wrapper';
            wrapper.dataset.id = id;
            wrapper.dataset.src = obj.src; // Cache for check
            wrapper.dataset.type = obj.type; // Cache for check
            // document.body.appendChild(wrapper); // Moved below to ensure order

            // Render Content
            if (obj.type === 'link') {
                wrapper.className += ' link-object-btn';
                wrapper.textContent = obj.name;
                wrapper.onclick = () => {
                    if (!state.isMovingSelection) {
                        require('electron').shell.openExternal(obj.src);
                    }
                };
            } else if (obj.type === 'text') {
                // Text Object Rendering
                wrapper.className = 'text-object-wrapper';
                
                // Content Editable Div for editing
                const content = document.createElement('div');
                content.className = 'text-object-content';
                content.contentEditable = true; // Initially true? Or only on edit mode?
                // Let's make it editable on double click or always?
                // For better UX, always editable if selected?
                // But dragging requires pointer events on wrapper.
                // If contentEditable, dragging might select text.
                // We'll use a mode switch or handle events.
                
                content.innerText = obj.text || '';
                
                // Apply Styles
                content.style.fontSize = `${obj.fontSize}px`;
                content.style.fontFamily = obj.fontFamily;
                content.style.fontWeight = obj.bold ? 'bold' : 'normal';
                content.style.fontStyle = obj.italic ? 'italic' : 'normal';
                content.style.textDecoration = obj.underline ? 'underline' : 'none';
                content.style.color = obj.color;
                
                wrapper.appendChild(content);
                
                // Add event listeners for text editing
                // When editing, stop propagation to prevent dragging/selection changes
                content.onpointerdown = (e) => {
                    // If already selected, allow text selection/editing
                    if (state.selectedStrokeIndices.includes(index)) {
                        e.stopPropagation();
                    }
                    // Else, let wrapper handle selection first
                };
                
                // Auto-update state on object
                content.oninput = () => {
                    obj.text = content.innerText;
                    // Fix: Ensure w/h are initialized to prevent NaN
                    if (!obj.w) obj.w = 0;
                    if (!obj.h) obj.h = 0;
                    
                    obj.w = Math.max(obj.w, content.scrollWidth);
                    obj.h = Math.max(obj.h, content.scrollHeight);
                    wrapper.style.width = `${obj.w * state.camera.z}px`;
                    wrapper.style.height = `${obj.h * state.camera.z}px`;
                    selection.updateSelectionBounds();
                };

            } else if (isActive && (obj.type === 'video' || obj.type === 'audio')) {
                // Unified Media Creation Logic
                const media = document.createElement(obj.type); // 'video' or 'audio'
                media.src = obj.src;
                media.autoplay = true;
                
                if (obj.type === 'video') {
                    media.style.width = '100%';
                    media.style.height = '100%';
                    media.style.background = 'black';
                    media.style.pointerEvents = 'none'; // Ensure clicks go to wrapper for selection
                    wrapper.appendChild(media);
                    // selection.attachObjectListeners(media, obj, media); // Removed: Video has pointer-events: none, events go to wrapper
                } else {
                    // Audio: Use a dedicated child div for visuals (like video uses video element)
                    const card = document.createElement('div');
                    card.className = 'audio-playing-card';
                    card.innerHTML = `<i class="ri-music-line"></i><span>${obj.name}</span>`;
                    card.style.pointerEvents = 'none'; // Ensure clicks go to wrapper
                    
                    media.style.display = 'none'; // Audio element is hidden
                    
                    wrapper.appendChild(card);
                    wrapper.appendChild(media);
                    
                    // Note: Wrapper already has listeners attached at end of function
                    // And card has pointer-events: none so clicks go to wrapper
                }
                
                attachMediaControls(media, wrapper, obj.type);
            } else {
                // Render Placeholder
                wrapper.classList.add('media-placeholder');
                // Audio Layout Class
                if (obj.type === 'audio') {
                    wrapper.classList.add('audio-layout');
                }
                
                if (obj.type === 'video') {
                    if (obj.thumb) {
                        const img = document.createElement('img');
                        img.className = 'preview-thumb';
                        img.src = obj.thumb;
                        wrapper.appendChild(img);
                    }
                    const overlay = document.createElement('div');
                    overlay.className = 'preview-overlay';
                    overlay.innerHTML = `<i class="ri-play-circle-line" style="font-size: 48px; color: rgba(255,255,255,0.8);"></i><span style="background: rgba(0,0,0,0.5); padding: 2px 4px; border-radius: 4px;">${obj.name}</span>`;
                    wrapper.appendChild(overlay);
                } else if (obj.type === 'audio') {
                    wrapper.innerHTML = `<i class="ri-music-line"></i><span>${obj.name}</span>`;
                } else if (obj.type === 'browser') {
                    wrapper.innerHTML = `<i class="ri-global-line"></i><span>${obj.name}</span>`;
                }
            }
        }

        // Update Style / Position
        // Note: Fullscreen logic is now handled in updateFullscreenObjects, so here we only handle normal mode.
        // Ensure wrapper is in DOM and in correct order
        if (!wrapper.isConnected) {
             document.body.appendChild(wrapper);
        } else {
             // Move to end to ensure stacking order matches array order
             document.body.appendChild(wrapper);
        }

        wrapper.style.position = 'absolute';
        wrapper.style.left = `${screenX}px`;
        wrapper.style.top = `${screenY}px`;
        wrapper.style.width = `${screenW}px`;
        wrapper.style.height = `${screenH}px`;
        wrapper.style.zIndex = '10';
        wrapper.style.display = 'flex'; // Ensure visible
        wrapper.style.bottom = 'auto'; // Fix Issue 1: Prevent stretching
        wrapper.style.right = 'auto';  // Fix Issue 1: Prevent stretching
        
        // Apply Transforms (Rotation, Scale/Mirror)
        const rotation = obj.rotation || 0;
        const scaleX = obj.scaleX || 1;
        const scaleY = obj.scaleY || 1;
        wrapper.style.transform = `rotate(${rotation}rad) scaleX(${scaleX}) scaleY(${scaleY})`;
        wrapper.style.transformOrigin = 'center center';
        
        // Always attach listeners (selection module handles deduplication)
        selection.attachObjectListeners(wrapper, obj);
    });

    // Remove unused wrappers
    existingWrappers.forEach((el, id) => {
        if (!usedIds.has(id)) el.remove();
    });

    // Update controls position if active
    if (state.activeMedia) {
        const wrapper = document.querySelector(`.dom-object-wrapper[data-id="obj-${state.activeMedia.index}"]`);
        if (wrapper) {
            updateMediaControlsPosition(wrapper);
        } else {
            stopActiveMedia();
        }
    } else {
        const mediaControls = document.getElementById('media-controls');
        if (mediaControls) mediaControls.style.display = 'none';
    }

    updateObjectInteraction();
}

function updateFullscreenObjects() {
    // In fullscreen mode, only the active video is visible.
    const mediaControls = document.getElementById('media-controls');
    const toolbar = document.getElementById('main-toolbar');

    // Hide all normal wrappers except the active one
    document.querySelectorAll('.dom-object-wrapper').forEach(el => {
        if (el.dataset.id === `obj-${state.fullscreen.videoId}`) {
            el.style.display = 'block';
            el.style.position = 'fixed';

            // Fullscreen Layout:
            // Top: 0, Left: 0, Width: 100%
            // Height: 100% - Bottom Space
            // Bottom Space: Toolbar (80px maybe?) + Control Bar (let's say 60px) + Margin
            // The user requested: "Except top space for video frame, also leave space for control bar".
            // Let's reserve 100px at bottom for controls.
            
            // Get toolbar height/position to adjust
            const toolbarRect = toolbar.getBoundingClientRect();
            // Assuming toolbar is at bottom ~20px
            const bottomReserved = 160; // Enough space for controls + toolbar

            el.style.top = '0';
            el.style.left = '0';
            el.style.width = '100%';
            el.style.height = `calc(100% - ${bottomReserved}px)`;
            el.style.zIndex = '15'; // Below canvas (20) but above others
            // mediaControls.style.bottom = null;

            // Ensure controls are visible
            if (mediaControls.style.display !== 'none') {
                // Position controls fixed at bottom, above toolbar
                mediaControls.style.left = '0';
                mediaControls.style.transform = 'none';
                mediaControls.style.top = 'auto';
                mediaControls.style.bottom = `${toolbarRect.height + 40}px`; // Above toolbar
                mediaControls.style.width = '100%'; // Full width
                mediaControls.style.borderRadius = '0'; // Remove border radius
                mediaControls.style.borderLeft = 'none';
                mediaControls.style.borderRight = 'none';
            }
        } else {
            el.style.display = 'none';
        }
    });

    // Hide sidebar controls in fullscreen
    const pageControls = document.getElementById('page-controls');
    const leftControls = document.getElementById('left-controls');
    if (pageControls) pageControls.style.display = 'none';
    if (leftControls) leftControls.style.display = 'none';

    updateObjectInteraction();
}

function startActiveMedia(index) {
    state.activeMedia = { index };
    updateDOMObjects();
}

function stopActiveMedia() {
    state.activeMedia = null;
    if (state.fullscreen.active) {
        exitFullscreen();
    } else {
        // Ensure volume popup is hidden even if not fullscreen
        const volumePopup = document.getElementById('volume-popup');
        if (volumePopup) volumePopup.style.display = 'none';
        
        // Show sidebar controls again (in case they were hidden by fullscreen logic previously)
        const pageControls = document.getElementById('page-controls');
        const leftControls = document.getElementById('left-controls');
        if (pageControls) pageControls.style.display = 'flex'; 
        if (leftControls) leftControls.style.display = 'flex';
        
        updateDOMObjects();
    }
}

function updateVolumePopupPosition() {
    const volumeBtn = document.getElementById('media-volume-btn');
    const volumePopup = document.getElementById('volume-popup');
    if (!volumeBtn || !volumePopup || volumePopup.style.display === 'none') return;

    const btnRect = volumeBtn.getBoundingClientRect();
    // Get dimensions (might be hidden initially, but we check display)
    // We hardcoded 40x140 in CSS but better to measure
    const width = volumePopup.offsetWidth || 40;
    const height = volumePopup.offsetHeight || 140;

    // Center horizontally on button
    const left = btnRect.left + (btnRect.width / 2) - (width / 2);
    // Position above button with some gap
    const top = btnRect.top - height - 10;

    volumePopup.style.left = `${left}px`;
    volumePopup.style.top = `${top}px`;
}

function updateMediaControlsPosition(wrapper) {
    const controls = document.getElementById('media-controls');
    if (!controls || controls.style.display === 'none') return;
    
    if (state.fullscreen.active) {
         // Handled in updateFullscreenObjects, but we need to ensure updateFullscreenObjects is called?
         // Or just apply styles here too if updateDOMObjects calls this.
         // Yes, updateDOMObjects calls this.
         // Let's re-apply fullscreen styles here to be safe or just return.
         // But updateFullscreenObjects sets it once. If window resizes?
         // Let's delegate to updateFullscreenObjects logic or replicate minimal part.
         
         const toolbar = document.getElementById('main-toolbar');
         const toolbarRect = toolbar.getBoundingClientRect();
         
         controls.style.left = '0';
         controls.style.transform = 'none';
         controls.style.top = 'auto';
         controls.style.bottom = `${toolbarRect.height + 40}px`; 
         controls.style.width = '100%'; 
         controls.style.borderRadius = '0'; 
         controls.style.borderLeft = 'none';
         controls.style.borderRight = 'none';
         
         // Update Volume Popup Position if visible
         updateVolumePopupPosition();
         return;
    }

    // Reset styles for normal mode
    controls.style.borderRadius = '24px'; // Reset to pill
    controls.style.borderLeft = '1px solid var(--border)';
    controls.style.borderRight = '1px solid var(--border)';

    const rect = wrapper.getBoundingClientRect();
    
    // Match width
    controls.style.width = `${rect.width}px`;
    controls.style.transform = 'none'; // Reset any transform
    
    controls.style.left = `${rect.left}px`;
    controls.style.top = `${rect.bottom + 10}px`;
    // Fix Issue: Reset bottom to avoid conflict with fullscreen mode
    controls.style.bottom = 'auto';
    
    // Update Volume Popup Position if visible
    updateVolumePopupPosition();

    // Move Selection Toolbar if it overlaps
    const selectionToolbar = document.getElementById('selection-toolbar');
    if (selectionToolbar && selectionToolbar.style.display !== 'none') {
        // Fix: Update button state if active media is selected
        if (state.selectedStrokeIndices.length === 1 && state.selectedStrokeIndices[0] === state.activeMedia.index) {
             const btn = selectionToolbar.querySelector('.custom-action-btn'); // The play button is usually first
             if (btn) {
                 const media = wrapper.querySelector(state.activeMedia.index === state.selectedStrokeIndices[0] ? state.pages[state.currentPageIndex][state.activeMedia.index].type : 'video');
                 // Wait, we can just check the media element passed to this function? 
                 // No, updateMediaControlsPosition takes wrapper.
                 // Let's find media.
                 const vid = wrapper.querySelector('video, audio');
                 if (vid) {
                      const icon = btn.querySelector('i');
                      const span = btn.querySelector('span');
                      if (icon && span) {
                          if (vid.paused) {
                              icon.className = 'ri-play-fill';
                              span.textContent = '播放';
                          } else {
                              icon.className = 'ri-pause-fill';
                              span.textContent = '暂停';
                          }
                      }
                 }
             }
        }
    
        // Simple heuristic: if controls are shown, push selection toolbar down
        // Delegate positioning to selection module to avoid conflicts
        // const controlsRect = controls.getBoundingClientRect();
        // selectionToolbar.style.top = `${controlsRect.bottom + 10}px`;
    }
}

function attachMediaControls(media, wrapper, type) {
    const controls = document.getElementById('media-controls');
    const playBtn = document.getElementById('media-play-pause');
    const timeDisplay = document.getElementById('media-time');
    const fullBtn = document.getElementById('media-fullscreen');
    const closeBtn = document.getElementById('media-close');
    const progressBar = document.getElementById('media-progress');
    const volumeBtn = document.getElementById('media-volume-btn');
    const volumePopup = document.getElementById('volume-popup');
    const volumeSlider = document.getElementById('volume-slider');

    controls.style.display = 'flex';
    updateMediaControlsPosition(wrapper);

    // Update Play Button Icon
    const updatePlayIcon = () => {
        // Fix Issue 4: Icon sync
        // Check if element is still valid
        if (!media) return;
        // Use a small timeout to allow async state updates
        setTimeout(() => {
             playBtn.innerHTML = media.paused ? '<i class="ri-play-fill"></i>' : '<i class="ri-pause-fill"></i>';
        }, 0);
    };
    
    // Call immediately to set initial state
    updatePlayIcon();
    
    media.onplay = updatePlayIcon;
    media.onpause = updatePlayIcon;
    media.onplaying = updatePlayIcon; // Add playing event
    media.onwaiting = updatePlayIcon; // Add waiting event

    playBtn.onclick = (e) => {
        e.stopPropagation();
        if (media.paused) {
            media.play().then(() => updatePlayIcon()).catch(e => console.error(e));
        } else {
            media.pause();
            updatePlayIcon();
        }
    };

    // Volume Logic
    volumeBtn.onclick = (e) => {
        e.stopPropagation();
        if (volumePopup.style.display === 'none') {
            volumePopup.style.display = 'flex';
            updateVolumePopupPosition();
        } else {
            volumePopup.style.display = 'none';
        }
    };

    // Initialize Volume
    volumeSlider.value = media.volume * 100;
    
    volumeSlider.oninput = (e) => {
        e.stopPropagation();
        media.volume = e.target.value / 100;
        if (media.volume === 0) {
            volumeBtn.innerHTML = '<i class="ri-volume-mute-line"></i>';
        } else if (media.volume < 0.5) {
            volumeBtn.innerHTML = '<i class="ri-volume-down-line"></i>';
        } else {
            volumeBtn.innerHTML = '<i class="ri-volume-up-line"></i>';
        }
    };
    
    // Hide volume popup when clicking elsewhere
    const hideVolume = (e) => {
        if (volumePopup.style.display !== 'none' && !e.target.closest('#volume-popup') && !e.target.closest('#media-volume-btn')) {
            volumePopup.style.display = 'none';
        }
    };
    window.addEventListener('pointerdown', hideVolume);
    
    // Cleanup helper
    const cleanup = () => {
        window.removeEventListener('pointerdown', hideVolume);
        volumePopup.style.display = 'none';
    };
    
    // Hook cleanup into stopActiveMedia? 
    // stopActiveMedia calls updateDOMObjects which re-creates/hides things.
    // We should probably just hide popup in stopActiveMedia or when controls hide.
    // Since listeners are global, we need to be careful.
    // But since we attach listeners every time media starts, we might accumulate them?
    // Yes. We should remove old listener.
    if (controls.dataset.cleanupVolume) {
        // This is a hacky way to store the cleanup function. 
        // Better to manage listeners properly.
        // But for now, let's just use a named function if possible or check.
        // Or simple: removeEventListener with the same function reference?
        // But we define function inside.
        // Let's attach it to controls element.
        window.removeEventListener('pointerdown', controls._hideVolumeFn);
    }
    controls._hideVolumeFn = hideVolume;
    controls.dataset.cleanupVolume = 'true';

    // Progress Bar Logic
    media.ontimeupdate = () => {
        const cur = media.currentTime;
        const dur = media.duration || 0;
        timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;

        if (dur > 0) {
            const pct = (cur / dur) * 100;
            progressBar.value = pct;
            // Update background for filled effect
            progressBar.style.backgroundSize = `${pct}% 100%`;
        }

        updateMediaControlsPosition(wrapper);
    };

    progressBar.oninput = (e) => {
        e.stopPropagation();
        const val = e.target.value;
        const dur = media.duration || 0;
        if (dur > 0) {
            media.currentTime = (val / 100) * dur;
        }
    };

    // Prevent dragging when using slider
    progressBar.onpointerdown = (e) => e.stopPropagation();

    if (type === 'audio') {
        fullBtn.style.display = 'none';
    } else {
        fullBtn.style.display = 'block';

        const updateFullscreenIcon = () => {
            fullBtn.innerHTML = state.fullscreen.active ?
                '<i class="ri-fullscreen-exit-line"></i>' :
                '<i class="ri-fullscreen-line"></i>';
        };
        updateFullscreenIcon();

        fullBtn.onclick = (e) => {
            e.stopPropagation();
            if (state.fullscreen.active) {
                exitFullscreen();
            } else {
                enterFullscreen(state.activeMedia.index);
            }
            updateFullscreenIcon();
        };
    }

    closeBtn.onclick = (e) => {
        e.stopPropagation();
        stopActiveMedia();
    };

    // Auto-hide logic
    media.onended = () => {
        if (mediaControlsTimeout) clearTimeout(mediaControlsTimeout);
        mediaControlsTimeout = setTimeout(() => {
            stopActiveMedia();
        }, 10000); // 10s
    };

    const resetTimer = () => {
        if (mediaControlsTimeout) {
            clearTimeout(mediaControlsTimeout);
            mediaControlsTimeout = null;
        }
    };

    media.onplay = resetTimer;
    media.onclick = resetTimer;
    controls.onclick = resetTimer;
}

function enterFullscreen(index) {
    state.fullscreen.active = true;
    state.fullscreen.videoId = index;
    state.fullscreen.strokes = []; // Separate ink
    state.fullscreen.camera = { x: 0, y: 0, z: 1 };
    
    // Clear selection from page mode to avoid ghost selection toolbar
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    const selection = getSelectionModule();
    selection.updateSelectionBounds();
    selection.showSelectionToolbar();

    updateDOMObjects();
    canvasModule.renderCanvas();
}

function exitFullscreen() {
    state.fullscreen.active = false;
    state.fullscreen.videoId = null;
    
    // Clear selection from fullscreen mode
    state.selectedStrokeIndices = [];
    state.selectionBounds = null;
    const selection = getSelectionModule();
    selection.updateSelectionBounds();
    selection.showSelectionToolbar();
    
    // Hide Volume Popup
    const volumePopup = document.getElementById('volume-popup');
    if (volumePopup) volumePopup.style.display = 'none';

    // Show sidebar controls again
    const pageControls = document.getElementById('page-controls');
    const leftControls = document.getElementById('left-controls');
    if (pageControls) pageControls.style.display = 'flex';
    if (leftControls) leftControls.style.display = 'flex';

    updateDOMObjects();
    canvasModule.renderCanvas();
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateObjectInteraction() {
    // Fix for Issue 3: Shape and Select tools need canvas interaction
    const isInteractive = state.currentTool === 'pen' || 
                          state.currentTool === 'eraser' || 
                          state.currentTool === 'pan' || 
                          state.currentTool === 'shape' || 
                          state.currentTool === 'select';

    if (isInteractive) {
        // Fix for Issue: Allow click-through to DOM objects in Select mode
        // But keep 'auto' for other modes (Pen/Eraser) to capture input
        if (state.currentTool === 'select') {
            canvasModule.canvas.style.pointerEvents = 'none';
        } else {
            canvasModule.canvas.style.pointerEvents = 'auto';
        }
    } else {
        canvasModule.canvas.style.pointerEvents = 'none';
    }

    // Fix: Exclude video/audio from auto pointer-events as they should remain none (handled by wrapper)
    document.querySelectorAll('.dom-object-wrapper, iframe, .link-object-btn, webview').forEach(el => {
        // Fullscreen Special Logic:
        // If in fullscreen and tool is Select, we want to allow Lasso (start on window).
        // So the active fullscreen video wrapper should NOT capture events.
        if (state.fullscreen.active && state.currentTool === 'select' && 
            el.dataset.id === `obj-${state.fullscreen.videoId}`) {
            el.style.pointerEvents = 'none';
        } else {
            el.style.pointerEvents = 'auto';
        }
    });
}

module.exports = {
    updateDOMObjects,
    updateObjectInteraction,
    startActiveMedia,
    stopActiveMedia,
    enterFullscreen,
    exitFullscreen
};
