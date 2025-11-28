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

const GRID_SIZE = 10;
const SNAP_THRESHOLD = 20;
const STORAGE_KEY = 'ytVideoManagerVideos';

const DEFAULT_LEFT = 100;
const DEFAULT_TOP = 100;

const MIN_WIDTH = 160;
const MIN_HEIGHT = 90;
const ASPECT_RATIO = 16 / 9;

// ===============
// Helper Methods
// ===============

const isLocked = (container) => container.classList.contains('locked');

function snapToGrid(value, fineSnap = false) {
    const size = fineSnap ? 5 : GRID_SIZE;
    return Math.round(value / size) * size;
}

// Extract YouTube video ID from URL
function getYouTubeVideoId(url) {
    const regExp =
        /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[7].length === 11 ? match[7] : null;
}

// Find videos with similar sizes for snapping
function findSimilarSizes(currentVideo, targetWidth, targetHeight) {
    const similarSizes = [];

    allVideos.forEach((video) => {
        if (video === currentVideo) return;

        const rect = video.getBoundingClientRect();
        const widthDiff = Math.abs(rect.width - targetWidth);
        const heightDiff = Math.abs(rect.height - targetHeight);

        if (widthDiff <= SNAP_THRESHOLD && heightDiff <= SNAP_THRESHOLD) {
            similarSizes.push({
                width: rect.width,
                height: rect.height
            });
        }
    });

    return similarSizes;
}

// Choose the closest existing size if within SNAP_THRESHOLD
function getSnappedSize(currentVideo, width, height) {
    const similar = findSimilarSizes(currentVideo, width, height);
    if (similar.length === 0) return { width, height };

    let closest = similar[0];
    let closestDistance =
        Math.abs(closest.width - width) + Math.abs(closest.height - height);

    for (const size of similar) {
        const distance =
            Math.abs(size.width - width) + Math.abs(size.height - height);
        if (distance < closestDistance) {
            closest = size;
            closestDistance = distance;
        }
    }

    return { width: closest.width, height: closest.height };
}

// Size indicator
function updateSizeIndicator(width, height, show = true) {
    const indicator = document.getElementById('sizeIndicator');
    if (!indicator) return;

    if (show) {
        indicator.textContent = `${Math.round(width)} × ${Math.round(height)}`;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

// Bring a video to the front (highest z-index)
function bringToFront(container, persist = false) {
    container.style.zIndex = ++maxZIndex;
    if (persist) {
        saveVideosToStorage();
    }
}

// Lock / unlock icon handling
function setLockIcon(button, locked) {
    const path = button.querySelector('svg path');
    const tooltip = button.querySelector('.tooltip');
    if (!path || !tooltip) return;

    if (locked) {
        // Locked icon
        path.setAttribute(
            'd',
            'M12,17A2,2 0 0,0 14,15V11A2,2 0 0,0 12,9A2,2 0 0,0 10,11V15A2,2 0 0,0 12,17M17,8H16V6A4,4 0 0,0 12,2A4,4 0 0,0 8,6V8H7A2,2 0 0,0 5,10V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V10A2,2 0 0,0 17,8M10,6A2,2 0 0,1 12,4A2,2 0 0,1 14,6V8H10V6Z'
        );
        tooltip.textContent = 'Unlock';
        button.classList.add('locked');
    } else {
        // Unlocked icon
        path.setAttribute(
            'd',
            'M12,17A2,2 0 0,0 14,15V11A2,2 0 0,0 12,9A2,2 0 0,0 10,11V15A2,2 0 0,0 12,17M17,8H15V6A4,4 0 0,0 11,2A4,4 0 0,0 7,6H9A2,2 0 0,1 11,4A2,2 0 0,1 13,6V8H7A2,2 0 0,0 5,10V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V10A2,2 0 0,0 17,8Z'
        );
        tooltip.textContent = 'Lock';
        button.classList.remove('locked');
    }
}

function lockVideo(container, lockButton) {
    container.classList.add('locked');
    setLockIcon(lockButton, true);
    saveVideosToStorage();
}

function unlockVideo(container, lockButton) {
    container.classList.remove('locked');
    setLockIcon(lockButton, false);
    bringToFront(container, true);
}

// ========================
// Control Button Creation
// ========================

function createControlButton(type, container) {
    const button = document.createElement('div');
    button.className = `control-btn ${type}-btn`;

    // ---- Lock button ----
    if (type === 'lock') {
        button.classList.add('lock-btn');
        button.innerHTML = `
            <svg viewBox="0 0 24 24" class="lock-icon">
                <path></path>
            </svg>
        `;
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        button.appendChild(tooltip);

        const initiallyLocked = isLocked(container);
        setLockIcon(button, initiallyLocked);

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isLocked(container)) {
                unlockVideo(container, button);
            } else {
                lockVideo(container, button);
            }
        });

        return button;
    }

    // ---- Move / Delete buttons ----
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';

    if (type === 'move') {
        button.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M13,11H18L16.5,9.5L17.92,8.08L21.84,12L17.92,15.92L16.5,14.5L18,13H13V18L14.5,16.5L15.92,17.92L12,21.84L8.08,17.92L9.5,16.5L11,18V13H6L7.5,14.5L6.08,15.92L2.16,12L6.08,8.08L7.5,9.5L6,11H11V6L9.5,7.5L8.08,6.08L12,2.16L15.92,6.08L14.5,7.5L13,6V11Z"/>
            </svg>
        `;
        tooltip.textContent = 'Move';
        button.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startMove(e, container);
        });
    } else if (type === 'delete') {
        button.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        `;
        tooltip.textContent = 'Delete';
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            removeVideo(container);
        });
    }

    button.appendChild(tooltip);
    return button;
}

// =====================
// Video Creation / I/O
// =====================

function createVideoContainer(videoId, options = {}) {
    videoCounter += 1;

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${videoCounter}`;
    container.dataset.videoId = videoId;

    const width = typeof options.width === 'number' ? options.width : 320;
    const height = typeof options.height === 'number' ? options.height : 180;

    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1&modestbranding=1&rel=0&playsinline=1`;
    iframe.width = width;
    iframe.height = height;
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;
    iframe.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;

    if (options.locked) {
        container.classList.add('locked');
    }

    // Controls
    const controls = document.createElement('div');
    controls.className = 'video-controls';

    const moveBtn = createControlButton('move', container);
    const lockBtn = createControlButton('lock', container);
    const deleteBtn = createControlButton('delete', container);

    // order: move, lock, delete (delete pushed to right via CSS)
    controls.appendChild(moveBtn);
    controls.appendChild(lockBtn);
    controls.appendChild(deleteBtn);

    // Resize handles
    ['nw', 'ne', 'sw', 'se'].forEach((direction) => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-${direction}`;
        handle.addEventListener('mousedown', (e) =>
            startResize(e, container, direction)
        );
        container.appendChild(handle);
    });

    container.appendChild(iframe);
    container.appendChild(controls);

    // Position
    const left =
        typeof options.left === 'number' ? options.left : DEFAULT_LEFT;
    const top = typeof options.top === 'number' ? options.top : DEFAULT_TOP;
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;

    // z-index: new videos on top, loaded videos keep their saved zIndex
    const zIndex =
        typeof options.zIndex === 'number' ? options.zIndex : ++maxZIndex;
    container.style.zIndex = zIndex;
    if (zIndex > maxZIndex) {
        maxZIndex = zIndex;
    }

    // Clicking the container (outside iframe) – unlocked only
    container.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // left-click only
        if (isLocked(container)) return;
        bringToFront(container, true);
    });

    // Clicking / focusing inside iframe – unlocked only
    iframe.addEventListener('focus', () => {
        if (isLocked(container)) return;
        bringToFront(container, true);
    });

    iframe.addEventListener('mousedown', () => {
        if (isLocked(container)) return;
        bringToFront(container, false);
    });

    document.body.appendChild(container);
    allVideos.push(container);

    return container;
}

function saveVideosToStorage() {
    try {
        const data = allVideos.map((container) => {
            const rect = container.getBoundingClientRect();
            return {
                videoId: container.dataset.videoId,
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                zIndex: parseInt(container.style.zIndex, 10) || 1,
                locked: isLocked(container)
            };
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
        console.error('Error saving videos to storage:', err);
    }
}

function loadVideosFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
        const savedVideos = JSON.parse(raw);
        savedVideos.forEach((item) => {
            createVideoContainer(item.videoId, {
                left: item.left,
                top: item.top,
                width: item.width,
                height: item.height,
                zIndex: item.zIndex,
                locked: item.locked
            });
        });
    } catch (err) {
        console.error('Error loading videos from storage:', err);
    }
}

// ====================
// Public UI Functions
// ====================

function addVideo() {
    const urlInput = document.getElementById('urlInput');
    const url = urlInput.value.trim();
    if (!url) return;

    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
        alert('Please enter a valid YouTube URL');
        return;
    }

    createVideoContainer(videoId);
    saveVideosToStorage();
    closeSearch();
}

function closeSearch() {
    const panel = document.getElementById('searchPanel');
    const urlInput = document.getElementById('urlInput');
    panel.style.display = 'none';
    urlInput.value = '';
}

function removeVideo(container) {
    const index = allVideos.indexOf(container);
    if (index !== -1) {
        allVideos.splice(index, 1);
    }
    container.remove();
    saveVideosToStorage();
}

// ==============
// Drag Handling
// ==============

function startMove(e, container) {
    if (isLocked(container)) return;

    isDragging = true;
    currentElement = container;
    container.classList.add('dragging');

    bringToFront(container, false);

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

    saveVideosToStorage();
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

    bringToFront(element, false);

    const rect = element.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width;
    startHeight = rect.height;
    startLeft = rect.left;
    startTop = rect.top;

    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.body.classList.add('show-grid');

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

    if (resizeDirection.includes('e')) {
        newWidth = Math.max(MIN_WIDTH, startWidth + deltaX);
    }
    if (resizeDirection.includes('w')) {
        newWidth = Math.max(MIN_WIDTH, startWidth - deltaX);
        newLeft = startLeft + deltaX;
    }
    if (resizeDirection.includes('s')) {
        newHeight = Math.max(MIN_HEIGHT, startHeight + deltaY);
    }
    if (resizeDirection.includes('n')) {
        newHeight = Math.max(MIN_HEIGHT, startHeight - deltaY);
        newTop = startTop + deltaY;
    }

    // Maintain aspect ratio
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / ASPECT_RATIO;
    } else {
        newWidth = newHeight * ASPECT_RATIO;
    }

    // Snap to existing sizes + grid
    const snapped = getSnappedSize(currentElement, newWidth, newHeight);
    newWidth = snapToGrid(snapped.width);
    newHeight = snapToGrid(snapped.height);

    updateSizeIndicator(newWidth, newHeight);

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

    const iframe = currentElement.querySelector('iframe');
    if (iframe) {
        iframe.width = newWidth;
        iframe.height = newHeight;
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
    document.body.classList.remove('show-grid');
    updateSizeIndicator(0, 0, false);

    saveVideosToStorage();
}

// ===============
// DOM Bootstrap
// ===============

document.addEventListener('DOMContentLoaded', () => {
    const floatingIcon = document.getElementById('floatingIcon');
    const urlInput = document.getElementById('urlInput');
    const searchPanel = document.getElementById('searchPanel');

    // Toggle search panel
    floatingIcon.addEventListener('click', () => {
        const isVisible = searchPanel.style.display === 'block';
        searchPanel.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            urlInput.focus();
        }
    });

    // Enter to add video
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addVideo();
        }
    });

    // Close search on outside click
    document.addEventListener('click', (e) => {
        if (!searchPanel.contains(e.target) && !floatingIcon.contains(e.target)) {
            searchPanel.style.display = 'none';
        }
    });

    // Load saved videos
    loadVideosFromStorage();
});
