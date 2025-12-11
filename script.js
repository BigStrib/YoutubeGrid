// ========================
// Global State & Constants!
// ========================
let isDragging = false;
let isResizing = false;
let currentElement = null;

let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;
let startLeft = 0;
let startTop = 0;
let resizeDirection = '';

let videoCounter = 0;
let allVideos = [];
let maxZIndex = 1;

// YouTube Player API
let players = {};
let progressIntervals = {};
let ytAPIReady = false;

const GRID_SIZE = 10;
const SNAP_THRESHOLD = 20;

const DEFAULT_LEFT = 100;
const DEFAULT_TOP = 100;

const MIN_WIDTH = 160;
const MIN_HEIGHT = 90;
const ASPECT_RATIO = 16 / 9;

// ========================
// YouTube API Loading
// ========================
function loadYouTubeAPI() {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
            ytAPIReady = true;
            resolve();
            return;
        }
        window.onYouTubeIframeAPIReady = () => {
            ytAPIReady = true;
            resolve();
        };
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    });
}
loadYouTubeAPI();

// ========================
// Helpers
// ========================
const isLocked = (container) => container.classList.contains('locked');

function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
}

function snapToGrid(value, fineSnap = false) {
    const size = fineSnap ? 5 : GRID_SIZE;
    return Math.round(value / size) * size;
}

function getYouTubeVideoId(input) {
    if (!input) return null;
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    let urlStr = trimmed;
    if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;

    let url;
    try { url = new URL(urlStr); } catch { return null; }

    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    const path = url.pathname;
    const segments = path.split('/').filter(Boolean);

    if (hostname === 'youtu.be' && segments.length >= 1) {
        const id = segments[0];
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (hostname.endsWith('youtube.com')) {
        const vParam = url.searchParams.get('v');
        if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;
        if (segments.length >= 2) {
            const known = ['embed', 'shorts', 'live', 'v'];
            if (known.includes(segments[0])) {
                const id = segments[1];
                return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
            }
        }
    }

    const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|v\/|watch\?v=|watch\?.+&v=))([^#&?]{11})/;
    const match = input.match(regExp);
    return match && match[1] ? match[1] : null;
}

function findSimilarSizes(currentVideo, targetWidth, targetHeight) {
    const similar = [];
    allVideos.forEach((video) => {
        if (video === currentVideo) return;
        const rect = video.getBoundingClientRect();
        const widthDiff = Math.abs(rect.width - targetWidth);
        const heightDiff = Math.abs(rect.height - targetHeight);
        if (widthDiff <= SNAP_THRESHOLD && heightDiff <= SNAP_THRESHOLD) {
            similar.push({ width: rect.width, height: rect.height });
        }
    });
    return similar;
}

function getSnappedSize(currentVideo, width, height) {
    const similar = findSimilarSizes(currentVideo, width, height);
    if (similar.length === 0) return { width, height };
    let closest = similar[0];
    let closestDist = Math.abs(closest.width - width) + Math.abs(closest.height - height);
    for (const size of similar) {
        const dist = Math.abs(size.width - width) + Math.abs(size.height - height);
        if (dist < closestDist) { closest = size; closestDist = dist; }
    }
    return { width: closest.width, height: closest.height };
}

function updateSizeIndicator(container, width, height) {
    if (!container) return;
    const indicator = container.querySelector('.size-indicator');
    if (!indicator) return;
    indicator.textContent = `${Math.round(width)} × ${Math.round(height)}`;
}

function bringToFront(container) {
    container.style.zIndex = ++maxZIndex;
}

function focusVideo(container) {
    if (isLocked(container)) return;
    bringToFront(container);
}

// ========================
// Check if Video is Live
// ========================
function isVideoLive(playerId) {
    const player = players[playerId];
    if (!player) return false;
    
    try {
        // Primary check: getVideoData().isLive
        const videoData = player.getVideoData();
        if (videoData && typeof videoData.isLive === 'boolean') {
            return videoData.isLive;
        }
        
        // Fallback: Check if duration is 0 or very large (can indicate live)
        const duration = player.getDuration();
        if (duration === 0) return true;
        
        // Some live streams report very large durations
        if (duration > 86400) return true; // More than 24 hours
        
    } catch {}
    
    return false;
}

// ========================
// Volume Slider Background Update (Red Fill)
// ========================
function updateVolumeSliderBackground(slider, value) {
    const percent = clampPercent(value);
    slider.style.background = `linear-gradient(to right, #b00 0%, #b00 ${percent}%, rgba(255,255,255,0.3) ${percent}%, rgba(255,255,255,0.3) 100%)`;
}

// ========================
// Delete Confirmation Popup
// ========================
function showDeleteConfirmation(container) {
    if (container.querySelector('.delete-confirm-overlay')) return;
    
    container.classList.add('confirming-delete');
    bringToFront(container);
    
    const playerId = container.dataset.playerId;
    const player = players[playerId];
    if (player) {
        try { player.pauseVideo(); } catch {}
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';
    
    overlay.innerHTML = `
        <div class="delete-confirm-content">
            <button class="delete-confirm-btn cancel" title="Cancel">
                <svg viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
            <button class="delete-confirm-btn confirm" title="Remove">
                <svg viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
            </button>
        </div>
    `;
    
    container.appendChild(overlay);
    
    const cancelBtn = overlay.querySelector('.cancel');
    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideDeleteConfirmation(container);
    });
    
    const confirmBtn = overlay.querySelector('.confirm');
    confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeVideo(container);
    });
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            hideDeleteConfirmation(container);
        }
    });
    
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            hideDeleteConfirmation(container);
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    overlay._escHandler = escHandler;
}

function hideDeleteConfirmation(container) {
    const overlay = container.querySelector('.delete-confirm-overlay');
    if (overlay) {
        if (overlay._escHandler) {
            document.removeEventListener('keydown', overlay._escHandler);
        }
        overlay.remove();
    }
    container.classList.remove('confirming-delete');
}

// ========================
// Top Controls (Move/Lock/Delete/Copy)
// ========================
function setLockIcon(button, locked) {
    const path = button.querySelector('svg path');
    if (!path) return;
    if (locked) {
        path.setAttribute('d',
            'M12,17A2,2 0 0,0 14,15V11A2,2 0 0,0 12,9A2,2 0 0,0 10,11V15A2,2 0 0,0 12,17M17,8H16V6A4,4 0 0,0 12,2A4,4 0 0,0 8,6V8H7A2,2 0 0,0 5,10V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V10A2,2 0 0,0 17,8M10,6A2,2 0 0,1 12,4A2,2 0 0,1 14,6V8H10V6Z'
        );
        button.classList.add('locked');
    } else {
        path.setAttribute('d',
            'M12,17A2,2 0 0,0 14,15V11A2,2 0 0,0 12,9A2,2 0 0,0 10,11V15A2,2 0 0,0 12,17M17,8H15V6A4,4 0 0,0 11,2A4,4 0 0,0 7,6H9A2,2 0 0,1 11,4A2,2 0 0,1 13,6V8H7A2,2 0 0,0 5,10V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V10A2,2 0 0,0 17,8Z'
        );
        button.classList.remove('locked');
    }
}

function lockVideo(container, lockButton) {
    container.classList.add('locked');
    setLockIcon(lockButton, true);
}

function unlockVideo(container, lockButton) {
    container.classList.remove('locked');
    setLockIcon(lockButton, false);
    bringToFront(container);
}

async function copyTextToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {}
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
}

function createControlButton(type, container) {
    const button = document.createElement('div');
    button.className = `control-btn ${type}-btn`;

    if (type === 'lock') {
        button.classList.add('lock-btn');
        button.innerHTML = `<svg viewBox="0 0 24 24" class="lock-icon"><path></path></svg>`;
        setLockIcon(button, isLocked(container));
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isLocked(container)) unlockVideo(container, button);
            else lockVideo(container, button);
        });
        return button;
    }

    if (type === 'move') {
        button.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M13,11H18L16.5,9.5L17.92,8.08L21.84,12L17.92,15.92L16.5,14.5L18,13H13V18L14.5,16.5L15.92,17.92L12,21.84L8.08,17.92L9.5,16.5L11,18V13H6L7.5,14.5L6.08,15.92L2.16,12L6.08,8.08L7.5,9.5L6,11H11V6L9.5,7.5L8.08,6.08L12,2.16L15.92,6.08L14.5,7.5L13,6V11Z"/>
            </svg>
        `;
        button.addEventListener('mousedown', (e) => { e.stopPropagation(); startMove(e, container); });
        return button;
    }

    if (type === 'copy') {
        button.classList.add('copy-btn');
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFFFFF">
                <path d="M15 1H4C2.9 1 2 1.9 2 3v12h2V3h11V1z"/>
                <path d="M17 5H7C5.9 5 5 5.9 5 7v14c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H7V7h10v14z"/>
            </svg>
        `;
        button.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = container.dataset.videoId;
            if (!id) return;
            const shortUrl = `https://youtu.be/${id}`;
            await copyTextToClipboard(shortUrl);
            button.classList.add('copied');
            setTimeout(() => button.classList.remove('copied'), 900);
        });
        return button;
    }

    if (type === 'delete') {
        button.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        `;
        button.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            showDeleteConfirmation(container);
        });
        return button;
    }

    return button;
}

// ================================
// Bottom Player Controls
// ================================
function createPlayerControls(container, playerId) {
    const controlsOverlay = document.createElement('div');
    controlsOverlay.className = 'player-controls-overlay';

    const leftControls = document.createElement('div');
    leftControls.className = 'player-controls-left';

    const playPauseBtn = document.createElement('button');
    playPauseBtn.className = 'player-control-btn play-pause-btn';
    playPauseBtn.innerHTML = `
        <svg class="play-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
        <svg class="pause-icon" viewBox="0 0 24 24" style="display:none;"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
    `;

    const volumeControl = document.createElement('div');
    volumeControl.className = 'volume-control';
    
    const volumeBtn = document.createElement('button');
    volumeBtn.className = 'player-control-btn volume-btn';
    volumeBtn.innerHTML = `
        <svg class="volume-high-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/></svg>
        <svg class="volume-mute-icon" viewBox="0 0 24 24" style="display:none;"><path fill="currentColor" d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z"/></svg>
    `;
    
    const volumeSliderContainer = document.createElement('div');
    volumeSliderContainer.className = 'volume-slider-container';
    
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range'; 
    volumeSlider.className = 'volume-slider';
    volumeSlider.min = '0'; 
    volumeSlider.max = '100'; 
    volumeSlider.value = '100';
    
    updateVolumeSliderBackground(volumeSlider, 100);
    
    volumeSliderContainer.appendChild(volumeSlider);
    volumeControl.appendChild(volumeBtn);
    volumeControl.appendChild(volumeSliderContainer);

    leftControls.appendChild(playPauseBtn);
    leftControls.appendChild(volumeControl);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    
    const progressBuffered = document.createElement('div');
    progressBuffered.className = 'progress-buffered';
    
    const progressFilled = document.createElement('div');
    progressFilled.className = 'progress-filled';
    
    const progressBall = document.createElement('div');
    progressBall.className = 'progress-ball';
    
    progressBar.appendChild(progressBuffered);
    progressBar.appendChild(progressFilled);
    progressBar.appendChild(progressBall);
    progressContainer.appendChild(progressBar);

    const rightControls = document.createElement('div');
    rightControls.className = 'player-controls-right';

    const liveBtn = document.createElement('button');
    liveBtn.className = 'live-btn';
    liveBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="18" height="18">
            <path fill="#f44336" d="M17.09,16.789L14.321,13.9C11.663,16.448,10,20.027,10,24s1.663,7.552,4.321,10.1l2.769-2.889 C15.19,29.389,14,26.833,14,24C14,21.167,15.19,18.61,17.09,16.789z"/>
            <circle cx="24" cy="24" r="6" fill="#f44336"/>
            <path fill="#f44336" d="M33.679,13.9l-2.769,2.889C32.81,18.611,34,21.167,34,24c0,2.833-1.19,5.389-3.09,7.211l2.769,2.889 C36.337,31.552,38,27.973,38,24S36.337,16.448,33.679,13.9z"/>
            <path fill="#f44336" d="M11.561,11.021l-2.779-2.9C4.605,12.125,2,17.757,2,24s2.605,11.875,6.782,15.879l2.779-2.9 C8.142,33.701,6,29.1,6,24S8.142,14.299,11.561,11.021z"/>
            <path fill="#f44336" d="M39.218,8.121l-2.779,2.9C39.858,14.299,42,18.9,42,24s-2.142,9.701-5.561,12.979l2.779,2.9 C43.395,35.875,46,30.243,46,24S43.395,12.125,39.218,8.121z"/>
        </svg>
    `;

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'player-control-btn fullscreen-btn';
    fullscreenBtn.innerHTML = `
        <svg class="expand-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
        <svg class="compress-icon" viewBox="0 0 24 24" style="display:none;"><path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
    `;

    rightControls.appendChild(liveBtn);
    rightControls.appendChild(fullscreenBtn);

    controlsOverlay.appendChild(leftControls);
    controlsOverlay.appendChild(progressContainer);
    controlsOverlay.appendChild(rightControls);

    controlsOverlay._playerId = playerId;
    controlsOverlay._playPauseBtn = playPauseBtn;
    controlsOverlay._volumeBtn = volumeBtn;
    controlsOverlay._volumeSlider = volumeSlider;
    controlsOverlay._volumeSliderContainer = volumeSliderContainer;
    controlsOverlay._progressContainer = progressContainer;
    controlsOverlay._progressBar = progressBar;
    controlsOverlay._progressFilled = progressFilled;
    controlsOverlay._progressBuffered = progressBuffered;
    controlsOverlay._progressBall = progressBall;
    controlsOverlay._liveBtn = liveBtn;
    controlsOverlay._fullscreenBtn = fullscreenBtn;

    playPauseBtn.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        e.preventDefault(); 
        togglePlayPause(playerId); 
    });
    
    volumeBtn.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        e.preventDefault(); 
        toggleMute(playerId); 
    });
    
    volumeSlider.addEventListener('input', (e) => { 
        e.stopPropagation(); 
        const value = e.target.value;
        setVolume(playerId, value);
        updateVolumeSliderBackground(volumeSlider, value);
    });
    
    volumeSlider.addEventListener('mousedown', (e) => { 
        e.stopPropagation(); 
        volumeSliderContainer.classList.add('active'); 
    });
    
    document.addEventListener('mouseup', () => { 
        volumeSliderContainer.classList.remove('active'); 
    });

    liveBtn.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        e.preventDefault(); 
        seekToLive(playerId); 
    });
    
    fullscreenBtn.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        e.preventDefault(); 
        toggleFullscreen(container); 
    });

    let isSeeking = false;
    
    const handleSeek = (e) => {
        const rect = progressBar.getBoundingClientRect();
        const barWidth = rect.width;
        
        let offsetX = e.clientX - rect.left;
        offsetX = Math.max(0, Math.min(offsetX, barWidth));
        
        let percent = (offsetX / barWidth) * 100;
        percent = clampPercent(percent);
        
        const player = players[playerId];
        if (player && player.getDuration) {
            const duration = player.getDuration();
            const seekTime = duration * (percent / 100);
            player.seekTo(seekTime, true);
            
            progressFilled.style.width = `${percent}%`;
            progressBall.style.left = `${percent}%`;
        }
    };
    
    progressContainer.addEventListener('mousedown', (e) => {
        e.stopPropagation(); 
        e.preventDefault();
        isSeeking = true; 
        handleSeek(e);
        container.classList.add('seeking');
    });
    
    document.addEventListener('mousemove', (e) => { 
        if (isSeeking) {
            e.preventDefault();
            handleSeek(e); 
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isSeeking) { 
            isSeeking = false; 
            container.classList.remove('seeking'); 
        }
    });

    controlsOverlay.addEventListener('mousedown', (e) => e.stopPropagation());
    controlsOverlay.addEventListener('click', (e) => e.stopPropagation());

    return controlsOverlay;
}

// ========================
// Player Control Functions
// ========================
function togglePlayPause(playerId) {
    const player = players[playerId];
    if (!player) return;
    try {
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) player.pauseVideo();
        else player.playVideo();
    } catch {}
}

function toggleMute(playerId) {
    const player = players[playerId];
    if (!player) return;
    try {
        if (player.isMuted()) player.unMute();
        else player.mute();
        updateVolumeUI(playerId);
    } catch {}
}

function setVolume(playerId, volume) {
    const player = players[playerId];
    if (!player) return;
    try {
        player.setVolume(volume);
        if (volume > 0 && player.isMuted()) player.unMute();
        updateVolumeUI(playerId);
    } catch {}
}

function updateVolumeUI(playerId) {
    const player = players[playerId];
    const container = document.querySelector(`[data-player-id="${playerId}"]`);
    if (!player || !container) return;
    const controlsOverlay = container.querySelector('.player-controls-overlay');
    if (!controlsOverlay) return;

    const volumeBtn = controlsOverlay._volumeBtn;
    const volumeSlider = controlsOverlay._volumeSlider;
    
    try {
        const isMuted = player.isMuted();
        const volume = player.getVolume();
        const highIcon = volumeBtn.querySelector('.volume-high-icon');
        const muteIcon = volumeBtn.querySelector('.volume-mute-icon');
        
        if (isMuted || volume === 0) {
            highIcon.style.display = 'none'; 
            muteIcon.style.display = 'block';
            volumeSlider.value = 0;
            updateVolumeSliderBackground(volumeSlider, 0);
        } else {
            highIcon.style.display = 'block'; 
            muteIcon.style.display = 'none';
            volumeSlider.value = volume;
            updateVolumeSliderBackground(volumeSlider, volume);
        }
    } catch {}
}

function seekToLive(playerId) {
    const player = players[playerId];
    if (!player) return;
    try {
        const duration = player.getDuration();
        player.seekTo(Math.max(0, duration), true);
    } catch (err) { 
        console.error('Seek to live error:', err); 
    }
}

function updatePlayerControls(playerId) {
    const player = players[playerId];
    const container = document.querySelector(`[data-player-id="${playerId}"]`);
    if (!player || !container) return;

    const controlsOverlay = container.querySelector('.player-controls-overlay');
    if (!controlsOverlay) return;

    const playPauseBtn = controlsOverlay._playPauseBtn;
    const progressFilled = controlsOverlay._progressFilled;
    const progressBuffered = controlsOverlay._progressBuffered;
    const progressBall = controlsOverlay._progressBall;
    const liveBtn = controlsOverlay._liveBtn;

    try {
        // Check if video is live
        const isLive = isVideoLive(playerId);
        
        // Update play/pause button state
        const state = player.getPlayerState();
        const playIcon = playPauseBtn.querySelector('.play-icon');
        const pauseIcon = playPauseBtn.querySelector('.pause-icon');
        if (state === YT.PlayerState.PLAYING) {
            playIcon.style.display = 'none'; 
            pauseIcon.style.display = 'block';
        } else {
            playIcon.style.display = 'block'; 
            pauseIcon.style.display = 'none';
        }

        if (isLive) {
            // Live video - progress bar always full, ball at end, seeking still enabled
            progressFilled.style.width = '100%';
            progressBall.style.left = '100%';
            progressBuffered.style.width = '100%';
            
            // Add live indicator class
            container.classList.add('is-live');
            if (liveBtn) liveBtn.classList.add('is-live');
            
            // Keep progress ball visible
            progressBall.style.opacity = '1';
            
        } else {
            // Regular video - normal progress calculation
            container.classList.remove('is-live');
            if (liveBtn) liveBtn.classList.remove('is-live');
            
            // Show the progress ball
            progressBall.style.opacity = '';
            
            const currentTime = player.getCurrentTime() || 0;
            const duration = player.getDuration() || 0;
            if (duration > 0) {
                let percent = (currentTime / duration) * 100;
                percent = clampPercent(percent);
                
                progressFilled.style.width = `${percent}%`;
                progressBall.style.left = `${percent}%`;
                
                let buffered = (player.getVideoLoadedFraction() || 0) * 100;
                buffered = clampPercent(buffered);
                progressBuffered.style.width = `${buffered}%`;
            }
        }

        updateVolumeUI(playerId);
    } catch {}
}

// ========================
// Fullscreen Controls Auto-Hide
// ========================
function setupFullscreenControlsAutoHide(container) {
    const playerControls = container.querySelector('.player-controls-overlay');
    if (!playerControls) return;
    
    let hideTimeout = null;
    let isOverControls = false;
    
    // Add transition for smooth fade
    playerControls.style.transition = 'opacity 0.3s ease';
    
    const hideControls = () => {
        if (!isOverControls && document.fullscreenElement === container) {
            playerControls.style.opacity = '0';
            playerControls.style.pointerEvents = 'none';
        }
    };
    
    const showControls = () => {
        playerControls.style.opacity = '1';
        playerControls.style.pointerEvents = 'auto';
        clearTimeout(hideTimeout);
        
        if (!isOverControls) {
            hideTimeout = setTimeout(hideControls, 3000);
        }
    };
    
    const onMouseMove = () => {
        showControls();
    };
    
    const onControlsEnter = () => {
        isOverControls = true;
        clearTimeout(hideTimeout);
        playerControls.style.opacity = '1';
        playerControls.style.pointerEvents = 'auto';
    };
    
    const onControlsLeave = () => {
        isOverControls = false;
        hideTimeout = setTimeout(hideControls, 1500);
    };
    
    const onMouseLeave = () => {
        if (document.fullscreenElement === container) {
            isOverControls = false;
            clearTimeout(hideTimeout);
            hideControls();
        }
    };
    
    // Add event listeners
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onMouseLeave);
    playerControls.addEventListener('mouseenter', onControlsEnter);
    playerControls.addEventListener('mouseleave', onControlsLeave);
    
    // Store handlers for cleanup
    container._fsHandlers = {
        onMouseMove,
        onMouseLeave,
        onControlsEnter,
        onControlsLeave,
        hideTimeout
    };
    
    // Initial state: show briefly then hide
    showControls();
}

function cleanupFullscreenControlsAutoHide(container) {
    const playerControls = container.querySelector('.player-controls-overlay');
    const handlers = container._fsHandlers;
    
    if (handlers) {
        clearTimeout(handlers.hideTimeout);
        container.removeEventListener('mousemove', handlers.onMouseMove);
        container.removeEventListener('mouseleave', handlers.onMouseLeave);
        
        if (playerControls) {
            playerControls.removeEventListener('mouseenter', handlers.onControlsEnter);
            playerControls.removeEventListener('mouseleave', handlers.onControlsLeave);
        }
        
        delete container._fsHandlers;
    }
    
    // Reset styles
    if (playerControls) {
        playerControls.style.transition = '';
        playerControls.style.opacity = '';
        playerControls.style.pointerEvents = '';
    }
}

function toggleFullscreen(container) {
    const fullscreenBtn = container.querySelector('.fullscreen-btn');
    const expandIcon = fullscreenBtn?.querySelector('.expand-icon');
    const compressIcon = fullscreenBtn?.querySelector('.compress-icon');
    const videoControls = container.querySelector('.video-controls');
    const resizeHandles = container.querySelectorAll('.resize-handle');
    const sizeIndicator = container.querySelector('.size-indicator');
    const hoverOutline = container.querySelector('.hover-outline');

    if (!document.fullscreenElement) {
        container.requestFullscreen().then(() => {
            if (expandIcon) expandIcon.style.display = 'none';
            if (compressIcon) compressIcon.style.display = 'block';
            container.classList.add('fullscreen');
            
            // Hide top buttons and other non-essential elements
            if (videoControls) videoControls.style.display = 'none';
            resizeHandles.forEach(h => h.style.display = 'none');
            if (sizeIndicator) sizeIndicator.style.display = 'none';
            if (hoverOutline) hoverOutline.style.display = 'none';
            
            // Setup auto-hide for bottom controls
            setupFullscreenControlsAutoHide(container);
            
        }).catch(err => console.error('Fullscreen error:', err));
    } else {
        document.exitFullscreen().then(() => {
            if (expandIcon) expandIcon.style.display = 'block';
            if (compressIcon) compressIcon.style.display = 'none';
            container.classList.remove('fullscreen');
            
            // Restore top buttons and other elements
            if (videoControls) videoControls.style.display = '';
            resizeHandles.forEach(h => h.style.display = '');
            if (sizeIndicator) sizeIndicator.style.display = '';
            if (hoverOutline) hoverOutline.style.display = '';
            
            // Cleanup auto-hide
            cleanupFullscreenControlsAutoHide(container);
        });
    }
}

document.addEventListener('fullscreenchange', () => {
    const containers = document.querySelectorAll('.video-container');
    containers.forEach(container => {
        const fullscreenBtn = container.querySelector('.fullscreen-btn');
        if (!fullscreenBtn) return;
        
        const expandIcon = fullscreenBtn.querySelector('.expand-icon');
        const compressIcon = fullscreenBtn.querySelector('.compress-icon');
        const videoControls = container.querySelector('.video-controls');
        const resizeHandles = container.querySelectorAll('.resize-handle');
        const sizeIndicator = container.querySelector('.size-indicator');
        const hoverOutline = container.querySelector('.hover-outline');
        
        if (document.fullscreenElement === container) {
            container.classList.add('fullscreen');
            if (expandIcon) expandIcon.style.display = 'none';
            if (compressIcon) compressIcon.style.display = 'block';
            
            // Hide top buttons and other non-essential elements
            if (videoControls) videoControls.style.display = 'none';
            resizeHandles.forEach(h => h.style.display = 'none');
            if (sizeIndicator) sizeIndicator.style.display = 'none';
            if (hoverOutline) hoverOutline.style.display = 'none';
            
            // Setup auto-hide for bottom controls
            setupFullscreenControlsAutoHide(container);
            
        } else {
            container.classList.remove('fullscreen');
            if (expandIcon) expandIcon.style.display = 'block';
            if (compressIcon) compressIcon.style.display = 'none';
            
            // Restore top buttons and other elements
            if (videoControls) videoControls.style.display = '';
            resizeHandles.forEach(h => h.style.display = '');
            if (sizeIndicator) sizeIndicator.style.display = '';
            if (hoverOutline) hoverOutline.style.display = '';
            
            // Cleanup auto-hide
            cleanupFullscreenControlsAutoHide(container);
        }
    });
});

// =====================
// Video Creation
// =====================
function createVideoContainer(videoId, options = {}) {
    videoCounter += 1;
    const playerId = `player-${videoCounter}`;

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${videoCounter}`;
    container.dataset.videoId = videoId;
    container.dataset.playerId = playerId;

    const width = typeof options.width === 'number' ? options.width : 320;
    const height = typeof options.height === 'number' ? options.height : 180;

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;

    const playerWrapper = document.createElement('div');
    playerWrapper.className = 'player-wrapper';
    const playerDiv = document.createElement('div');
    playerDiv.id = playerId;
    playerDiv.className = 'youtube-player';
    playerWrapper.appendChild(playerDiv);

    const outline = document.createElement('div');
    outline.className = 'hover-outline';
    ['top', 'right', 'bottom', 'left'].forEach((pos) => {
        const edge = document.createElement('div');
        edge.className = `hover-outline-edge hover-outline-${pos}`;
        edge.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            focusVideo(container);
        });
        outline.appendChild(edge);
    });

    const sizeIndicator = document.createElement('div');
    sizeIndicator.className = 'size-indicator';
    sizeIndicator.textContent = `${width} × ${height}`;

    const controls = document.createElement('div');
    controls.className = 'video-controls';
    const moveBtn = createControlButton('move', container);
    const lockBtn = createControlButton('lock', container);
    const copyBtn = createControlButton('copy', container);
    const deleteBtn = createControlButton('delete', container);
    controls.appendChild(moveBtn);
    controls.appendChild(lockBtn);
    controls.appendChild(copyBtn);
    controls.appendChild(deleteBtn);

    const playerControls = createPlayerControls(container, playerId);

    ['nw', 'ne', 'sw', 'se'].forEach((direction) => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-${direction}`;
        handle.addEventListener('mousedown', (e) => startResize(e, container, direction));
        container.appendChild(handle);
    });

    container.appendChild(playerWrapper);
    container.appendChild(outline);
    container.appendChild(sizeIndicator);
    container.appendChild(controls);
    container.appendChild(playerControls);

    const left = typeof options.left === 'number' ? options.left : DEFAULT_LEFT;
    const top = typeof options.top === 'number' ? options.top : DEFAULT_TOP;
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;

    container.style.zIndex = ++maxZIndex;

    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        focusVideo(container);
    });

    playerWrapper.addEventListener('click', () => {
        if (isLocked(container)) return;
        if (container.classList.contains('confirming-delete')) return;
        const player = players[playerId];
        if (!player) return;
        try {
            const state = player.getPlayerState();
            if (state === YT.PlayerState.PLAYING) player.pauseVideo();
            else player.playVideo();
        } catch {}
    });

    document.body.appendChild(container);
    allVideos.push(container);

    initYouTubePlayer(playerId, videoId, width, height);

    return container;
}

function initYouTubePlayer(playerId, videoId, width, height) {
    const createPlayer = () => {
        players[playerId] = new YT.Player(playerId, {
            width: width,
            height: height,
            videoId: videoId,
            playerVars: {
                autoplay: 0,
                controls: 0,
                modestbranding: 1,
                rel: 0,
                fs: 0,
                playsinline: 1,
                disablekb: 1,
                iv_load_policy: 3
            },
            events: {
                onReady: () => {
                    progressIntervals[playerId] = setInterval(() => {
                        updatePlayerControls(playerId);
                    }, 250);
                },
                onStateChange: () => {
                    updatePlayerControls(playerId);
                }
            }
        });
    };
    if (ytAPIReady) createPlayer();
    else {
        const checkAPI = setInterval(() => {
            if (ytAPIReady) { clearInterval(checkAPI); createPlayer(); }
        }, 100);
    }
}

// ====================
// Public UI Functions
// ====================
function addVideo() {
    const urlInput = document.getElementById('urlInput');
    if (!urlInput) return;
    const url = urlInput.value.trim();
    if (!url) return;

    const videoId = getYouTubeVideoId(url);
    if (!videoId) { alert('Please enter a valid YouTube URL or video ID'); return; }

    createVideoContainer(videoId);
    closeSearch();
}

function closeSearch() {
    const panel = document.getElementById('searchPanel');
    const urlInput = document.getElementById('urlInput');
    if (panel) panel.style.display = 'none';
    if (urlInput) urlInput.value = '';
}

function removeVideo(container) {
    // Cleanup fullscreen handlers if any
    cleanupFullscreenControlsAutoHide(container);
    
    const playerId = container.dataset.playerId;
    if (players[playerId]) { 
        try { players[playerId].destroy(); } catch {} 
        delete players[playerId]; 
    }
    if (progressIntervals[playerId]) { 
        clearInterval(progressIntervals[playerId]); 
        delete progressIntervals[playerId]; 
    }
    const idx = allVideos.indexOf(container);
    if (idx !== -1) allVideos.splice(idx, 1);
    container.remove();
}

window.addVideo = addVideo;
window.closeSearch = closeSearch;

// ==============
// Drag Handling
// ==============
function startMove(e, container) {
    if (isLocked(container)) return;
    isDragging = true; 
    currentElement = container;
    container.classList.add('dragging');
    focusVideo(container);
    const rect = container.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', stopMove);
    e.preventDefault();
}

function handleMove(e) {
    if (!isDragging || !currentElement) return;
    let newX = e.clientX - startX;
    let newY = e.clientY - startY;
    newX = snapToGrid(newX, true);
    newY = snapToGrid(newY, true);
    const rect = currentElement.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));
    currentElement.style.left = `${newX}px`;
    currentElement.style.top = `${newY}px`;
}

function stopMove() {
    if (!isDragging || !currentElement) return;
    isDragging = false;
    currentElement.classList.remove('dragging');
    currentElement = null;
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', stopMove);
}

// ===============
// Resize Handling
// ===============
function startResize(e, element, direction) {
    if (isLocked(element)) return;

    isResizing = true;
    currentElement = element;
    resizeDirection = direction;
    element.classList.add('resizing');

    focusVideo(element);

    const rect = element.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width;
    startHeight = rect.height;
    startLeft = rect.left;
    startTop = rect.top;

    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);

    e.preventDefault();
    e.stopPropagation();
}

function handleResize(e) {
    if (!isResizing || !currentElement) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    let newWidth = startWidth;
    let newHeight = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;

    if (resizeDirection.includes('e')) newWidth = Math.max(MIN_WIDTH, startWidth + deltaX);
    if (resizeDirection.includes('w')) { 
        newWidth = Math.max(MIN_WIDTH, startWidth - deltaX); 
        newLeft = startLeft + deltaX; 
    }
    if (resizeDirection.includes('s')) newHeight = Math.max(MIN_HEIGHT, startHeight + deltaY);
    if (resizeDirection.includes('n')) { 
        newHeight = Math.max(MIN_HEIGHT, startHeight - deltaY); 
        newTop = startTop + deltaY; 
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / ASPECT_RATIO;
    } else {
        newWidth = newHeight * ASPECT_RATIO;
    }

    const snapped = getSnappedSize(currentElement, newWidth, newHeight);
    newWidth = snapToGrid(snapped.width);
    newHeight = snapToGrid(snapped.height);

    updateSizeIndicator(currentElement, newWidth, newHeight);

    const maxX = window.innerWidth - newWidth;
    const maxY = window.innerHeight - newHeight;
    if (resizeDirection.includes('w')) {
        newLeft = Math.max(0, Math.min(newLeft, maxX));
        newLeft = snapToGrid(newLeft, true);
    }
    if (resizeDirection.includes('n')) {
        newTop = Math.max(0, Math.min(newTop, maxY));
        newTop = snapToGrid(newTop, true);
    }

    currentElement.style.width = `${newWidth}px`;
    currentElement.style.height = `${newHeight}px`;
    if (resizeDirection.includes('w') || resizeDirection.includes('n')) {
        currentElement.style.left = `${newLeft}px`;
        currentElement.style.top = `${newTop}px`;
    }

    const playerId = currentElement.dataset.playerId;
    const player = players[playerId];
    if (player && player.setSize) { 
        try { player.setSize(newWidth, newHeight); } catch {} 
    }
}

function stopResize() {
    if (!isResizing || !currentElement) return;
    isResizing = false;
    currentElement.classList.remove('resizing');
    currentElement = null;
    resizeDirection = '';

    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
}

// ===============
// DOM Bootstrap
// ===============
document.addEventListener('DOMContentLoaded', () => {
    const floatingIcon = document.getElementById('floatingIcon');
    const urlInput = document.getElementById('urlInput');
    const searchPanel = document.getElementById('searchPanel');

    if (!urlInput || !searchPanel) return;

    if (floatingIcon) {
        floatingIcon.style.cursor = 'pointer';
        floatingIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = searchPanel.style.display === 'block';
            searchPanel.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) urlInput.focus();
        });
    }

    document.addEventListener('keydown', (e) => {
        const activeTag = (document.activeElement && document.activeElement.tagName) || '';
        const typing = ['INPUT', 'TEXTAREA'].includes(activeTag);
        if (e.key === '/' && !typing) {
            e.preventDefault();
            searchPanel.style.display = 'block';
            urlInput.focus();
        }
        if (e.key === 'Escape') searchPanel.style.display = 'none';
    });

    urlInput.addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') addVideo(); 
    });

    document.addEventListener('click', (e) => {
        if (!searchPanel.contains(e.target) && !(floatingIcon && floatingIcon.contains(e.target))) {
            searchPanel.style.display = 'none';
        }
    });

});
