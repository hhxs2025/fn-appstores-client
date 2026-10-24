// ================================================================
// FN软仓 - 核心模块
// ================================================================

var GATEWAY_PREFIX = '/app/fn-appstores-client';
var API_BASE = '';
if (window.location.pathname.indexOf(GATEWAY_PREFIX) === 0) {
    API_BASE = GATEWAY_PREFIX;
}

var FIXED_TAGS = ['全部', '影音', '办公', '下载', 'AI', '设计', '社交', '网络', '工具', '生活', '商务', '教育', '效率', '开发', '游戏'];

var currentTag = '全部';
var currentAppType = 'all';
var currentSourceFilter = 'all';
var currentSort = 'default';
var currentPage = 1;
var allAppsData = [];
var currentDetailApp = null;
var currentSlide = 0;
var slideCount = 0;
var refreshCooldown = false;
var refreshTimer = null;
var REFRESH_COOLDOWN = 30;
var imageList = [];
var currentImageIndex = 0;
var homeSlideIndex = 0;
var homeSlideCount = 0;
var homeNoticeData = null;
var homeLoaded = false;
var homeNoticeCache = null;
var homeNoticeCacheTime = 0;
var HOME_CACHE_TTL = 5 * 60 * 1000;

var CACHE_VERSION = 'v1';
var CACHE_KEY = 'fnsoft_apps_cache';

var _loadingApps = false;
var _loadingSources = false;
var _loadingHome = false;
var _installedLoaded = false;

function wrapImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('/')) {
        return window.location.origin + url;
    }
    if (window.location.protocol === 'https:' && url.startsWith('http://')) {
        return API_BASE + '/api/proxy-image?url=' + encodeURIComponent(url);
    }
    return url;
}

// ★ 优化后的 Toast：支持指定时长、HTML格式、悬停暂停
function showToast(msg, type, durationMs, isHtml) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    
    if (isHtml) {
        toast.innerHTML = msg;
    } else {
        toast.textContent = msg;
    }
    
    toast.className = 'toast show ' + (type || '');
    
    var defaultDurations = { success: 2500, error: 4000, warning: 3000, info: 3000 };
    var duration = durationMs || defaultDurations[type] || 3000;
    
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
        toast.classList.remove('show');
    }, duration);

    // 鼠标悬停时暂停倒计时，移开后再给2秒消失
    toast.onmouseenter = function() { 
        clearTimeout(toast._timer); 
    };
    toast.onmouseleave = function() { 
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function() {
            toast.classList.remove('show');
        }, 2000); 
    };
}

if (typeof compareVersions === 'undefined') {
    var compareVersions = function(v1, v2) {
        if (!v1 || !v2) return 0;
        v1 = String(v1).replace(/^v/, '');
        v2 = String(v2).replace(/^v/, '');
        var parts1 = v1.split('.').map(Number);
        var parts2 = v2.split('.').map(Number);
        for (var i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            var a = parts1[i] || 0;
            var b = parts2[i] || 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    };
}

function getTagsArray(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') {
        return tags.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    }
    return [];
}

function readAppsCache() {
    try {
        var cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        var data = JSON.parse(cached);
        if (data._version !== CACHE_VERSION) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }
        if (Date.now() - data.timestamp > 10 * 60 * 1000) return null;
        return data.data;
    } catch (e) {
        return null;
    }
}

function writeAppsCache(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            _version: CACHE_VERSION,
            timestamp: Date.now(),
            data: data
        }));
    } catch (e) { console.warn('写入缓存失败:', e); }
}

function clearAppsCache() {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem('fnsoft_notice_cache');
    localStorage.removeItem('fnsoft_downloaded_version');
}

function exportLogs() {
    window.open(API_BASE + '/api/logs/export', '_blank');
    showToast('正在导出日志...', 'info');
}

function clearCache() {
    if (!confirm('确定要清除所有本地缓存吗？\n\n清除后下次打开将重新加载数据。')) return;
    clearAppsCache();
    showToast('缓存已清除，即将刷新页面', 'success');
    setTimeout(function() { location.reload(); }, 800);
}
window.clearCache = clearCache;

var FAVORITES_KEY = 'fnsoft_favorites';

function getFavorites() {
    try {
        var raw = localStorage.getItem(FAVORITES_KEY);
        if (!raw) return {};
        var obj = JSON.parse(raw);
        return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
        return {};
    }
}
window.getFavorites = getFavorites;

function isFavorite(appId) {
    if (!appId) return false;
    return !!getFavorites()[appId];
}
window.isFavorite = isFavorite;

function toggleFavorite(appId) {
    if (!appId) return false;
    var map = getFavorites();
    var nowFav;
    if (map[appId]) {
        delete map[appId];
        nowFav = false;
    } else {
        map[appId] = Date.now();
        nowFav = true;
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(map));
    return nowFav;
}
window.toggleFavorite = toggleFavorite;

function getFavoriteList() {
    var map = getFavorites();
    var ids = Object.keys(map);
    ids.sort(function(a, b) { return map[b] - map[a]; });
    return ids;
}
window.getFavoriteList = getFavoriteList;

function getFavoriteApps() {
    var ids = getFavoriteList();
    if (ids.length === 0 || !allAppsData || allAppsData.length === 0) return [];
    var map = {};
    allAppsData.forEach(function(a) { map[a.id] = a; });
    var result = [];
    ids.forEach(function(id) {
        if (map[id]) result.push(map[id]);
    });
    return result;
}
window.getFavoriteApps = getFavoriteApps;

function clearFavorites() {
    localStorage.removeItem(FAVORITES_KEY);
}
window.clearFavorites = clearFavorites;

function switchSettingTab(tab) {
    var tabs = document.querySelectorAll('.settings-tab');
    if (tabs) {
        tabs.forEach(function(el) {
            el.classList.toggle('active', el.dataset.stab === tab);
        });
    }
    var panels = document.querySelectorAll('.settings-panel');
    if (panels) {
        panels.forEach(function(el) {
            el.classList.toggle('active', el.id === 'spanel-' + tab);
        });
    }
    if (tab === 'favorites' && typeof window.renderFavorites === 'function') {
        setTimeout(function() { window.renderFavorites(); }, 20);
    }
    if (typeof syncThemeSwitches === 'function') {
        setTimeout(syncThemeSwitches, 20);
    }
}
window.switchSettingTab = switchSettingTab;

function searchApps() {
    currentPage = 1;
    renderFilteredApps();
}
window.searchApps = searchApps;

var _searchDebounceTimer = null;
function searchAppsDebounced() {
    if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(function () {
        currentPage = 1;
        renderFilteredApps();
    }, 250);
}
window.searchAppsDebounced = searchAppsDebounced;

function updateSettingsStats() {
    if (!allAppsData || allAppsData.length === 0) return;
    var filteredData = allAppsData.filter(function (app) {return app.id !== 'fn-appstores-client';});
    var totalEl = document.getElementById('settingsTotalApps');
    if (totalEl) totalEl.textContent = filteredData.length;
    var installedEl = document.getElementById('settingsInstalled');
    if (installedEl) installedEl.textContent = filteredData.filter(function (app) {return app.installed;}).length;
    var updatableEl = document.getElementById('settingsUpdatable');
    if (updatableEl) updatableEl.textContent = filteredData.filter(function (app) {return app.has_update;}).length;
    var favEl = document.getElementById('settingsFavorites');
    if (favEl) favEl.textContent = getFavoriteList().length;
}
window.updateSettingsStats = updateSettingsStats;

var MY_RATINGS_KEY = 'fnsoft_my_ratings';

function getMyRatings() {
    try { return JSON.parse(localStorage.getItem(MY_RATINGS_KEY) || '{}'); } catch (e) { return {}; }
}
function getMyRating(appId) {
    return getMyRatings()[appId] || 0;
}
function setMyRating(appId, rating) {
    try {
        var all = getMyRatings();
        all[appId] = rating;
        localStorage.setItem(MY_RATINGS_KEY, JSON.stringify(all));
    } catch (e) {}
}
function getClientId() {
    var id = localStorage.getItem('fnsoft_client_id');
    if (!id) {
        id = (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
            ('cid_' + Date.now() + '_' + Math.random().toString(36).slice(2));
        localStorage.setItem('fnsoft_client_id', id);
    }
    return id;
}

async function loadRating(appId) {
    var stars = document.querySelectorAll('#ratingStars .star');
    var info = document.getElementById('ratingInfo');
    var myHint = document.getElementById('myRatingHint');
    if (!stars.length || !info) return;

    stars.forEach(function(s) { s.classList.remove('active', 'hover'); });
    info.className = 'rating-info loading';
    info.textContent = '加载中...';

    var myRating = getMyRating(appId);
    if (myHint) {
        if (myRating > 0) {
            myHint.textContent = '你已评分：' + myRating + ' 星（点击星星可修改）';
            myHint.className = 'my-rating-hint show';
            stars.forEach(function(s, i) { if (i < myRating) s.classList.add('active'); });
        } else {
            myHint.className = 'my-rating-hint';
            myHint.textContent = '';
        }
    }

    try {
        var resp = await fetch(API_BASE + '/api/rating/' + appId);
        var data = await resp.json();
        if (data.success && data.data) {
            var avg = data.data.rating_avg || 0;
            var count = data.data.rating_count || 0;
            if (myRating === 0) {
                var rounded = Math.round(avg);
                stars.forEach(function(s, i) { if (i < rounded) s.classList.add('active'); });
            }
            if (count > 0) {
                info.className = 'rating-info';
                info.textContent = avg.toFixed(1) + ' 分 · ' + count + ' 人评分';
            } else {
                info.className = 'rating-info';
                info.textContent = '暂无评分，点击星星评分';
            }
        } else {
            info.className = 'rating-info';
            info.textContent = '暂无评分';
        }
    } catch (e) {
        info.className = 'rating-info error';
        info.textContent = '加载失败';
    }
}

async function submitRating(appId, rating) {
    var info = document.getElementById('ratingInfo');
    var myHint = document.getElementById('myRatingHint');
    if (info) { info.className = 'rating-info loading'; info.textContent = '提交中...'; }
    try {
        var resp = await fetch(API_BASE + '/api/rating/' + appId, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ client_id: getClientId(), rating: rating })
        });
        var data = await resp.json();
        if (data.success && data.data) {
            var avg = data.data.rating_avg || 0;
            var count = data.data.rating_count || 0;
            var stars = document.querySelectorAll('#ratingStars .star');
            stars.forEach(function(s, i) { s.classList.toggle('active', i < rating); });
            if (info) {
                info.className = 'rating-info';
                info.textContent = avg.toFixed(1) + ' 分 · ' + count + ' 人评分';
            }
            setMyRating(appId, rating);
            if (myHint) {
                myHint.textContent = '你已评分：' + rating + ' 星（点击星星可修改）';
                myHint.className = 'my-rating-hint show';
            }
            var ratingInline = document.getElementById('detailRatingInline');
            if (ratingInline) { ratingInline.textContent = '★ ' + avg.toFixed(1); ratingInline.style.display = ''; }
            showToast('已提交 ' + rating + ' 星评分', 'success');

            var app = allAppsData.find(function (a) {return a.id === appId;});
            if (app) {
                app.rating_avg = avg;
                app.rating_count = count;
                writeAppsCache(allAppsData);
            }
        } else {
            if (info) { info.className = 'rating-info error'; info.textContent = data.message || '提交失败'; }
            showToast(data.message || '评分失败', 'error');
        }
    } catch (e) {
        if (info) { info.className = 'rating-info error'; info.textContent = '提交失败'; }
        showToast('评分失败: ' + e.message, 'error');
    }
}

function initRatingWidget() {
    var stars = document.querySelectorAll('#ratingStars .star');
    stars.forEach(function (star) {
        star.addEventListener('mouseenter', function () {
            var v = parseInt(star.dataset.value);
            stars.forEach(function (s, i) { s.classList.toggle('hover', i < v); });
        });
        star.addEventListener('mouseleave', function () {
            stars.forEach(function (s) {s.classList.remove('hover');});
        });
        star.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!currentDetailApp) return;
            var v = parseInt(star.dataset.value);
            submitRating(currentDetailApp.id, v);
        });
    });
}
window.initRatingWidget = initRatingWidget;

// ================================================================
// 系统消息推送处理
// ================================================================

var _currentForceUpdateData = null;

function getCurrentAppVersion() {
    var el = document.getElementById('appVersion');
    if (el) {
        var txt = el.textContent || '';
        var match = txt.match(/(\d+\.\d+\.\d+)/);
        if (match) return match[1];
        return txt.replace(/[^\d.]/g, '').trim();
    }
    return '2.9.5';
}

async function loadPendingPushes() {
    try {
        var cid = getClientId();
        var version = getCurrentAppVersion();
        var deviceType = 'x86';
        if (navigator.userAgent.toLowerCase().includes('arm') || navigator.platform.toLowerCase().includes('arm')) {
            deviceType = 'ARM';
        }

        console.log('[Push] 开始拉取离线消息 - 参数:', { ClientID: cid, Version: version, Type: deviceType });

        var resp = await fetch(API_BASE + '/api/push/pending', {
            headers: {
                'X-Client-ID': cid,
                'X-App-Version': version,
                'X-Device-Type': deviceType
            }
        });
        
        var text = await resp.text();
        var data = null;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.warn('[Push] 服务端返回非 JSON 格式 (可能是 404):', text.substring(0, 100));
            return;
        }

        console.log('[Push] 服务端响应:', data);

        if (data.success && data.data && data.data.length > 0) {
            data.data.forEach(function(msg) {
                handlePushMessage(msg);
            });
        } else {
            console.log('[Push] 当前没有匹配的未读消息');
        }
    } catch (e) {
        console.error('[Push] 拉取离线消息异常:', e);
    }
}

function handlePushMessage(data) {
    if (!data || !data.id) return;
    
    var shownPushes = [];
    try {
        shownPushes = JSON.parse(localStorage.getItem('fnsoft_shown_pushes') || '[]');
    } catch (e) {}
    
    if (shownPushes.indexOf(data.id) !== -1) {
        console.log('[Push] 消息已被本地去重拦截 (之前已经弹过):', data.id);
        return; 
    }
    
    console.log('[Push] 准备弹出消息:', data.title);
    
    shownPushes.push(data.id);
    if (shownPushes.length > 100) shownPushes.shift(); 
    localStorage.setItem('fnsoft_shown_pushes', JSON.stringify(shownPushes));
    
    if (data.msg_type === 'toast') {
        // ★ 关键修改：推送的提示改为 HTML 渲染，排版更好看；停留时间拉长到 10 秒
        var htmlMsg = '<div style="font-weight:bold;font-size:15px;margin-bottom:6px;">【' + data.title + '】</div>' + 
                      '<div style="font-size:14px;line-height:1.6;">' + data.content.replace(/\n/g, '<br>') + '</div>';
        showToast(htmlMsg, 'info', 10000, true); 
    } else if (data.msg_type === 'modal') {
        var titleEl = document.getElementById('sysPushTitle');
        var contentEl = document.getElementById('sysPushContent');
        if (titleEl) titleEl.textContent = data.title;
        if (contentEl) contentEl.innerHTML = data.content.replace(/\n/g, '<br>');
        var modal = document.getElementById('sysPushModal');
        if (modal) modal.classList.add('active');
    } else if (data.msg_type === 'force_update') {
        _currentForceUpdateData = data;
        var titleEl = document.getElementById('forceUpdateTitle');
        var contentEl = document.getElementById('forceUpdateContent');
        if (titleEl) titleEl.textContent = data.title || '重要更新';
        if (contentEl) contentEl.innerHTML = (data.content || '请立即更新').replace(/\n/g, '<br>') + '<br><br>最新版本：<b>v' + (data.update_ver || '') + '</b>';
        
        var modal = document.getElementById('forceUpdateModal');
        if (modal) modal.classList.add('active');
    }
}

function closeSysPushModal() {
    var modal = document.getElementById('sysPushModal');
    if (modal) modal.classList.remove('active');
}

function triggerForceUpdate() {
    if (!_currentForceUpdateData) return;
    var btn = document.getElementById('forceUpdateBtn');
    if (btn) { btn.disabled = true; btn.textContent = '正在下载...'; }
    
    var data = _currentForceUpdateData;
    var a = document.createElement('a');
    a.href = data.update_url;
    a.download = 'fn-appstores-client-' + data.update_ver + '.fpk';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    setTimeout(function() {
        alert('文件已下载！\n\n请前往飞牛系统「应用中心」->「手动安装」，选择刚才下载的 FPK 文件进行覆盖安装。');
        if (btn) { btn.textContent = '重新下载'; btn.disabled = false; }
    }, 800);
}

window.loadPendingPushes = loadPendingPushes;
window.handlePushMessage = handlePushMessage;