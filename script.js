// ========================
// Global State & Constants
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
// Toast Notifications
// ========================
function showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast-message');
    if (existingToast) {
        existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = `toast-message ${type}`;
    
    let icon;
    if (type === 'success') {
        icon = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    } else {
        icon = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
    }
    
    toast.innerHTML = `${icon}<span>${message}</span>`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========================
// Update Video Count & Empty State
// ========================
function updateVideoCount() {
    const countEl = document.getElementById('videoCount');
    if (countEl) {
        countEl.textContent = allVideos.length;
    }
    updateEmptyState();
}

function updateEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (!emptyState) return;
    
    if (allVideos.length === 0) {
        emptyState.classList.add('visible');
    } else {
        emptyState.classList.remove('visible');
    }
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
            <button class="delete-confirm-btn cancel">
                <svg viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
            <button class="delete-confirm-btn confirm">
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
}

function hideDeleteConfirmation(container) {
    const overlay = container.querySelector('.delete-confirm-overlay');
    if (overlay) {
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

// ========================
// Smart Paste - Read from clipboard
// ========================
async function getClipboardText() {
    try {
        if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            return text;
        }
    } catch {}
    return null;
}

async function smartPaste() {
    const clipboardText = await getClipboardText();
    
    if (!clipboardText) {
        showToast('Unable to read clipboard', 'error');
        return false;
    }
    
    const videoId = getYouTubeVideoId(clipboardText);
    
    if (!videoId) {
        showToast('No valid YouTube URL in clipboard', 'error');
        return false;
    }
    
    createVideoContainer(videoId);
    showToast('Video added from clipboard', 'success');
    closeSidebar();
    return true;
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
            showToast('URL copied to clipboard', 'success');
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
    ['top', 'right', 'left'].forEach((pos) => {
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

    const left = typeof options.left === 'number' ? options.left : DEFAULT_LEFT;
    const top = typeof options.top === 'number' ? options.top : DEFAULT_TOP;
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;

    container.style.zIndex = ++maxZIndex;

    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        focusVideo(container);
    });

    document.body.appendChild(container);
    allVideos.push(container);

    initYouTubePlayer(playerId, videoId, width, height);
    
    updateVideoCount();

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
                controls: 1,
                modestbranding: 1,
                rel: 0,
                fs: 1,
                playsinline: 1
            },
            events: {
                onReady: () => {}
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
// Sidebar Functions
// ====================
function openSidebar() {
    document.body.classList.add('sidebar-open');
    
    setTimeout(() => {
        const urlInput = document.getElementById('urlInput');
        if (urlInput) urlInput.focus();
    }, 350);
}

function closeSidebar() {
    document.body.classList.remove('sidebar-open');
}

function toggleSidebar() {
    if (document.body.classList.contains('sidebar-open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

// ====================
// Public UI Functions
// ====================
function addVideo() {
    const urlInput = document.getElementById('urlInput');
    if (!urlInput) return;
    const url = urlInput.value.trim();
    if (!url) {
        showToast('Please enter a YouTube URL', 'error');
        return;
    }

    const videoId = getYouTubeVideoId(url);
    if (!videoId) { 
        showToast('Please enter a valid YouTube URL', 'error');
        return; 
    }

    createVideoContainer(videoId);
    urlInput.value = '';
    showToast('Video added successfully', 'success');
    
    closeSidebar();
}

function removeVideo(container) {
    const playerId = container.dataset.playerId;
    
    if (players[playerId]) { 
        try { players[playerId].destroy(); } catch {} 
        delete players[playerId]; 
    }
    const idx = allVideos.indexOf(container);
    if (idx !== -1) allVideos.splice(idx, 1);
    container.remove();
    
    updateVideoCount();
    
    showToast('Video removed', 'success');
}

// Expose functions globally
window.addVideo = addVideo;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.toggleSidebar = toggleSidebar;
window.showToast = showToast;
window.smartPaste = smartPaste;

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
    // Get sidebar elements
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const urlInput = document.getElementById('urlInput');
    const addVideoBtn = document.getElementById('addVideoBtn');
    
    // Sidebar toggle button
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            openSidebar();
        });
    }
    
    // Sidebar close button
    if (sidebarClose) {
        sidebarClose.addEventListener('click', (e) => {
            e.stopPropagation();
            closeSidebar();
        });
    }
    
    // Sidebar overlay click to close
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            closeSidebar();
        });
    }
    
    // Add video button in sidebar
    if (addVideoBtn) {
        addVideoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addVideo();
        });
    }
    
    // Enter key to add video
    if (urlInput) {
        urlInput.addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') {
                e.preventDefault();
                addVideo(); 
            }
        });
        
        // Smart paste - auto detect YouTube URL when pasting
        urlInput.addEventListener('paste', (e) => {
            setTimeout(() => {
                const pastedValue = urlInput.value.trim();
                const videoId = getYouTubeVideoId(pastedValue);
                
                if (videoId) {
                    // Valid YouTube URL - auto submit
                    createVideoContainer(videoId);
                    urlInput.value = '';
                    showToast('Video added from paste', 'success');
                    closeSidebar();
                }
            }, 10);
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const activeTag = (document.activeElement && document.activeElement.tagName) || '';
        const isTyping = ['INPUT', 'TEXTAREA'].includes(activeTag) || 
                         (document.activeElement && document.activeElement.isContentEditable);
        
        // Shift key to OPEN and CLOSE sidebar (toggle)
        if (e.key === 'Shift' && !e.repeat) {
            if (isTyping) {
                if (document.body.classList.contains('sidebar-open')) {
                    e.preventDefault();
                    closeSidebar();
                }
            } else {
                e.preventDefault();
                toggleSidebar();
            }
        }
        
        // Ctrl+V or Cmd+V to smart paste (when not in input)
        if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isTyping) {
            e.preventDefault();
            smartPaste();
        }
    });

    // Initialize video count and show empty state
    updateVideoCount();
});