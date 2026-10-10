// ================================================================
// FN软仓 - WebSocket 与安装调度
// ================================================================

var ws = null;
var wsReady = false;
var wsReconnectTimer = null;
var wsReconnectAttempts = 0;
var WS_MAX_RECONNECT_ATTEMPTS = 10;
var pendingInstallQueue = [];
var isInstalling = false;
var installTimeoutTimer = null;

// ================================================================
// WebSocket 管理
// ================================================================
function connectWS() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    if (ws) { try {ws.close();} catch (e) {} ws = null; }
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = protocol + '//' + window.location.host + API_BASE + '/ws';
    console.log('连接 WebSocket:', url);
    try {
        ws = new WebSocket(url);
        ws.onopen = function () {
            console.log('✅ WebSocket 已连接');
            wsReady = true;
            wsReconnectAttempts = 0;
            if (isInstalling) { isInstalling = false; }
            processInstallQueue();
        };
        ws.onmessage = function (e) {
            try { handleWsMessage(JSON.parse(e.data)); } catch (err) { console.warn('解析WS消息失败:', err); }
        };
        ws.onclose = function (e) {
            console.log('WebSocket 已断开, code:', e.code);
            wsReady = false; ws = null; isInstalling = false;
            if (window._isClosing) return;
            scheduleReconnect();
        };
        ws.onerror = function (e) { if (ws) ws.close(); };
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

// ================================================================
// 安装队列
// ================================================================
function processInstallQueue() {
    if (isInstalling || pendingInstallQueue.length === 0) return;
    if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN) {
        if (!wsReady) connectWS();
        return;
    }
    isInstalling = true;
    if (installTimeoutTimer) clearTimeout(installTimeoutTimer);
    installTimeoutTimer = setTimeout(function () {
        isInstalling = false;
        installTimeoutTimer = null;
        processInstallQueue();
    }, 30 * 60 * 1000);

    var task = pendingInstallQueue.shift();
    if (task) {
        try {
            var urls = task.downloadUrls || [];
            ws.send(JSON.stringify({
                event: 'install',
                data: {
                    app_id: task.appId,
                    download_url: urls[0] || '',
                    download_urls: urls
                }
            }));
        } catch (e) {
            isInstalling = false;
            if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
            if (task) pendingInstallQueue.push(task);
            setTimeout(processInstallQueue, 1000);
        }
    } else {
        isInstalling = false;
        if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
    }
}

function addInstallTask(appId, downloadUrls) {
    var existing = pendingInstallQueue.some(function (t) {return t.appId === appId;});
    if (existing) { processInstallQueue(); return; }
    pendingInstallQueue.push({appId: appId, downloadUrls: downloadUrls});
    processInstallQueue();
}

function updateInstallButtonUI(appId, state) {
    var cardBtn = document.getElementById('installBtn-' + appId);
    var detailBtn = document.getElementById('detailInstallBtn');
    var isDetailForThis = detailBtn && detailBtn.dataset.appId === appId;

    if (cardBtn) {
        if (state === 'installing') { cardBtn.disabled = true; cardBtn.textContent = '安装中...'; }
        else if (state === 'installed') {
            cardBtn.disabled = true; cardBtn.textContent = '已安装';
            cardBtn.className = 'card-btn btn-opened';
        }
        else if (state === 'idle') { cardBtn.disabled = false; cardBtn.textContent = '安装'; }
    }
    if (isDetailForThis) {
        if (state === 'installing') { detailBtn.disabled = true; detailBtn.textContent = '安装中...'; }
        else if (state === 'installed') {
            detailBtn.disabled = true; detailBtn.textContent = '已安装';
            detailBtn.className = 'card-btn btn-opened';
        }
        else if (state === 'idle') { detailBtn.disabled = false; detailBtn.textContent = '安装'; }
    }
}

function handleWsMessage(msg) {
    if (msg.event === 'wizard.show') {
        isInstalling = false;
        if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
        closeInstallModal();
        showWizardFromSession(msg.data.session_id, msg.data.steps, msg.data.title, msg.data.app_id);
        processInstallQueue();
        return;
    }
    if (msg.event === 'progress') {
        var data = msg.data;
        updateInstallModalProgress(data);
        updateInstallButtonUI(data.app_id, 'installing');
        return;
    }
    if (msg.event === 'result') {
        var data = msg.data;
        var appId = data.app_id;
        isInstalling = false;
        if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }

        if (data.status === 'error' && data.missing_dep) {
            (function(depName) {
                setTimeout(function() {
                    if (typeof showMissingDepModal === 'function') {
                        showMissingDepModal(depName);
                    } else if (typeof showToast === 'function') {
                        showToast('缺少依赖「' + depName + '」，请在飞牛应用中心安装后重试', 'warning');
                    }
                }, 500);
            })(data.missing_dep);
        }

        setInstallModalResult(data.status === 'success', data.msg || (data.status === 'success' ? '安装成功' : '安装失败'));

        if (data.status === 'success') {
            updateInstallButtonUI(appId, 'installed');
            var app = allAppsData.find(function (a) {return a.id === appId;});
            showToast((app ? app.name : appId) + ' 安装成功', 'success');
            if (app) {
                app.installed = true;
                app.installed_version = data.version || app.version;
                app.has_update = false;
                app._justInstalledAt = Date.now();
                if (typeof updateHomeQuickCards === 'function') updateHomeQuickCards();
                if (typeof updateSettingsStats === 'function') updateSettingsStats();
                writeAppsCache(allAppsData);
            }
            setTimeout(function () {refreshApps();}, 12000);
            setTimeout(processInstallQueue, 500);
        } else {
            updateInstallButtonUI(appId, 'idle');
            showToast(data.msg, 'error');
            setTimeout(processInstallQueue, 500);
        }
        return;
    }
}

// ================================================================
// 安装 / 更新
// ================================================================
async function installApp(appId) {
    if (appId === 'fn-appstores-client') {
        showToast('请到「设置 → 系统」中安装更新', 'info');
        switchTab('settings');
        setTimeout(function () {switchSettingTab('system');}, 300);
        return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('连接中，请稍候...', '');
        connectWS();
        setTimeout(function () {
            if (ws && ws.readyState === WebSocket.OPEN) installApp(appId);
            else showToast('连接失败，请刷新页面重试', 'error');
        }, 2000);
        return;
    }
    updateInstallButtonUI(appId, 'installing');
    try {
        var resp = await fetch(API_BASE + '/api/app/' + appId);
        var data = await resp.json();
        if (!data.success) {
            showToast('获取应用信息失败', 'error');
            updateInstallButtonUI(appId, 'idle');
            return;
        }
        var urls = data.data.download_urls || [];
        if (urls.length === 0 && data.data.download_url) {
            urls = [data.data.download_url];
        }
        if (urls.length === 0) {
            showToast('获取下载地址失败', 'error');
            updateInstallButtonUI(appId, 'idle');
            return;
        }
        var app = allAppsData.find(function (a) {return a.id === appId;});
        showInstallModal(appId, (app ? app.name : appId), (app ? app.version : ''), (app ? app.icon : ''));
        addInstallTask(appId, urls);
    } catch (e) {
        showToast(e.message, 'error');
        updateInstallButtonUI(appId, 'idle');
    }
}

async function updateApp(appId) {
    if (appId === 'fn-appstores-client') {
        showToast('请到「设置 → 系统」中检查更新', 'info');
        switchTab('settings');
        setTimeout(function () {switchSettingTab('system');}, 300);
        return;
    }
    if (!confirm('确定要更新该应用吗？')) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('连接中，请稍候...', '');
        connectWS();
        setTimeout(function () {
            if (ws && ws.readyState === WebSocket.OPEN) updateApp(appId);
            else showToast('连接失败，请刷新页面重试', 'error');
        }, 2000);
        return;
    }
    updateInstallButtonUI(appId, 'installing');
    try {
        var resp = await fetch(API_BASE + '/api/app/' + appId);
        var data = await resp.json();
        if (!data.success) {
            showToast('获取应用信息失败', 'error');
            updateInstallButtonUI(appId, 'idle');
            return;
        }
        var urls = data.data.download_urls || [];
        if (urls.length === 0 && data.data.download_url) {
            urls = [data.data.download_url];
        }
        if (urls.length === 0) {
            showToast('获取下载地址失败', 'error');
            updateInstallButtonUI(appId, 'idle');
            return;
        }
        var app = allAppsData.find(function (a) {return a.id === appId;});
        showInstallModal(appId, (app ? app.name : appId) + '（更新）', (app ? app.version : ''), (app ? app.icon : ''));
        addInstallTask(appId, urls);
    } catch (e) {
        showToast(e.message, 'error');
        updateInstallButtonUI(appId, 'idle');
    }
}

// ================================================================
// 安装进度弹窗
// ================================================================
var _installModalAppId = null;

function showInstallModal(appId, appName, appVersion, iconUrl) {
    _installModalAppId = appId;
    var modal = document.getElementById('installModal');
    if (!modal) return;
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
    if (pctEl) pctEl.textContent = pct + '%';
    var stageEl = document.getElementById('installModalStage');
    if (stageEl) {
        var stage = data.stage || '';
        if (stage === 'download')      stageEl.textContent = '下载中';
        else if (stage === 'extract')  stageEl.textContent = '解压中';
        else if (stage === 'install')  stageEl.textContent = '安装中';
        else                           stageEl.textContent = '处理中';
    }
    var statusEl = document.getElementById('installModalStatus');
    if (statusEl) statusEl.textContent = data.msg || '处理中...';
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
    // ★ v2.9.1：当前线路
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
        if (statusEl) { statusEl.textContent = message || '安装成功'; statusEl.className = 'install-modal-status success'; }
        if (closeBtn) closeBtn.style.display = 'block';
        if (actionsEl) actionsEl.style.display = 'flex';
        setTimeout(function () {closeInstallModal();}, 3000);
    } else {
        if (bar) bar.className = 'install-modal-bar-fill error';
        if (pctEl) pctEl.className = 'pct error';
        if (stageEl) stageEl.textContent = '失败';
        if (statusEl) { statusEl.textContent = message || '安装失败'; statusEl.className = 'install-modal-status error'; }
        if (closeBtn) closeBtn.style.display = 'block';
        if (actionsEl) actionsEl.style.display = 'flex';
    }
}

function closeInstallModal() {
    var modal = document.getElementById('installModal');
    if (modal) modal.classList.remove('active');
    _installModalAppId = null;
}