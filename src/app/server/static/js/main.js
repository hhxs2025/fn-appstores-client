// ================================================================
// FN软仓 - 初始化
// ================================================================

document.addEventListener('DOMContentLoaded', function () {
    // ★ 新增：请求后端获取真实硬件架构
    fetch(API_BASE + '/api/sysinfo')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            var archEl = document.getElementById('settingsArch');
            if (archEl && data.success) {
                var archText = data.arch;
                if (archText === 'amd64') archText = 'x86_64';
                if (archText === 'arm64') archText = 'ARM64';
                archEl.textContent = archText;
            }
        })
        .catch(function() {
            // 失败兜底
            var archEl = document.getElementById('settingsArch');
            if (archEl) archEl.textContent = navigator.platform || 'x86_64';
        });

    checkAndShowDownloaded();
    connectWS();
    initRatingWidget();
    if (typeof syncThemeSwitches === 'function') syncThemeSwitches();

    if (typeof loadHome === 'function') loadHome();
    if (typeof loadApps === 'function') loadApps();
    if (typeof loadSources === 'function') loadSources();

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
        if (document.hidden) {
        } else {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                connectWS();
            }
        }
    });
});