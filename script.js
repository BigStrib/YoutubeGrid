// State variables
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

// Constants
const GRID_SIZE = 10;      // Smaller grid for smoother movement
const SNAP_THRESHOLD = 20; // Distance threshold for size snapping
const STORAGE_KEY = 'ytVideoManagerVideos';
const DEFAULT_LEFT = 100;  // New videos appear here
const DEFAULT_TOP = 100;   // New videos appear here

// ---------- Utility functions ----------

// Extract YouTube video ID from URL
function getYouTubeVideoId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
}

// Snap to grid with smoother movement
function snapToGrid(value, fineSnap = false) {
    const gridSize = fineSnap ? 5 : GRID_SIZE;
    return Math.round(value / gridSize) * gridSize;
}

// Find videos with similar sizes for snapping
function findSimilarSizes(currentVideo, targetWidth, targetHeight) {
    const similarSizes = [];
    
    allVideos.forEach(video => {
        if (video === currentVideo) return;
        
        const rect = video.getBoundingClientRect();
        const widthDiff = Math.abs(rect.width - targetWidth);
        const heightDiff = Math.abs(rect.height - targetHeight);
        
        if (widthDiff <= SNAP_THRESHOLD && heightDiff <= SNAP_THRESHOLD) {
            similarSizes.push({
                width: rect.width,
                height: rect.height,
                element: video
            });
        }
    });
    
    return similarSizes;
}

// Get snapped size
function getSnappedSize(currentVideo, width, height) {
    const similarSizes = findSimilarSizes(currentVideo, width, height);
    
    if (similarSizes.length > 0) {
        // Find the closest match
        let closest = similarSizes[0];
        let closestDistance = Math.abs(closest.width - width) + Math.abs(closest.height - height);
        
        similarSizes.forEach(size => {
            const distance = Math.abs(size.width - width) + Math.abs(size.height - height);
            if (distance < closestDistance) {
                closest = size;
                closestDistance = distance;
            }
        });
        
        return { width: closest.width, height: closest.height };
    }
    
    return { width, height };
}

// Update size indicator
function updateSizeIndicator(width, height, show = true) {
    const indicator = document.getElementById('sizeIndicator');
    if (show) {
        indicator.textContent = `${Math.round(width)} × ${Math.round(height)}`;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

// ---------- Controls / buttons ----------

function createControlButton(type) {
    const button = document.createElement('div');
    button.className = `control-btn ${type}-btn`;
    
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
            startMove(e, button.closest('.video-container'));
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
            removeVideo(button.closest('.video-container'));
        });
    }
    
    button.appendChild(tooltip);
    return button;
}

// ---------- Video creation / persistence ----------

function createVideoContainer(videoId, options = {}) {
    videoCounter++;

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = 'video-' + videoCounter;
    container.dataset.videoId = videoId;

    const width = (typeof options.width === 'number') ? options.width : 320;
    const height = (typeof options.height === 'number') ? options.height : 180;

    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1&modestbranding=1&rel=0`;
    iframe.width = width;
    iframe.height = height;
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;

    container.style.width = width + 'px';
    container.style.height = height + 'px';

    // Controls
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'video-controls';
    controlsContainer.appendChild(createControlButton('move'));
    controlsContainer.appendChild(createControlButton('delete'));

    // Resize handles
    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(direction => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-${direction}`;
        handle.addEventListener('mousedown', (e) => startResize(e, container, direction));
        container.appendChild(handle);
    });

    container.appendChild(iframe);
    container.appendChild(controlsContainer);

    // Position: new videos always spawn in same spot
    const left = (typeof options.left === 'number') ? options.left : DEFAULT_LEFT;
    const top = (typeof options.top === 'number') ? options.top : DEFAULT_TOP;
    container.style.left = left + 'px';
    container.style.top = top + 'px';

    // Ensure newest / moved videos are on top
    const zIndex = (typeof options.zIndex === 'number') ? options.zIndex : ++maxZIndex;
    container.style.zIndex = zIndex;
    if (zIndex > maxZIndex) {
        maxZIndex = zIndex;
    }

    document.body.appendChild(container);
    allVideos.push(container);

    return container;
}

function saveVideosToStorage() {
    try {
        const data = allVideos.map(container => {
            const rect = container.getBoundingClientRect();
            return {
                videoId: container.dataset.videoId,
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                zIndex: parseInt(container.style.zIndex, 10) || 1
            };
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('Error saving videos', e);
    }
}

function loadVideosFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
        const savedVideos = JSON.parse(raw);
        savedVideos.forEach(item => {
            createVideoContainer(item.videoId, {
                left: item.left,
                top: item.top,
                width: item.width,
                height: item.height,
                zIndex: item.zIndex
            });
        });
    } catch (e) {
        console.error('Error loading saved videos', e);
        // If corrupted, clear it to avoid infinite errors
        // localStorage.removeItem(STORAGE_KEY);
    }
}

// ---------- Public actions (used by HTML) ----------

function addVideo() {
    const urlInput = document.getElementById('urlInput');
    const url = urlInput.value.trim();
    if (!url) return;

    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
        alert('Please enter a valid YouTube URL');
        return;
    }

    // Create new video at fixed position (always same spot, on top)
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
    if (index > -1) {
        allVideos.splice(index, 1);
    }
    container.remove();
    saveVideosToStorage();
}

// ---------- Dragging ----------

function startMove(e, container) {
    isDragging = true;
    currentElement = container;
    container.classList.add('dragging');

    // Bring to front when you start moving it
    container.style.zIndex = ++maxZIndex;

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

    // Use finer snapping during movement
    newX = snapToGrid(newX, true);
    newY = snapToGrid(newY, true);

    // Constrain to viewport
    const rect = currentElement.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    currentElement.style.left = newX + 'px';
    currentElement.style.top = newY + 'px';
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

// ---------- Resizing ----------

function startResize(e, element, direction) {
    isResizing = true;
    currentElement = element;
    resizeDirection = direction;
    element.classList.add('resizing');
    
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

    // Calculate new dimensions based on resize direction
    if (resizeDirection.includes('e')) {
        newWidth = Math.max(160, startWidth + deltaX);
    }
    if (resizeDirection.includes('w')) {
        newWidth = Math.max(160, startWidth - deltaX);
        newLeft = startLeft + deltaX;
    }
    if (resizeDirection.includes('s')) {
        newHeight = Math.max(90, startHeight + deltaY);
    }
    if (resizeDirection.includes('n')) {
        newHeight = Math.max(90, startHeight - deltaY);
        newTop = startTop + deltaY;
    }

    // Maintain aspect ratio (16:9 for YouTube)
    const aspectRatio = 16 / 9;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / aspectRatio;
    } else {
        newWidth = newHeight * aspectRatio;
    }

    // Snap to similar sizes
    const snappedSize = getSnappedSize(currentElement, newWidth, newHeight);
    newWidth = snappedSize.width;
    newHeight = snappedSize.height;

    // Snap to grid for precise sizing
    newWidth = snapToGrid(newWidth);
    newHeight = snapToGrid(newHeight);

    // Update size indicator
    updateSizeIndicator(newWidth, newHeight);

    // Constrain to viewport
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

    // Apply new dimensions
    currentElement.style.width = newWidth + 'px';
    currentElement.style.height = newHeight + 'px';
    
    if (resizeDirection.includes('w') || resizeDirection.includes('n')) {
        currentElement.style.left = newLeft + 'px';
        currentElement.style.top = newTop + 'px';
    }

    const iframe = currentElement.querySelector('iframe');
    iframe.width = newWidth;
    iframe.height = newHeight;
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

// ---------- DOM setup ----------

document.addEventListener('DOMContentLoaded', () => {
    const floatingIcon = document.getElementById('floatingIcon');
    const urlInput = document.getElementById('urlInput');

    // Toggle search panel
    floatingIcon.addEventListener('click', function() {
        const panel = document.getElementById('searchPanel');
        const isVisible = panel.style.display === 'block';
        panel.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            urlInput.focus();
        }
    });

    // Handle Enter key in URL input
    urlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addVideo();
        }
    });

    // Close search panel when clicking outside
    document.addEventListener('click', function(e) {
        const panel = document.getElementById('searchPanel');
        const icon = document.getElementById('floatingIcon');
        
        if (!panel.contains(e.target) && !icon.contains(e.target)) {
            panel.style.display = 'none';
        }
    });

    // Load previously saved videos
    loadVideosFromStorage();
});