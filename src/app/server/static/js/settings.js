// ================================================================
// FN软仓 - 设置（客户端自更新 + 应用收藏 + 加速池刷新）
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
// ★ 手动刷新加速池
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