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

/**
 * Robust YouTube ID extractor
 */
function getYouTubeVideoId(input) {
    if (!input) return null;

    const trimmed = input.trim();

    // If user pasted just the ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
        return trimmed;
    }

    // Ensure we have a protocol so URL() works
    let urlStr = trimmed;
    if (!/^https?:\/\//i.test(urlStr)) {
        urlStr = 'https://' + urlStr;
    }

    let url;
    try {
        url = new URL(urlStr);
    } catch {
        return null;
    }

    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    const path = url.pathname;
    const segments = path.split('/').filter(Boolean);

    // youtu.be/<id>
    if (hostname === 'youtu.be' && segments.length >= 1) {
        const id = segments[0];
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    // *.youtube.com
    if (hostname.endsWith('youtube.com')) {
        const vParam = url.searchParams.get('v');
        if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
            return vParam;
        }

        if (segments.length >= 2) {
            const knownPrefixes = ['embed', 'shorts', 'live', 'v'];
            if (knownPrefixes.includes(segments[0])) {
                const id = segments[1];
                return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
            }
        }
    }

    // Fallback regex
    const regExp =
        /(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|v\/|watch\?v=|watch\?.+&v=))([^#&?]{11})/;
    const match = input.match(regExp);
    if (match && match[1]) {
        return match[1];
    }

    return null;
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

// Choose closest existing size if within SNAP_THRESHOLD
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
function bringToFront(container) {
    container.style.zIndex = ++maxZIndex;
}

// Centralized "focus" logic
function focusVideo(container) {
    if (isLocked(container)) return;
    bringToFront(container);
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
}

function unlockVideo(container, lockButton) {
    container.classList.remove('locked');
    setLockIcon(lockButton, false);
    bringToFront(container);
}

// ========================
// Control Button Creation
// ========================

function createControlButton(type, container) {
    const button = document.createElement('div');
    button.className = `control-btn ${type}-btn`;

    // Lock button
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

        setLockIcon(button, isLocked(container));

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

    // Move / Delete buttons
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
// Video Creation
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

    // Black outline edges around the video (aligned with the edges)
    const outline = document.createElement('div');
    outline.className = 'hover-outline';

    ['top', 'right', 'bottom', 'left'].forEach((pos) => {
        const edge = document.createElement('div');
        edge.className = `hover-outline-edge hover-outline-${pos}`;

        // Single click on edge brings video to front (if unlocked)
        edge.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return; // left button only
            focusVideo(container);
            // Allow bubbling; no preventDefault needed
        });

        outline.appendChild(edge);
    });

    // Controls
    const controls = document.createElement('div');
    controls.className = 'video-controls';

    const moveBtn = createControlButton('move', container);
    const lockBtn = createControlButton('lock', container);
    const deleteBtn = createControlButton('delete', container);

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
    container.appendChild(outline);   // outline above iframe, below controls
    container.appendChild(controls);

    // Position
    const left =
        typeof options.left === 'number' ? options.left : DEFAULT_LEFT;
    const top = typeof options.top === 'number' ? options.top : DEFAULT_TOP;
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;

    // z-index: new videos on top
    container.style.zIndex = ++maxZIndex;

    // Clicking the container (background) – unlocked only
    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // left-click only
        // Ignore clicks starting on control buttons (they stopPropagation)
        focusVideo(container);
    });

    // Clicking / pressing inside iframe – unlocked only
    iframe.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        focusVideo(container);
    });

    document.body.appendChild(container);
    allVideos.push(container);

    return container;
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
    if (!videoId) {
        alert('Please enter a valid YouTube URL or video ID');
        return;
    }

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
    const index = allVideos.indexOf(container);
    if (index !== -1) {
        allVideos.splice(index, 1);
    }
    container.remove();
}

// Expose functions for inline HTML handlers
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

    focusVideo(container); // also bring to front

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

    focusVideo(element); // also bring to front

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
}

// ===============
// DOM Bootstrap
// ===============

document.addEventListener('DOMContentLoaded', () => {
    const floatingIcon = document.getElementById('floatingIcon');
    const urlInput = document.getElementById('urlInput');
    const searchPanel = document.getElementById('searchPanel');

    if (!floatingIcon || !urlInput || !searchPanel) return;

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
});