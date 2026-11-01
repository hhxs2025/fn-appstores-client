// ================================================================
// FN软仓 - 初始化
// ================================================================

// ================================================================
// 首次启动引导
// ================================================================
async function checkInitStatus() {
    try {
        var resp = await fetch(API_BASE + '/api/init/status');
        if (!resp.ok) return true; // 老版服务端 404 → 视为已初始化，保证兼容
        var data = await resp.json();
        return !!(data && data.initialized);
    } catch (e) {
        return true; // 网络异常 → 视为已初始化，避免误弹窗
    }
}
window.checkInitStatus = checkInitStatus;

var _selectedInitMode = null;

function selectInitMode(mode) {
    _selectedInitMode = mode;
    document.querySelectorAll('.init-mode-card').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.mode === mode);
    });
    var btn = document.getElementById('initConfirmBtn');
    if (btn) btn.disabled = false;
}
window.selectInitMode = selectInitMode;

function showInitGuideModal() {
    var modal = document.getElementById('initGuideModal');
    if (modal) modal.classList.add('active');
}
window.showInitGuideModal = showInitGuideModal;

async function confirmInitMode() {
    if (!_selectedInitMode) return;
    var btn = document.getElementById('initConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = '初始化中...'; }

    try {
        var resp = await fetch(API_BASE + '/api/init/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: _selectedInitMode })
        });
        var data = await resp.json();
        if (data.success) {
            var modal = document.getElementById('initGuideModal');
            if (modal) modal.classList.remove('active');
            showToast('初始化完成', 'success');

            // ★ 核心修复：无论哪种模式，都清空旧缓存，防止幽灵数据
            if (typeof clearAppsCache === 'function') {
                clearAppsCache();
            }

            if (_selectedInitMode === 'geek') {
                // 极客模式：清空内存数据，重新拉取（获取空列表），并跳到源管理
                if (typeof allAppsData !== 'undefined') {
                    allAppsData = []; 
                }
                if (typeof renderFilteredApps === 'function') renderFilteredApps();
                if (typeof loadApps === 'function') loadApps(); 
                
                if (typeof switchTab === 'function') switchTab('sources');
                if (typeof loadSources === 'function') loadSources(true);
                
                setTimeout(function () {
                    showToast('请点击「源管理」添加你自己的服务端地址', 'info', 5000);
                }, 400);
            } else {
                // 用户模式：加载全部数据
                if (typeof loadHome === 'function') loadHome(true);
                if (typeof loadApps === 'function') loadApps();
                if (typeof loadSources === 'function') loadSources(true);
            }
        } else {
            showToast(data.message || '初始化失败', 'error');
            if (btn) { btn.disabled = false; btn.textContent = '确定'; }
        }
    } catch (e) {
        showToast('初始化失败: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '确定'; }
    }
}
window.confirmInitMode = confirmInitMode;

// ================================================================
// 初始化入口
// ================================================================
document.addEventListener('DOMContentLoaded', async function () {
    // ---- 同步部分（不依赖网络）----
    fetch(API_BASE + '/api/sysinfo')
        .then(function (res) { return res.json(); })
        .then(function (data) {
            var archEl = document.getElementById('settingsArch');
            if (archEl && data.success) {
                var archText = data.arch;
                if (archText === 'amd64') archText = 'x86_64';
                if (archText === 'arm64') archText = 'ARM64';
                archEl.textContent = archText;
            }
        })
        .catch(function () {
            var archEl = document.getElementById('settingsArch');
            if (archEl) archEl.textContent = navigator.platform || 'x86_64';
        });

    checkAndShowDownloaded();
    connectWS();
    initRatingWidget();
    if (typeof syncThemeSwitches === 'function') syncThemeSwitches();

    // ---- 异步部分：先判断初始化状态 ----
    var initialized = false;
    try {
        initialized = await checkInitStatus();
    } catch (e) {
        initialized = true;
    }

    if (!initialized) {
        // 未初始化：切到首页 + 弹窗等用户选择
        if (typeof switchTab === 'function') switchTab('home');
        showInitGuideModal();
    } else {
        // 已初始化：切到首页 + 拉取数据
        if (typeof switchTab === 'function') switchTab('home');
        if (typeof loadApps === 'function') loadApps();
        if (typeof loadSources === 'function') loadSources();
    }

    // ---- 离线消息推送延迟拉取 ----
    if (typeof loadPendingPushes === 'function') {
        setTimeout(loadPendingPushes, 1000);
    }

    // ---- 开发者 tab 懒加载 ----
    var _devRendered = false;
    var _devTabBtn = document.querySelector('.nav-item[data-tab="developers"]');
    if (_devTabBtn) {
        _devTabBtn.addEventListener('click', function () {
            setTimeout(function () {
                var devGrid = document.getElementById('devGrid');
                if (!_devRendered || !devGrid || devGrid.children.length === 0) {
                    if (typeof renderDevelopers === 'function') {
                        renderDevelopers();
                        _devRendered = true;
                    }
                }
            }, 50);
        });
    }

    window.addEventListener('beforeunload', function () {
        if (typeof window.__cleanupWebSocket === 'function') {
            window.__cleanupWebSocket();
        }
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
        if (_wizardPollTimer) { clearInterval(_wizardPollTimer); _wizardPollTimer = null; }
    });

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                connectWS();
            }
        }
    });
});