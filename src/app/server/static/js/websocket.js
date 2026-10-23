// ================================================================
// FN软仓 - WebSocket 及 安装/卸载 UI 状态更新 (完整版)
// ================================================================

var ws = null;
var wsReady = false;
var wsReconnectTimer = null;
var wsReconnectAttempts = 0;
var WS_MAX_RECONNECT_ATTEMPTS = 10;

function connectWS() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    if (ws) { try {ws.close();} catch (e) {} ws = null; }
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = protocol + '//' + window.location.host + API_BASE + '/ws';
    try {
        ws = new WebSocket(url);
        ws.onopen = function () {
            wsReady = true;
            wsReconnectAttempts = 0;
        };
        ws.onmessage = function (e) {
            try { 
                var msg = JSON.parse(e.data);
                // 预留处理服务端推送事件
            } catch (err) { }
        };
        ws.onclose = function (e) {
            wsReady = false; ws = null;
            if (window._isClosing) return;
            scheduleReconnect();
        };
        ws.onerror = function () { if (ws) ws.close(); };
    } catch (e) {
        ws = null; wsReady = false;
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (window._isClosing) return;
    if (wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) return;
    var delay = Math.min(1000 * Math.pow(1.5, wsReconnectAttempts), 30000);
    wsReconnectAttempts++;
    wsReconnectTimer = setTimeout(function () {
        wsReconnectTimer = null;
        if (!window._isClosing) connectWS();
    }, delay);
}

window.__cleanupWebSocket = function () {
    window._isClosing = true;
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { try {ws.close();} catch (e) {} ws = null; }
    wsReady = false;
};

function updateInstallButtonUI(appId, state) {
    var cardBtn = document.getElementById('installBtn-' + appId);
    var detailBtn = document.getElementById('detailInstallBtn');
    var isDetailForThis = detailBtn && detailBtn.dataset.appId === appId;

    if (cardBtn) {
        if (state === 'installing') { cardBtn.disabled = true; cardBtn.textContent = '处理中...'; }
        else if (state === 'installed') {
            cardBtn.disabled = true; cardBtn.textContent = '已安装';
            cardBtn.className = 'card-btn btn-opened';
        }
        else if (state === 'update') {
            cardBtn.disabled = false; cardBtn.textContent = '更新';
            cardBtn.className = 'card-btn btn-update';
        }
        else { cardBtn.disabled = false; cardBtn.textContent = '安装'; cardBtn.className = 'card-btn btn-install'; }
    }
    if (isDetailForThis) {
        if (state === 'installing') { detailBtn.disabled = true; detailBtn.textContent = '处理中...'; }
        else if (state === 'installed') {
            detailBtn.disabled = true; detailBtn.textContent = '已安装';
            detailBtn.className = 'card-btn btn-opened';
        }
        else if (state === 'update') {
            detailBtn.disabled = false; detailBtn.textContent = '更新';
            detailBtn.className = 'card-btn btn-update';
        }
        else { detailBtn.disabled = false; detailBtn.textContent = '安装'; detailBtn.className = 'card-btn btn-install'; }
    }
}

var _installModalAppId = null;

function showInstallModal(appId, appName, appVersion, iconUrl) {
    _installModalAppId = appId;
    var modal = document.getElementById('installModal');
    if (!modal) { console.error('缺少 installModal DOM'); return; }
    
    var iconEl = document.getElementById('installModalIcon');
    if (iconEl) iconEl.innerHTML = iconUrl ? '<img src="' + wrapImageUrl(iconUrl) + '" alt="">' : '';
    var nameEl = document.getElementById('installModalName');
    if (nameEl) nameEl.textContent = appName + (appVersion ? ' v' + appVersion : '');
    
    var bar = document.getElementById('installModalBar');
    if (bar) { bar.style.width = '0%'; bar.className = 'install-modal-bar-fill'; }
    var pctEl = document.getElementById('installModalPct');
    if (pctEl) { pctEl.textContent = '0%'; pctEl.className = 'pct'; }
    var stageEl = document.getElementById('installModalStage');
    if (stageEl) stageEl.textContent = '准备中';
    var statusEl = document.getElementById('installModalStatus');
    if (statusEl) { statusEl.textContent = '准备中...'; statusEl.className = 'install-modal-status'; }
    var detailEl = document.getElementById('installModalDetail');
    if (detailEl) detailEl.textContent = '';
    var lineEl = document.getElementById('installModalLine');
    if (lineEl) lineEl.textContent = '';
    var closeBtn = document.getElementById('installModalClose');
    if (closeBtn) closeBtn.style.display = 'none';
    var actionsEl = document.getElementById('installModalActions');
    if (actionsEl) actionsEl.style.display = 'none';
    
    modal.classList.add('active');
}

function updateInstallModalProgress(data) {
    var modal = document.getElementById('installModal');
    if (!modal || !modal.classList.contains('active')) return;
    var pct = Math.min(100, Math.max(0, data.progress || 0));
    var bar = document.getElementById('installModalBar');
    if (bar) bar.style.width = pct + '%';
    var pctEl = document.getElementById('installModalPct');
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    
    var stageEl = document.getElementById('installModalStage');
    if (stageEl) {
        if (data.stage === 'download') stageEl.textContent = '下载中';
        else if (data.stage === 'extract') stageEl.textContent = '解压/解析中';
        else stageEl.textContent = '安装/卸载中';
    }
    var statusEl = document.getElementById('installModalStatus');
    if (statusEl) statusEl.textContent = data.msg || '处理中...';

    // ★ 渲染速度与文件大小
    var detailEl = document.getElementById('installModalDetail');
    if (detailEl) {
        if (data.speed_str && data.downloaded && data.total && data.total > 0) {
            detailEl.textContent = data.speed_str + ' · ' + (data.downloaded / 1024 / 1024).toFixed(1) + ' MB / ' + (data.total / 1024 / 1024).toFixed(1) + ' MB';
        } else if (data.speed_str && data.downloaded) {
            detailEl.textContent = data.speed_str + ' · 已下载 ' + (data.downloaded / 1024 / 1024).toFixed(1) + ' MB';
        } else if (data.speed_str) {
            detailEl.textContent = data.speed_str;
        } else {
            detailEl.textContent = '';
        }
    }

    // ★ 渲染当前线路
    var lineEl = document.getElementById('installModalLine');
    if (lineEl) {
        if (data.url_host && data.stage === 'download') {
            lineEl.textContent = '当前线路：' + data.url_host;
        } else if (!data.url_host) {
            lineEl.textContent = '';
        }
    }
}

function setInstallModalResult(success, message) {
    var modal = document.getElementById('installModal');
    if (!modal || !modal.classList.contains('active')) return;
    var bar = document.getElementById('installModalBar');
    var pctEl = document.getElementById('installModalPct');
    var statusEl = document.getElementById('installModalStatus');
    var stageEl = document.getElementById('installModalStage');
    var closeBtn = document.getElementById('installModalClose');
    var actionsEl = document.getElementById('installModalActions');
    
    if (success) {
        if (bar) { bar.style.width = '100%'; bar.className = 'install-modal-bar-fill success'; }
        if (pctEl) { pctEl.textContent = '100%'; pctEl.className = 'pct success'; }
        if (stageEl) stageEl.textContent = '完成';
        if (statusEl) { statusEl.textContent = message || '操作成功'; statusEl.className = 'install-modal-status success'; }
        if (closeBtn) closeBtn.style.display = 'block';
        if (actionsEl) actionsEl.style.display = 'flex';
        setTimeout(function () {closeInstallModal();}, 3000);
    } else {
        if (bar) bar.className = 'install-modal-bar-fill error';
        if (pctEl) pctEl.className = 'pct error';
        if (stageEl) stageEl.textContent = '失败';
        if (statusEl) { statusEl.textContent = message || '操作失败'; statusEl.className = 'install-modal-status error'; }
        if (closeBtn) closeBtn.style.display = 'block';
        if (actionsEl) actionsEl.style.display = 'flex';
    }
}

function closeInstallModal() {
    var modal = document.getElementById('installModal');
    if (modal) modal.classList.remove('active');
    _installModalAppId = null;
}