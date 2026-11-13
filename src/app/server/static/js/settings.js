// ================================================================
// FN软仓 - 设置（客户端自更新 + 应用收藏 + 加速池刷新 + 问题反馈）
// ================================================================

// ================================================================
// 客户端自更新
// ================================================================
async function checkClientUpdate() {
    var btn = document.getElementById('checkUpdateBtn');
    var status = document.getElementById('updateStatus');
    if (!btn || !status) return;
    btn.disabled = true;
    btn.textContent = '检查中...';
    status.textContent = '正在检查...';
    try {
        var resp = await fetch(API_BASE + '/api/check-update');
        var data = await resp.json();
        if (data.has_update) {
            var downloadedVer = localStorage.getItem('fnsoft_downloaded_version');
            if (downloadedVer && downloadedVer === data.version) {
                if (confirm('已下载 v' + data.version + '，是否重新下载？（如果文件已删除请点"确定"）')) {
                    localStorage.removeItem('fnsoft_downloaded_version');
                    downloadAndInstall(data);
                } else {
                    btn.disabled = false;
                    btn.textContent = '检查更新';
                    status.textContent = '';
                    btn.onclick = function () {checkClientUpdate();};
                }
                return;
            }
            downloadAndInstall(data);
        } else {
            status.textContent = '已是最新版本 (' + data.version + ')';
            btn.textContent = '已是最新';
            btn.disabled = true;
        }
    } catch (e) {
        status.textContent = '检查失败: ' + e.message;
        btn.textContent = '重试';
        btn.disabled = false;
    }
}
window.checkClientUpdate = checkClientUpdate;

function downloadAndInstall(data) {
    var btn = document.getElementById('checkUpdateBtn');
    var status = document.getElementById('updateStatus');
    if (!btn || !status) return;
    status.textContent = '发现新版本 ' + data.version + '，开始下载...';
    btn.textContent = '下载中...';
    btn.disabled = true;
    var a = document.createElement('a');
    a.href = data.download_url;
    a.download = 'fn-appstores-client-' + data.version + '.fpk';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    status.textContent = 'v' + data.version + ' 已下载！请到应用中心手动安装。';
    btn.textContent = '重新下载';
    btn.disabled = false;
    btn.onclick = function () {reDownload();};
    localStorage.setItem('fnsoft_downloaded_version', data.version);
    setTimeout(function () {
        alert('FPK 已下载完成！\n\n请前往：飞牛应用中心 → 手动安装 → 上传 FPK 文件');
    }, 500);
}

function reDownload() {
    localStorage.removeItem('fnsoft_downloaded_version');
    var btn = document.getElementById('checkUpdateBtn');
    var status = document.getElementById('updateStatus');
    if (btn) {
        btn.textContent = '检查更新';
        btn.disabled = false;
        btn.onclick = function () {checkClientUpdate();};
    }
    if (status) status.textContent = '';
    checkClientUpdate();
}
window.reDownload = reDownload;

function checkAndShowDownloaded() {
    var downloadedVer = localStorage.getItem('fnsoft_downloaded_version');
    if (downloadedVer) {
        var status = document.getElementById('updateStatus');
        var btn = document.getElementById('checkUpdateBtn');
        if (status) {
            status.textContent = 'v' + downloadedVer + ' 已下载，请到应用中心手动安装，或点击重新下载';
            status.style.color = 'var(--blue)';
        }
        if (btn) {
            btn.textContent = '重新下载';
            btn.disabled = false;
            btn.onclick = function () {reDownload();};
        }
    }
}
window.checkAndShowDownloaded = checkAndShowDownloaded;

// ================================================================
// 应用收藏 - 设置页列表渲染
// ================================================================
function renderFavorites() {
    try {
        var container = document.getElementById('favoritesList');
        var countEl = document.getElementById('favCount');
        var clearBtn = document.getElementById('favClearBtn');
        if (!container) {
            console.warn('[fav] favoritesList 容器不存在');
            return;
        }

        var favApps = (typeof getFavoriteApps === 'function') ? getFavoriteApps() : [];
        console.log('[fav] 渲染收藏列表，共', favApps.length, '个');

        if (countEl) countEl.textContent = favApps.length;
        if (clearBtn) clearBtn.style.display = favApps.length > 0 ? '' : 'none';

        if (favApps.length === 0) {
            container.innerHTML =
                '<div class="fav-empty">' +
                '<span class="fav-empty-icon">☆</span>' +
                '还没有收藏的应用<br>' +
                '<span style="font-size:11px;">在应用详情页点「收藏」即可加入</span>' +
                '</div>';
            return;
        }

        var html = '';
        favApps.forEach(function(app) {
            var iconHtml = app.icon
                ? '<img src="' + wrapImageUrl(app.icon) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
                : '·';
            var sub = [];
            if (app.author) sub.push(app.author);
            sub.push('v' + (app.installed_version || app.version || '-'));
            if (app.installed) sub.push('已安装');

            html += '<div class="fav-item" data-app-id="' + escapeAttrSafe(app.id) + '" ' +
                'onclick="favItemClick(\'' + app.id + '\')">' +
                '<div class="fav-icon">' + iconHtml + '</div>' +
                '<div class="fav-info">' +
                    '<div class="fav-name">' + escapeHtmlSafe(app.name) + '</div>' +
                    '<div class="fav-sub">' + escapeHtmlSafe(sub.join(' · ')) + '</div>' +
                '</div>' +
                '<button class="fav-remove" title="取消收藏" ' +
                    'onclick="event.stopPropagation();removeFavorite(\'' + app.id + '\');">✕</button>' +
                '</div>';
        });
        container.innerHTML = html;
    } catch (e) {
        console.error('[fav] renderFavorites 异常:', e);
    }
}
window.renderFavorites = renderFavorites;

function favItemClick(appId) {
    try {
        if (typeof jumpToAppDetail === 'function') {
            jumpToAppDetail(appId);
        } else if (typeof openDetail === 'function') {
            openDetail(appId);
        }
    } catch (e) {
        console.error('[fav] favItemClick 异常:', e);
    }
}
window.favItemClick = favItemClick;

function removeFavorite(appId) {
    try {
        if (typeof toggleFavorite !== 'function') return;
        if (typeof isFavorite === 'function' && isFavorite(appId)) {
            toggleFavorite(appId);
        }
        var cardBtn = document.querySelector('.card-fav-btn[data-app-id="' + appId + '"]');
        if (cardBtn) {
            cardBtn.classList.remove('active');
            cardBtn.textContent = '☆';
        }
        if (currentDetailApp && currentDetailApp.id === appId && typeof syncDetailFavoriteBtn === 'function') {
            syncDetailFavoriteBtn(appId);
        }
        renderFavorites();
        if (typeof updateSettingsStats === 'function') updateSettingsStats();
        showToast('已取消收藏', 'success');
    } catch (e) {
        console.error('[fav] removeFavorite 异常:', e);
    }
}
window.removeFavorite = removeFavorite;

function clearAllFavorites() {
    try {
        var favApps = (typeof getFavoriteApps === 'function') ? getFavoriteApps() : [];
        if (favApps.length === 0) return;
        if (!confirm('确定要清空全部 ' + favApps.length + ' 个收藏吗？\n\n此操作不可撤销。')) return;

        var ids = favApps.map(function(a) { return a.id; });
        ids.forEach(function(id) {
            if (typeof isFavorite === 'function' && isFavorite(id)) {
                toggleFavorite(id);
            }
            var cardBtn = document.querySelector('.card-fav-btn[data-app-id="' + id + '"]');
            if (cardBtn) {
                cardBtn.classList.remove('active');
                cardBtn.textContent = '☆';
            }
        });
        if (currentDetailApp && typeof syncDetailFavoriteBtn === 'function' && ids.indexOf(currentDetailApp.id) >= 0) {
            syncDetailFavoriteBtn(currentDetailApp.id);
        }
        renderFavorites();
        if (typeof updateSettingsStats === 'function') updateSettingsStats();
        showToast('已清空收藏', 'success');
    } catch (e) {
        console.error('[fav] clearAllFavorites 异常:', e);
    }
}
window.clearAllFavorites = clearAllFavorites;

// ================================================================
// 手动刷新加速池
// ================================================================
async function refreshAccelPool() {
    if (!confirm('确定要强制刷新加速器池吗？\n\n将从官方源重新拉取最新的加速器列表（覆盖本地缓存）。')) return;
    var btn = document.getElementById('refreshAccelPoolBtn');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
    try {
        var resp = await fetch(API_BASE + '/api/accel-pool/refresh', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        var data = await resp.json();
        if (data.success) {
            showToast(data.message || '已触发刷新', 'success');
        } else {
            showToast(data.message || '刷新失败', 'error');
        }
    } catch (e) {
        showToast('刷新失败: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
    }
}
window.refreshAccelPool = refreshAccelPool;

// ================================================================
// ★ 新增：问题反馈
// ================================================================
function openFeedback(e) {
    if (e) e.preventDefault();
    
    // 抓取页面顶部版本号
    var versionEl = document.getElementById('appVersion');
    var versionText = versionEl ? versionEl.textContent : '未知版本';
    var match = versionText.match(/(\d+\.\d+\.\d+)/);
    var ver = match ? match[1] : versionText.replace(/[^\d.]/g, '').trim();
    
    // 抓取系统架构
    var archEl = document.getElementById('settingsArch');
    var arch = archEl ? archEl.textContent : '未知';
    
    var title = encodeURIComponent('[反馈] 客户端 v' + ver + ' 问题反馈');
    var body = encodeURIComponent(
        '### 问题描述\n' +
        '（请详细描述你遇到的问题）\n\n' +
        '### 复现步骤\n' +
        '1. \n2. \n3. \n\n' +
        '### 环境信息\n' +
        '- 客户端版本：v' + ver + '\n' +
        '- 系统架构：' + arch + '\n' +
        '- 浏览器 UA：' + navigator.userAgent + '\n\n' +
        '### 截图/日志\n' +
        '（如有必要，请在应用详情页点击“导出日志”并附上 txt 文件）'
    );
    
    var url = 'https://gitee.com/hhxs2025/fn-appstores/issues/new?title=' + title + '&body=' + body;
    window.open(url, '_blank', 'noopener');
}
window.openFeedback = openFeedback;

// ================================================================
// ★ 新增：本地缓存管理
// ================================================================
function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var f = n, i = -1;
    while (f >= 1024 && i < units.length - 1) { f /= 1024; i++; }
    return f.toFixed(1) + ' ' + units[i];
}

async function loadCacheStats() {
    var elFpk = document.getElementById('cacheFpkInfo');
    if (!elFpk) return;
    try {
        var resp = await fetch(API_BASE + '/api/cache/stats');
        var data = await resp.json();
        if (!data.success) throw new Error(data.message || '读取失败');
        var d = data.data || {};

        var fpk = d.fpk || {};
        elFpk.textContent = (fpk.count || 0) + ' 个 · ' + fmtBytes(fpk.size);
        var exportBtn = document.getElementById('cacheFpkExportBtn');
        if (exportBtn) {
            exportBtn.style.display = fpk.latest ? '' : 'none';
            exportBtn.dataset.name = fpk.latest || '';
        }

        var ext = d.extract || {};
        var elExt = document.getElementById('cacheExtractInfo');
        if (elExt) elExt.textContent = (ext.count || 0) + ' 个目录 · ' + fmtBytes(ext.size);

        var icons = d.icons || {}, previews = d.previews || {};
        var elImg = document.getElementById('cacheImageInfo');
        if (elImg) {
            elImg.textContent = '图标 ' + (icons.count || 0) + ' 个 · ' + fmtBytes(icons.size)
                + ' ／ 截图 ' + (previews.count || 0) + ' 个 · ' + fmtBytes(previews.size);
        }

        var total = (fpk.size || 0) + (ext.size || 0) + (icons.size || 0) + (previews.size || 0);
        var elTotal = document.getElementById('cacheTotalInfo');
        if (elTotal) elTotal.textContent = fmtBytes(total);

        var elPath = document.getElementById('cachePathInfo');
        if (elPath) elPath.textContent = (d.apps_dir || '--') + (ext.dir ? (' ｜ ' + ext.dir) : '');
    } catch (e) {
        elFpk.textContent = '读取失败';
    }
}
window.loadCacheStats = loadCacheStats;

async function cleanCache(scope) {
    var names = { fpk: '安装包', extract: '解压目录', images: '图标/截图', all: '全部缓存' };
    if (scope === 'all' && !confirm('确定清理全部本地缓存？图标和截图会重新下载，安装包将被删除。')) return;
    try {
        var resp = await fetch(API_BASE + '/api/cache/clean', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({scope: scope})
        });
        var data = await resp.json();
        if (data.success) {
            showToast('已清理' + (names[scope] || '缓存') + '，释放 ' + fmtBytes(data.freed || 0), 'success');
        } else {
            showToast(data.message || '清理失败', 'error');
        }
    } catch (e) {
        showToast('清理失败: ' + e.message, 'error');
    }
    loadCacheStats();
}
window.cleanCache = cleanCache;

function exportLatestFpk() {
    var btn = document.getElementById('cacheFpkExportBtn');
    var name = btn ? (btn.dataset.name || '') : '';
    if (!name) {
        showToast('没有可导出的安装包', 'info');
        return;
    }
    window.open(API_BASE + '/api/cache/download?name=' + encodeURIComponent(name), '_blank');
}
window.exportLatestFpk = exportLatestFpk;

// ================================================================
// 工具
// ================================================================
function escapeHtmlSafe(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttrSafe(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}