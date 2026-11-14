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
                ? '<img src="' + wrapImageUrl(app.icon, 'icon') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
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
// 加速线路（★ v2.11.2：只读展示 + 手动重拉）
//
// 顺序是服务端 /api/accelerator/presets 测速排序后下发的，
// 客户端 doFetchAccelPool() 只做去重 + 保序落盘，不测速、不排序、不随机。
// ================================================================
async function loadAccelPool() {
    var listEl = document.getElementById('accelPoolList');
    var countEl = document.getElementById('accelPoolCount');
    var metaEl = document.getElementById('accelPoolMeta');
    try {
        var resp = await fetch(API_BASE + '/api/accel-pool', { cache: 'no-store' });
        var data = await resp.json();
        if (!data.success || !data.data) return;
        var d = data.data;

        if (countEl) countEl.textContent = (d.count || 0) + ' 条';
        if (metaEl) {
            if (d.source === 'remote') {
                metaEl.textContent = '服务端下发 · 更新于 ' + (d.updated_at || '未知') +
                    (d.version ? ' · ' + d.version : '') +
                    (d.next_refresh_at ? ' · 下次检查 ' + d.next_refresh_at : '');
            } else {
                metaEl.textContent = '内置兜底（尚未成功从源站拉取，顺序为固定值）';
            }
        }
        if (listEl) {
            if (!d.prefixes || !d.prefixes.length) {
                listEl.textContent = '暂无可用线路';
            } else {
                listEl.innerHTML = d.prefixes.map(function (p, i) {
                    return '<div>' + (i + 1) + '. ' + escapeHtmlSafe(p) + '</div>';
                }).join('');
            }
        }
    } catch (e) {
        console.warn('[accel-pool] 加载失败:', e);
    }
}
window.loadAccelPool = loadAccelPool;

// 手动重新拉取（后端是异步 goroutine，这里轮询几次把结果读回来）
async function refreshAccelPool() {
    if (!confirm('确定要从官方源重新拉取加速线路吗？\n\n会覆盖本地 accelerators_pool.json，顺序由服务端测速结果决定。')) return;
    var btn = document.getElementById('refreshAccelPoolBtn');
    if (btn) { btn.disabled = true; btn.textContent = '拉取中...'; }
    try {
        var resp = await fetch(API_BASE + '/api/accel-pool/refresh', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        var data = await resp.json();
        if (!data.success) {
            showToast(data.message || '刷新失败', 'error');
            return;
        }
        // 服务端 15s 超时，最多等约 12s
        for (var i = 0; i < 4; i++) {
            await new Promise(function (r) { setTimeout(r, 3000); });
            await loadAccelPool();
        }
        showToast('已重新拉取，请看下方顺序', 'success');
    } catch (e) {
        showToast('刷新失败: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '重新拉取'; }
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
// ================================================================
// ★ v2.11.1 新增：缓存管理（设置 → 系统）
// 显示图标缓存数、预览图缓存数、其他缓存数、应用缓存(tpk)；
// 提供 FPK 应用缓存(tpk) 的导出按钮和清空按钮。
// 图标/预览图等落盘缓存 30 天后由后端自动清除。
// ================================================================

function _fmtSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function loadCacheStats() {
    try {
        var resp = await fetch(API_BASE + '/api/cache/stats', { cache: 'no-store' });
        var data = await resp.json();
        if (!data.success || !data.data) return;
        var d = data.data;

        var el;
        el = document.getElementById('cacheIconCount');
        if (el) el.textContent = (d.icons.count || 0) + ' 个 · ' + _fmtSize(d.icons.size || 0);
        el = document.getElementById('cachePreviewCount');
        if (el) el.textContent = (d.previews.count || 0) + ' 个 · ' + _fmtSize(d.previews.size || 0);
        el = document.getElementById('cacheOtherCount');
        if (el) el.textContent = (d.cache.count || 0) + ' 个 · ' + _fmtSize(d.cache.size || 0);
        el = document.getElementById('cacheTpkCount');
        if (el) el.textContent = (d.tpk.count || 0) + ' 个 · ' + _fmtSize(d.tpk.size || 0);
        el = document.getElementById('cacheTtlHint');
        if (el) el.textContent = '图标/预览图缓存 ' + (d.ttl_days || 30) + ' 天后自动清除';
    } catch (e) {
        console.warn('[cache] 加载缓存统计失败:', e);
    }
}
window.loadCacheStats = loadCacheStats;

async function clearAppCache(type) {
    var typeText = { icons: '图标缓存', previews: '预览图缓存', cache: '其他缓存', tpk: '应用缓存(tpk)' }[type] || type;
    if (!confirm('确定要清空' + typeText + '吗？\n\n清空后界面资源会重新从源站拉取。')) return;
    var btn = document.getElementById('cacheClearBtn-' + type);
    if (btn) { btn.disabled = true; btn.textContent = '清空中...'; }
    try {
        var resp = await fetch(API_BASE + '/api/cache/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type })
        });
        var data = await resp.json();
        if (data.success) {
            showToast(data.message || '已清空', 'success');
        } else {
            showToast(data.message || '清空失败', 'error');
        }
    } catch (e) {
        showToast('清空失败: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '清空'; }
        loadCacheStats();
    }
}
window.clearAppCache = clearAppCache;

function exportAppCache() {
    // 无窗口被拦截时走 a.click 触发下载
    var a = document.createElement('a');
    a.href = API_BASE + '/api/cache/export';
    a.download = 'fnsoft_tpk_export.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('应用缓存导出中...', 'info');
}
window.exportAppCache = exportAppCache;

// ================================================================
// ★ v2.11.2 新增：图片缓存预热
//
// 列表加载时前端会自动触一次；这里给一个手动入口 + 进度显示。
// 预热会把当前所有应用的图标、预览图、轮播图批量拉进
// 本机 appdata/fn-appstores-client/{icons,previews}，之后 30 天不再回源。
// ================================================================
async function loadPrefetchStatus() {
    var el = document.getElementById('prefetchStatus');
    if (!el) return;
    try {
        var resp = await fetch(API_BASE + '/api/cache/prefetch', { cache: 'no-store' });
        var data = await resp.json();
        if (!data.success || !data.data) return;
        var d = data.data;
        var st = d.last_stat || {};
        if (d.running) {
            el.textContent = '预热中… 共 ' + (st.total || 0) + ' 张';
        } else if (st.total) {
            el.textContent = '上次：命中 ' + (st.hit || 0) + ' / 新拉 ' + (st.fetched || 0) +
                ' / 失败 ' + (st.failed || 0) + '（' + (st.finished_at || '') + '）';
        } else {
            el.textContent = '尚未预热';
        }
    } catch (e) {
        /* 忽略 */
    }
}
window.loadPrefetchStatus = loadPrefetchStatus;

async function startPrefetch() {
    var btn = document.getElementById('prefetchBtn');
    if (btn) { btn.disabled = true; btn.textContent = '预热中...'; }
    try {
        var resp = await fetch(API_BASE + '/api/cache/prefetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: 'all' })
        });
        var data = await resp.json();
        showToast(data.message || '已开始预热', data.success ? 'success' : 'error');
        // 后台跑，每 3 秒刷一次状态，最多盯 1 分钟
        for (var i = 0; i < 20; i++) {
            await new Promise(function (r) { setTimeout(r, 3000); });
            await loadPrefetchStatus();
            var el = document.getElementById('prefetchStatus');
            if (el && el.textContent.indexOf('预热中') === -1) break;
        }
        if (typeof loadCacheStats === 'function') loadCacheStats();
    } catch (e) {
        showToast('预热失败: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '立即预热'; }
    }
}
window.startPrefetch = startPrefetch;
