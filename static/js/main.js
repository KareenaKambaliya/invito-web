// INVITO Web Application Main JavaScript Suite
// Complete in-browser canvas positioning, contacts CRUD, bulk generator, and WhatsApp dispatcher

// ==================== GLOBAL STATE ====================
let appState = {
    currentTab: 'tab-dashboard',
    templateInfo: {
        exists: false,
        type: 'pdf',
        path: 'template.pdf',
        num_pages: 1,
        width: 595,
        height: 842,
        render_scale: 2.0
    },
    position: {
        x: 566,
        y: 313,
        pdf_x: 283.0,
        pdf_y: 156.5,
        page: 0,
        fontsize: 36,
        color: [220, 14, 14]
    },
    currentPage: 0,
    zoomScale: 1.0,
    pageImage: null,
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    nameBoundingBox: null,
    contacts: [],
    generatedFiles: [],
    eventSource: null,
    generationInterval: null,
    statusInterval: null
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupDropzones();
    setupCanvasEvents();
    setupMessageEditor();

    // Initial data fetches in parallel
    await Promise.all([
        fetchTemplateInfo(),
        fetchPosition(),
        loadContacts(),
        loadMessageTemplate(),
        loadGeneratedFiles(),
        checkAutomatedRunnerStatus()
    ]);

    // Load initial canvas page
    loadTemplatePage(appState.position.page || 0);
});

// ==================== NAVIGATION TABS ====================
function setupNavigation() {
    const menuItems = document.querySelectorAll('.sidebar .menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Hash navigation support
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '');
        if (hash) {
            const targetTab = `tab-${hash}`;
            if (document.getElementById(targetTab)) {
                switchTab(targetTab);
            }
        }
    });
}

function switchTab(tabId) {
    if (!tabId) return;
    appState.currentTab = tabId;

    // Update menu active class
    document.querySelectorAll('.sidebar .menu-item').forEach(el => {
        if (el.getAttribute('data-tab') === tabId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    // Update tab pane active class
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    const targetPane = document.getElementById(tabId);
    if (targetPane) {
        targetPane.classList.add('active');
    }

    // Update Top bar titles
    const titleMap = {
        'tab-dashboard': ['Dashboard', 'Manage your bulk WhatsApp invitations and workflow seamlessly.'],
        'tab-position': ['Visual Position Editor', 'Drag & drop the sample name to configure the exact print coordinates.'],
        'tab-contacts': ['Contacts & Upload', 'Upload contact spreadsheets and base invitation template files.'],
        'tab-message': ['Message Template', 'Customize the WhatsApp invitation text with dynamic recipient tags.'],
        'tab-generation': ['Batch Generation & Gallery', 'Create all personalized invitation cards and download them as ZIP.'],
        'tab-dispatcher': ['WhatsApp Dispatcher', 'Interactive web queue and automated WhatsApp automation engine.'],
        'tab-settings': ['Settings & Web Access', 'Instructions for accessing over local Wi-Fi or deploying to the cloud.']
    };

    if (titleMap[tabId]) {
        document.getElementById('page-title').innerText = titleMap[tabId][0];
        document.getElementById('page-subtitle').innerText = titleMap[tabId][1];
    }

    // Refresh specific view if needed
    if (tabId === 'tab-position') {
        setTimeout(renderCanvas, 50);
    } else if (tabId === 'tab-dispatcher') {
        loadWhatsAppQueue();
    } else if (tabId === 'tab-generation') {
        loadGeneratedFiles();
    }
}

// ==================== TEMPLATE INFO & POSITION APIS ====================
async function fetchTemplateInfo() {
    try {
        const res = await fetch('/api/template/info');
        const data = await res.json();
        if (data.success && data.info.exists) {
            appState.templateInfo = data.info;
            document.getElementById('sidebar-tpl-name').innerText = data.info.path || 'template.pdf';
            document.getElementById('sidebar-tpl-status').innerText = `${data.info.num_pages} Page${data.info.num_pages > 1 ? 's' : ''}`;
            document.getElementById('dash-template-pages').innerText = data.info.num_pages;
            document.getElementById('quick-template-pill').innerText = data.info.path;

            if (data.info.position && data.info.position.x !== undefined) {
                applyPositionData(data.info.position);
            }
        }
    } catch (e) {
        console.error('Failed to fetch template info', e);
    }
}

async function fetchPosition() {
    try {
        const res = await fetch('/api/position');
        const data = await res.json();
        if (data.success && data.position) {
            applyPositionData(data.position);
        }
    } catch (e) {
        console.error('Failed to fetch position', e);
    }
}

function applyPositionData(pos) {
    appState.position = Object.assign(appState.position, pos);
    appState.currentPage = parseInt(pos.page || 0);

    // Sync inputs
    const fontsizeInput = document.getElementById('editor-fontsize');
    if (fontsizeInput) {
        fontsizeInput.value = pos.fontsize || 36;
        document.getElementById('fontsize-val').innerText = `${pos.fontsize || 36} pt`;
    }

    if (pos.color && Array.isArray(pos.color)) {
        const hex = rgbToHex(pos.color[0], pos.color[1], pos.color[2]);
        const colorInput = document.getElementById('editor-color-picker');
        if (colorInput) colorInput.value = hex;
    }

    updateCoordinateDisplays();
}

function updateCoordinateDisplays() {
    const scale = appState.templateInfo.render_scale || 2.0;
    const pdfX = (appState.position.x / scale).toFixed(1);
    const pdfY = (appState.position.y / scale).toFixed(1);

    document.getElementById('coord-pdf-x').innerText = `${pdfX} pt`;
    document.getElementById('coord-pdf-y').innerText = `${pdfY} pt`;
    document.getElementById('coord-page').innerText = (appState.currentPage + 1);

    appState.position.pdf_x = parseFloat(pdfX);
    appState.position.pdf_y = parseFloat(pdfY);
    appState.position.page = appState.currentPage;
}

// ==================== VISUAL POSITION CANVAS EDITOR ====================
async function loadTemplatePage(pageIndex) {
    const loader = document.getElementById('canvas-loader');
    if (loader) loader.style.display = 'flex';

    appState.currentPage = pageIndex;
    const total = appState.templateInfo.num_pages || 1;
    document.getElementById('page-indicator').innerText = `Page ${pageIndex + 1} of ${total}`;
    document.getElementById('coord-page').innerText = pageIndex + 1;

    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `/api/template/page/${pageIndex}?t=${new Date().getTime()}`;

        img.onload = () => {
            appState.pageImage = img;
            if (loader) loader.style.display = 'none';

            // Auto fit zoom on initial load if large
            const viewport = document.getElementById('canvas-viewport');
            if (viewport && viewport.clientWidth > 0 && img.width > 0) {
                const fitScale = (viewport.clientWidth - 80) / img.width;
                if (fitScale < 1.0) {
                    appState.zoomScale = Math.max(0.3, Math.min(1.0, parseFloat(fitScale.toFixed(2))));
                    document.getElementById('zoom-level').innerText = `${Math.round(appState.zoomScale * 100)}%`;
                }
            }

            renderCanvas();
        };

        img.onerror = () => {
            if (loader) loader.innerHTML = `<span style="color:var(--danger-color)">Failed to load page ${pageIndex + 1}</span>`;
        };
    } catch (e) {
        console.error('Error loading template page', e);
    }
}

function renderCanvas() {
    const canvas = document.getElementById('position-canvas');
    if (!canvas || !appState.pageImage) return;

    const ctx = canvas.getContext('2d');
    const img = appState.pageImage;

    // Set canvas dimensions
    const displayW = img.width * appState.zoomScale;
    const displayH = img.height * appState.zoomScale;

    canvas.width = displayW;
    canvas.height = displayH;
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    // 1. Draw base template page
    ctx.drawImage(img, 0, 0, displayW, displayH);

    // 2. Compute text parameters
    const sampleName = document.getElementById('editor-sample-name').value.trim() || 'Sample Name';
    const rawFontsize = parseInt(document.getElementById('editor-fontsize').value) || 36;
    const colorHex = document.getElementById('editor-color-picker').value || '#dc0e0e';

    // Scale font size by zoom & render scale
    const renderScale = appState.templateInfo.render_scale || 2.0;
    const canvasFontSize = (rawFontsize * renderScale) * appState.zoomScale;

    ctx.font = `600 ${canvasFontSize}px 'Noto Sans Gujarati', Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cx = appState.position.x * appState.zoomScale;
    const cy = appState.position.y * appState.zoomScale;

    // Measure text
    const metrics = ctx.measureText(sampleName);
    const textW = metrics.width;
    const textH = canvasFontSize * 1.1;

    // Save bounding box for drag detection
    const padding = 12 * appState.zoomScale;
    appState.nameBoundingBox = {
        x: cx - textW / 2 - padding,
        y: cy - textH / 2 - padding,
        w: textW + padding * 2,
        h: textH + padding * 2
    };

    // 3. Draw Crosshairs
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(displayW, cy);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, displayH);
    ctx.stroke();
    ctx.restore();

    // 4. Draw bounding box around text
    ctx.save();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
        appState.nameBoundingBox.x,
        appState.nameBoundingBox.y,
        appState.nameBoundingBox.w,
        appState.nameBoundingBox.h
    );

    // Corner handles
    ctx.fillStyle = '#6366f1';
    const handleSize = 6;
    ctx.fillRect(appState.nameBoundingBox.x - handleSize/2, appState.nameBoundingBox.y - handleSize/2, handleSize, handleSize);
    ctx.fillRect(appState.nameBoundingBox.x + appState.nameBoundingBox.w - handleSize/2, appState.nameBoundingBox.y - handleSize/2, handleSize, handleSize);
    ctx.fillRect(appState.nameBoundingBox.x - handleSize/2, appState.nameBoundingBox.y + appState.nameBoundingBox.h - handleSize/2, handleSize, handleSize);
    ctx.fillRect(appState.nameBoundingBox.x + appState.nameBoundingBox.w - handleSize/2, appState.nameBoundingBox.y + appState.nameBoundingBox.h - handleSize/2, handleSize, handleSize);
    ctx.restore();

    // 5. Draw text with stroke for high contrast
    ctx.save();
    ctx.lineWidth = Math.max(2, 3 * appState.zoomScale);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(sampleName, cx, cy);

    ctx.fillStyle = colorHex;
    ctx.fillText(sampleName, cx, cy);
    ctx.restore();
}

function setupCanvasEvents() {
    const canvas = document.getElementById('position-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (isInsideBoundingBox(mouseX, mouseY)) {
            appState.isDragging = true;
            appState.dragOffsetX = mouseX - (appState.position.x * appState.zoomScale);
            appState.dragOffsetY = mouseY - (appState.position.y * appState.zoomScale);
            canvas.style.cursor = 'grabbing';
        } else {
            // Immediate click to reposition
            appState.position.x = mouseX / appState.zoomScale;
            appState.position.y = mouseY / appState.zoomScale;
            updateCoordinateDisplays();
            renderCanvas();

            appState.isDragging = true;
            appState.dragOffsetX = 0;
            appState.dragOffsetY = 0;
            canvas.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!appState.isDragging || !canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const newX = (mouseX - appState.dragOffsetX) / appState.zoomScale;
        const newY = (mouseY - appState.dragOffsetY) / appState.zoomScale;

        // Keep within canvas bounds
        if (appState.pageImage) {
            appState.position.x = Math.max(10, Math.min(appState.pageImage.width - 10, newX));
            appState.position.y = Math.max(10, Math.min(appState.pageImage.height - 10, newY));
        }

        updateCoordinateDisplays();
        renderCanvas();
    });

    window.addEventListener('mouseup', () => {
        if (appState.isDragging) {
            appState.isDragging = false;
            if (canvas) canvas.style.cursor = 'crosshair';
        }
    });

    // Hover cursor styling
    canvas.addEventListener('mousemove', (e) => {
        if (appState.isDragging) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (isInsideBoundingBox(mouseX, mouseY)) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    });

    // Keyboard Arrow keys for micro-adjustments
    window.addEventListener('keydown', (e) => {
        if (appState.currentTab !== 'tab-position') return;
        if (['input', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) return;

        const step = e.shiftKey ? 10 : 1;
        let handled = false;

        if (e.key === 'ArrowLeft') {
            appState.position.x -= step;
            handled = true;
        } else if (e.key === 'ArrowRight') {
            appState.position.x += step;
            handled = true;
        } else if (e.key === 'ArrowUp') {
            appState.position.y -= step;
            handled = true;
        } else if (e.key === 'ArrowDown') {
            appState.position.y += step;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            updateCoordinateDisplays();
            renderCanvas();
        }
    });

    // Real-time control change bindings
    document.getElementById('editor-sample-name').addEventListener('input', renderCanvas);
    document.getElementById('editor-fontsize').addEventListener('input', (e) => {
        document.getElementById('fontsize-val').innerText = `${e.target.value} pt`;
        appState.position.fontsize = parseInt(e.target.value);
        renderCanvas();
    });
    document.getElementById('editor-color-picker').addEventListener('input', (e) => {
        appState.position.color = hexToRgb(e.target.value);
        renderCanvas();
    });
}

function isInsideBoundingBox(x, y) {
    if (!appState.nameBoundingBox) return false;
    const b = appState.nameBoundingBox;
    return x >= b.x && x <= (b.x + b.w) && y >= b.y && y <= (b.y + b.h);
}

function prevTemplatePage() {
    if (appState.currentPage > 0) {
        loadTemplatePage(appState.currentPage - 1);
    }
}

function nextTemplatePage() {
    const maxPages = appState.templateInfo.num_pages || 1;
    if (appState.currentPage < maxPages - 1) {
        loadTemplatePage(appState.currentPage + 1);
    }
}

function zoomCanvas(delta) {
    appState.zoomScale = Math.max(0.2, Math.min(3.0, parseFloat((appState.zoomScale + delta).toFixed(2))));
    document.getElementById('zoom-level').innerText = `${Math.round(appState.zoomScale * 100)}%`;
    renderCanvas();
}

function resetZoom() {
    const viewport = document.getElementById('canvas-viewport');
    if (viewport && appState.pageImage) {
        const fitScale = (viewport.clientWidth - 60) / appState.pageImage.width;
        appState.zoomScale = Math.max(0.2, Math.min(1.5, parseFloat(fitScale.toFixed(2))));
        document.getElementById('zoom-level').innerText = `${Math.round(appState.zoomScale * 100)}%`;
        renderCanvas();
    }
}

function centerNameHorizontally() {
    if (appState.pageImage) {
        appState.position.x = appState.pageImage.width / 2;
        updateCoordinateDisplays();
        renderCanvas();
        showToast('Name centered horizontally.', 'info');
    }
}

function setColor(hex) {
    document.getElementById('editor-color-picker').value = hex;
    appState.position.color = hexToRgb(hex);
    renderCanvas();
}

async function saveNamePosition() {
    const btn = document.getElementById('btn-save-pos');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Saving...';
    btn.disabled = true;

    const colorHex = document.getElementById('editor-color-picker').value;
    const colorRgb = hexToRgb(colorHex);
    const fontsize = parseInt(document.getElementById('editor-fontsize').value) || 36;

    const payload = {
        x: appState.position.x,
        y: appState.position.y,
        pdf_x: appState.position.pdf_x,
        pdf_y: appState.position.pdf_y,
        page: appState.currentPage,
        fontsize: fontsize,
        color: colorRgb
    };

    try {
        const res = await fetch('/api/position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('Position and style saved successfully!', 'success');
        } else {
            showToast(data.error || 'Failed to save position', 'error');
        }
    } catch (e) {
        showToast('Network error saving position', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function previewExactBackendRender() {
    const btn = document.getElementById('btn-preview-render');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Rendering...';
    btn.disabled = true;

    const modal = document.getElementById('preview-modal');
    const modalImg = document.getElementById('preview-modal-img');
    const loader = document.getElementById('preview-loading');

    modal.style.display = 'flex';
    loader.style.display = 'flex';
    modalImg.style.display = 'none';

    const sampleName = document.getElementById('editor-sample-name').value.trim() || 'Sample Name';
    const colorRgb = hexToRgb(document.getElementById('editor-color-picker').value);
    const fontsize = parseInt(document.getElementById('editor-fontsize').value) || 36;

    try {
        const res = await fetch('/api/template/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: sampleName,
                x: appState.position.x,
                y: appState.position.y,
                pdf_x: appState.position.pdf_x,
                pdf_y: appState.position.pdf_y,
                page: appState.currentPage,
                fontsize: fontsize,
                color: colorRgb
            })
        });

        if (res.ok) {
            const blob = await res.blob();
            modalImg.src = URL.createObjectURL(blob);
            modalImg.onload = () => {
                loader.style.display = 'none';
                modalImg.style.display = 'block';
            };
        } else {
            showToast('Failed to generate real preview', 'error');
            closePreviewModal();
        }
    } catch (e) {
        showToast('Network error fetching preview', 'error');
        closePreviewModal();
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function closePreviewModal() {
    document.getElementById('preview-modal').style.display = 'none';
}

// ==================== DROPZONES & FILE UPLOADS ====================
function setupDropzones() {
    // 1. Quick Contacts Dropzone
    setupSingleDropzone('quick-contacts-drop', 'input-contacts-file', handleContactsUpload);
    setupSingleDropzone('contacts-upload-area', 'contacts-file-input', handleContactsUpload);

    // 2. Template Dropzone
    setupSingleDropzone('quick-template-drop', 'input-template-file', handleTemplateUpload);
    setupSingleDropzone('template-upload-area', 'template-file-input', handleTemplateUpload);
}

function setupSingleDropzone(dropzoneId, inputId, uploadHandler) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', () => input.click());

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            uploadHandler(e.dataTransfer.files[0]);
        }
    });

    input.addEventListener('change', () => {
        if (input.files.length) {
            uploadHandler(input.files[0]);
        }
    });
}

async function handleContactsUpload(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    showToast(`Uploading ${file.name}...`, 'info');

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            document.getElementById('quick-contacts-pill').innerText = file.name;
            await loadContacts();
        } else {
            showToast(data.error || 'Upload failed', 'error');
        }
    } catch (e) {
        showToast('Network error during upload', 'error');
    }
}

async function handleTemplateUpload(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    showToast(`Uploading template ${file.name}...`, 'info');

    try {
        const res = await fetch('/upload-pdf', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            document.getElementById('quick-template-pill').innerText = file.name;
            await fetchTemplateInfo();
            loadTemplatePage(0);
        } else {
            showToast(data.error || 'Template upload failed', 'error');
        }
    } catch (e) {
        showToast('Network error uploading template', 'error');
    }
}

// ==================== CONTACTS MANAGEMENT ====================
async function loadContacts() {
    try {
        const res = await fetch('/api/contacts');
        const data = await res.json();
        if (data.success) {
            appState.contacts = data.contacts;
            renderContactsTable(data.contacts);
            updateDashboardMetrics();
        }
    } catch (e) {
        console.error('Failed to load contacts', e);
    }
}

function renderContactsTable(contacts) {
    const tbody = document.getElementById('contacts-table-body');
    if (!tbody) return;

    if (!contacts || contacts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">
            <i class="ph ph-users" style="font-size: 2.5rem; display:block; margin-bottom: 0.5rem;"></i>
            No contacts found. Upload an Excel file or click "Add Contact".
        </td></tr>`;
        return;
    }

    const searchTerm = (document.getElementById('contacts-search-input')?.value || '').toLowerCase();
    const filtered = contacts.filter(c => 
        c.name.toLowerCase().includes(searchTerm) || c.number.includes(searchTerm)
    );

    tbody.innerHTML = filtered.map((c, idx) => `
        <tr>
            <td style="color:var(--text-muted); font-size:0.85rem;">${idx + 1}</td>
            <td style="font-weight:600; font-family:'Noto Sans Gujarati', var(--font-main);">${escapeHtml(c.name)}</td>
            <td style="color:var(--text-secondary);">${escapeHtml(c.number)}</td>
            <td>
                ${c.has_invitation ? 
                    `<span class="badge-status success"><i class="ph ph-check-circle"></i> Ready</span>` : 
                    `<span class="badge-status secondary"><i class="ph ph-clock"></i> Pending</span>`
                }
            </td>
            <td>
                ${c.is_sent ? 
                    `<span class="badge-status success"><i class="ph ph-check-circle"></i> Sent</span>` : 
                    `<span class="badge-status warning"><i class="ph ph-hourglass"></i> Unsent</span>`
                }
            </td>
            <td>
                <div class="table-actions-cell">
                    ${c.has_invitation ? `
                        <a href="/api/preview/${encodeURIComponent(c.invitation_file)}" target="_blank" class="btn-icon" title="View Invitation PDF">
                            <i class="ph ph-file-pdf"></i>
                        </a>
                    ` : ''}
                    <button class="btn-icon" onclick="openEditContactModal(${c.id}, '${escapeQuote(c.name)}', '${escapeQuote(c.number)}')" title="Edit Contact">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="btn-icon" onclick="deleteContact(${c.id})" title="Delete Contact" style="color:var(--danger-color)">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    // Setup live search listener once
    const searchInput = document.getElementById('contacts-search-input');
    if (searchInput && !searchInput.dataset.hasListener) {
        searchInput.dataset.hasListener = 'true';
        searchInput.addEventListener('input', () => renderContactsTable(appState.contacts));
    }
}

function openAddContactModal() {
    document.getElementById('modal-title').innerHTML = '<i class="ph ph-user-plus"></i> Add New Contact';
    document.getElementById('modal-contact-id').value = '';
    document.getElementById('modal-contact-name').value = '';
    document.getElementById('modal-contact-number').value = '';
    document.getElementById('contact-modal').style.display = 'flex';
}

function openEditContactModal(id, name, number) {
    document.getElementById('modal-title').innerHTML = '<i class="ph ph-pencil-simple"></i> Edit Contact';
    document.getElementById('modal-contact-id').value = id;
    document.getElementById('modal-contact-name').value = name;
    document.getElementById('modal-contact-number').value = number;
    document.getElementById('contact-modal').style.display = 'flex';
}

function closeContactModal() {
    document.getElementById('contact-modal').style.display = 'none';
}

async function submitContactModal() {
    const id = document.getElementById('modal-contact-id').value;
    const name = document.getElementById('modal-contact-name').value.trim();
    const number = document.getElementById('modal-contact-number').value.trim();

    if (!name) {
        showToast('Please enter contact name', 'error');
        return;
    }

    try {
        let res;
        if (id === '') {
            res = await fetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, number })
            });
        } else {
            res = await fetch(`/api/contacts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, number })
            });
        }

        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            closeContactModal();
            loadContacts();
        } else {
            showToast(data.error || 'Failed to save contact', 'error');
        }
    } catch (e) {
        showToast('Network error saving contact', 'error');
    }
}

async function deleteContact(id) {
    if (!confirm('Are you sure you want to delete this contact?')) return;

    try {
        const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('Contact deleted', 'success');
            loadContacts();
        } else {
            showToast(data.error || 'Failed to delete contact', 'error');
        }
    } catch (e) {
        showToast('Network error deleting contact', 'error');
    }
}

// ==================== MESSAGE TEMPLATE ====================
function setupMessageEditor() {
    const input = document.getElementById('message-template-input');
    if (!input) return;

    input.addEventListener('input', () => {
        updateMessagePreview(input.value);
    });
}

async function loadMessageTemplate() {
    try {
        const res = await fetch('/api/message');
        const data = await res.json();
        if (data.success) {
            document.getElementById('message-template-input').value = data.message;
            updateMessagePreview(data.message);
        }
    } catch (e) {
        console.error('Failed to load message', e);
    }
}

function updateMessagePreview(templateText) {
    const bubble = document.getElementById('whatsapp-bubble-text');
    if (!bubble) return;

    const sampleContact = appState.contacts.length > 0 ? appState.contacts[0] : { name: 'શ્રી રમેશભાઈ પટેલ', number: '919876543210' };
    document.getElementById('preview-contact-name').innerText = sampleContact.name;

    let rendered = templateText
        .replace(/{{name}}/g, sampleContact.name)
        .replace(/{{number}}/g, sampleContact.number);

    bubble.innerText = rendered;

    // Time stamp
    const now = new Date();
    document.getElementById('bubble-timestamp').innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function insertTag(tag) {
    const textarea = document.getElementById('message-template-input');
    insertAtCursor(textarea, tag);
    updateMessagePreview(textarea.value);
}

function insertEmoji(emoji) {
    const textarea = document.getElementById('message-template-input');
    insertAtCursor(textarea, emoji);
    updateMessagePreview(textarea.value);
}

function insertAtCursor(myField, myValue) {
    if (document.selection) {
        myField.focus();
        sel = document.selection.createRange();
        sel.text = myValue;
    } else if (myField.selectionStart || myField.selectionStart == '0') {
        const startPos = myField.selectionStart;
        const endPos = myField.selectionEnd;
        myField.value = myField.value.substring(0, startPos) + myValue + myField.value.substring(endPos, myField.value.length);
        myField.selectionStart = startPos + myValue.length;
        myField.selectionEnd = startPos + myValue.length;
    } else {
        myField.value += myValue;
    }
    myField.focus();
}

async function saveMessageTemplate() {
    const btn = document.getElementById('btn-save-message');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Saving...';
    btn.disabled = true;

    const message = document.getElementById('message-template-input').value;

    try {
        const res = await fetch('/api/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Message template saved successfully!', 'success');
        } else {
            showToast(data.error || 'Failed to save template', 'error');
        }
    } catch (e) {
        showToast('Network error saving template', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ==================== BATCH GENERATION & GALLERY ====================
async function startBatchGeneration() {
    const btn = document.getElementById('btn-batch-gen');
    if (btn) btn.disabled = true;

    showToast('Starting batch invitation generation...', 'info');

    try {
        const res = await fetch('/api/generate-batch', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            document.getElementById('progress-card').style.display = 'block';
            pollGenerationProgress();
        } else {
            showToast(data.error || 'Failed to start generation', 'error');
            if (btn) btn.disabled = false;
        }
    } catch (e) {
        showToast('Network error triggering generation', 'error');
        if (btn) btn.disabled = false;
    }
}

function pollGenerationProgress() {
    if (appState.generationInterval) clearInterval(appState.generationInterval);

    appState.generationInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/generate-progress');
            const data = await res.json();

            const bar = document.getElementById('progress-bar-fill');
            const percentLabel = document.getElementById('progress-percent');
            const subLabel = document.getElementById('progress-sub');

            if (bar) bar.style.width = `${data.percent}%`;
            if (percentLabel) percentLabel.innerText = `${data.percent}%`;
            if (subLabel) subLabel.innerText = `Processing: ${data.current} / ${data.total} (${data.current_name || 'Done'})`;

            if (data.completed || !data.is_running) {
                clearInterval(appState.generationInterval);
                appState.generationInterval = null;
                const btn = document.getElementById('btn-batch-gen');
                if (btn) btn.disabled = false;

                if (data.error) {
                    showToast(`Generation completed with error: ${data.error}`, 'error');
                } else {
                    showToast('All invitations generated successfully!', 'success');
                }

                // Refresh gallery and contacts
                loadGeneratedFiles();
                loadContacts();
            }
        } catch (e) {
            console.error('Progress poll failed', e);
        }
    }, 600);
}

async function loadGeneratedFiles() {
    try {
        const res = await fetch('/api/generated-files');
        const data = await res.json();
        if (data.success) {
            appState.generatedFiles = data.files;
            document.getElementById('gallery-count').innerText = data.count;
            document.getElementById('sidebar-card-count').innerText = data.count;
            document.getElementById('dash-generated-count').innerText = data.count;

            const grid = document.getElementById('gallery-grid');
            if (!grid) return;

            if (data.files.length === 0) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--text-muted);">
                    <i class="ph ph-file-pdf" style="font-size:3rem; margin-bottom:0.5rem; display:block;"></i>
                    No invitations generated yet. Click "Generate All Cards" above.
                </div>`;
                return;
            }

            grid.innerHTML = data.files.map(f => `
                <div class="card-item">
                    <div class="card-thumb">
                        <i class="ph ph-file-pdf"></i>
                    </div>
                    <div class="card-meta">
                        <span class="card-name" title="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</span>
                        <span class="card-date">${f.size_kb} KB • ${f.modified}</span>
                    </div>
                    <div class="card-actions">
                        <a href="${f.preview_url}" target="_blank" class="btn btn-secondary" style="padding:0.4rem; font-size:0.82rem;">
                            <i class="ph ph-eye"></i> View
                        </a>
                        <a href="${f.download_url}" class="btn btn-primary" style="padding:0.4rem; font-size:0.82rem;">
                            <i class="ph ph-download-simple"></i> Download
                        </a>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('Failed to load generated files', e);
    }
}

function downloadAllZip() {
    window.location.href = '/api/download-all-zip';
}

// ==================== WHATSAPP DISPATCHER ====================
function setDispatcherMode(mode) {
    const queueView = document.getElementById('dispatcher-queue-view');
    const runnerView = document.getElementById('dispatcher-runner-view');
    const btnQueue = document.getElementById('btn-mode-queue');
    const btnRunner = document.getElementById('btn-mode-runner');

    if (mode === 'queue') {
        queueView.style.display = 'block';
        runnerView.style.display = 'none';
        btnQueue.classList.add('active');
        btnRunner.classList.remove('active');
        loadWhatsAppQueue();
    } else {
        queueView.style.display = 'none';
        runnerView.style.display = 'block';
        btnQueue.classList.remove('active');
        btnRunner.classList.add('active');
    }
}

async function loadWhatsAppQueue() {
    const tbody = document.getElementById('queue-table-body');
    if (!tbody) return;

    try {
        const res = await fetch('/api/whatsapp/queue');
        const data = await res.json();
        if (data.success) {
            const queue = data.queue;
            if (queue.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No contacts available in the queue.</td></tr>`;
                return;
            }

            tbody.innerHTML = queue.map((c, idx) => `
                <tr id="queue-row-${c.id}">
                    <td style="color:var(--text-muted); font-size:0.85rem;">${idx + 1}</td>
                    <td style="font-weight:600; font-family:'Noto Sans Gujarati', var(--font-main);">${escapeHtml(c.name)}</td>
                    <td style="color:var(--text-secondary);">${escapeHtml(c.number)}</td>
                    <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem; color: var(--text-muted);">
                        ${escapeHtml(c.personalized_message.replace(/\n/g, ' '))}
                    </td>
                    <td>
                        ${c.has_invitation ? `
                            <a href="/api/preview/${encodeURIComponent(c.invitation_file)}" target="_blank" class="badge-status success" style="text-decoration:none;">
                                <i class="ph ph-file-pdf"></i> View PDF
                            </a>
                        ` : `<span class="badge-status secondary">No Card</span>`}
                    </td>
                    <td>
                        <button class="btn-tool ${c.is_sent ? 'btn-sent' : ''}" onclick="toggleSentStatus(${c.id}, ${!c.is_sent})" style="${c.is_sent ? 'color:var(--success-color); border-color:var(--success-color);' : ''}">
                            <i class="ph ph-${c.is_sent ? 'check-circle' : 'circle'}"></i> ${c.is_sent ? 'Sent' : 'Mark Sent'}
                        </button>
                    </td>
                    <td>
                        <div class="table-actions-cell">
                            <a href="${c.web_url}" target="_blank" onclick="toggleSentStatus(${c.id}, true)" class="btn btn-whatsapp" style="width:auto; padding:0.4rem 0.8rem; font-size:0.82rem;">
                                <i class="ph ph-whatsapp-logo"></i> Web
                            </a>
                            <a href="${c.mobile_url}" target="_blank" onclick="toggleSentStatus(${c.id}, true)" class="btn btn-secondary" style="width:auto; padding:0.4rem 0.8rem; font-size:0.82rem;" title="Mobile WhatsApp">
                                <i class="ph ph-device-mobile"></i> Mobile
                            </a>
                            <button class="btn-icon" onclick="copyToClipboard('${escapeQuote(c.personalized_message)}')" title="Copy Message Text">
                                <i class="ph ph-copy"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

            updateDashboardMetrics();
        }
    } catch (e) {
        console.error('Failed to load WhatsApp queue', e);
    }
}

async function toggleSentStatus(contactId, newStatus) {
    try {
        const res = await fetch('/api/whatsapp/mark-sent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_id: contactId, is_sent: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            loadWhatsAppQueue();
            loadContacts();
        }
    } catch (e) {
        console.error('Failed to toggle sent status', e);
    }
}

async function dispatchNextInQueue() {
    try {
        const res = await fetch('/api/whatsapp/queue');
        const data = await res.json();
        if (data.success) {
            const nextUnsent = data.queue.find(c => !c.is_sent);
            if (!nextUnsent) {
                showToast('All contacts in queue have already been marked as Sent! 🎉', 'success');
                return;
            }

            // Open WhatsApp Web in new tab
            window.open(nextUnsent.web_url, '_blank');
            showToast(`Opening chat for ${nextUnsent.name}...`, 'info');

            // Mark as sent
            await toggleSentStatus(nextUnsent.id, true);
        }
    } catch (e) {
        showToast('Error finding next contact in queue', 'error');
    }
}

// ==================== AUTOMATED SELENIUM RUNNER ====================
async function runAutomatedProcess(mode) {
    const noPreview = document.getElementById('runner-no-preview').checked;
    appendLog(`>>> Initiating automated process in mode: ${mode}...`, 'info');

    try {
        const res = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, no_preview: noPreview })
        });
        const data = await res.json();
        if (data.success) {
            updateRunnerState(true);
            clearTerminal();
            connectLogs();
            if (!appState.statusInterval) {
                appState.statusInterval = setInterval(checkAutomatedRunnerStatus, 2000);
            }
        } else {
            appendLog(`Error: ${data.error}`, 'error');
        }
    } catch (e) {
        appendLog(`Network error: ${e.message}`, 'error');
    }
}

async function stopAutomatedProcess() {
    try {
        const res = await fetch('/api/stop', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            appendLog('>>> Automation stopped by user.', 'system');
            updateRunnerState(false);
            if (appState.statusInterval) clearInterval(appState.statusInterval);
        } else {
            appendLog(`Error: ${data.error}`, 'error');
        }
    } catch (e) {
        appendLog(`Network error: ${e.message}`, 'error');
    }
}

async function checkAutomatedRunnerStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        updateRunnerState(data.is_running);
    } catch (e) {
        console.error('Failed to fetch runner status', e);
    }
}

function updateRunnerState(isRunning) {
    const stopBtn = document.getElementById('btn-runner-stop');
    const fullBtn = document.getElementById('btn-runner-full');
    const badge = document.getElementById('status-badge');

    if (stopBtn) stopBtn.disabled = !isRunning;
    if (fullBtn) fullBtn.disabled = isRunning;

    if (badge) {
        if (isRunning) {
            badge.className = 'status-badge running';
            badge.querySelector('.text').innerText = 'Runner Running';
        } else {
            badge.className = 'status-badge idle';
            badge.querySelector('.text').innerText = 'System Ready';
        }
    }
}

function connectLogs() {
    if (appState.eventSource) {
        appState.eventSource.close();
    }
    appState.eventSource = new EventSource('/api/logs');

    appState.eventSource.onmessage = function (event) {
        if (event.data.trim() !== '') {
            appendLog(event.data);
        }
    };

    appState.eventSource.addEventListener('close', function () {
        appState.eventSource.close();
        appendLog('Stream finished.', 'system');
    });
}

function appendLog(message, type = 'system') {
    const terminal = document.getElementById('terminal-body');
    if (!terminal) return;

    const line = document.createElement('div');
    line.className = `log-line ${type}`;

    if (message.includes('ERROR') || message.includes('Failed')) {
        line.className = 'log-line error';
    } else if (message.includes('INFO') || message.includes('Starting') || message.includes('✓')) {
        line.className = 'log-line success';
    }

    line.innerText = message;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
    const terminal = document.getElementById('terminal-body');
    if (terminal) terminal.innerHTML = '';
}

// ==================== METRICS & HELPERS ====================
function updateDashboardMetrics() {
    const contactsCount = appState.contacts.length;
    const sentCount = appState.contacts.filter(c => c.is_sent).length;

    document.getElementById('dash-contacts-count').innerText = contactsCount;
    document.getElementById('sidebar-contact-count').innerText = contactsCount;
    document.getElementById('dash-sent-count').innerText = sentCount;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconMap = {
        success: 'ph-check-circle',
        error: 'ph-warning-circle',
        info: 'ph-info'
    };

    toast.innerHTML = `<i class="ph ${iconMap[type] || 'ph-info'}"></i> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Message copied to clipboard!', 'info');
    });
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexToRgb(hex) {
    let cleanHex = hex.replace('#', '');
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split('').map(c => c + c).join('');
    }
    const num = parseInt(cleanHex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
}

function escapeQuote(text) {
    return (text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
