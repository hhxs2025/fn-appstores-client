// ================================================================
// FN软仓 - 核心模块
// ★ v2.11.1 变更：
//   1. 本地应用缓存有效期 10 分钟 → 24 小时：源站临时不可达时，
//      页面刷新不再"一片白板"，图标照常显示；
//   2. 设置页切到"系统"面板时自动加载缓存管理统计。
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
// ★ v2.11.1：应用缓存有效期 24 小时（原 10 分钟）
var APPS_CACHE_TTL = 24 * 60 * 60 * 1000;

var _loadingApps = false;
var _loadingSources = false;
var _loadingHome = false;
var _installedLoaded = false;

// ================================================================
// ★ 隐患 2 修复：全局拦截 fetch，精准注入身份，避免影响第三方跨域请求
// ================================================================
var _originalFetch = window.fetch;
window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input.url || '');

    // 只有在请求咱们自己的网关、或者已知的 API 路径、或者是自己搭的服务端时，才注入身份
    var isOwnAPI = false;
    if (url.indexOf(API_BASE) === 0 || url.indexOf('/api/') !== -1) {
        isOwnAPI = true;
    }
    // 可选：如果你知道你的服务端域名，也可以加上
    if (url.indexOf('nas.hhxs2025.top') !== -1 || url.indexOf('rc.hhxs2026.top') !== -1) {
        isOwnAPI = true;
    }

    if (isOwnAPI) {
        init = init || {};
        init.headers = init.headers || {};
        var cid = typeof getClientId === 'function' ? getClientId() : '';
        var ver = typeof getCurrentAppVersion === 'function' ? getCurrentAppVersion() : '2.11.1';

        if (cid) {
            if (init.headers instanceof Headers) {
                if (!init.headers.has('X-Client-ID')) {
                    init.headers.append('X-Client-ID', cid);
                    init.headers.append('X-App-Version', ver);
                    init.headers.append('X-Device-Type', 'fnos');
                }
            } else if (Array.isArray(init.headers)) {
                var hasID = false;
                for (var i = 0; i < init.headers.length; i++) {
                    if (init.headers[i][0].toLowerCase() === 'x-client-id') hasID = true;
                }
                if (!hasID) {
                    init.headers.push(['X-Client-ID', cid]);
                    init.headers.push(['X-App-Version', ver]);
                    init.headers.push(['X-Device-Type', 'fnos']);
                }
            } else {
                if (!init.headers['X-Client-ID'] && !init.headers['x-client-id']) {
                    init.headers['X-Client-ID'] = cid;
                    init.headers['X-App-Version'] = ver;
                    init.headers['X-Device-Type'] = 'fnos';
                }
            }
        }
    }
    return _originalFetch(input, init);
};

// ================================================================
// 图片地址包装（全量强推代理，规避混合内容/局域网/证书问题）
// ★ v2.11.1：代理后端已落盘缓存图标/预览图 30 天，重复访问直接命中本地
// ================================================================
// ================================================================
// 图片地址统一走本地代理
// ★ v2.11.2 修复：原来遇到"同源地址"或"/开头相对路径"直接原样返回，
//   官方源 data/icons 里的图标（http://源站/icons/{id}.PNG）如果恰好和
//   页面同源，就绕过代理直连 —— 结果是永远不进 icons/ 磁盘缓存，
//   每次进页面都重新拉一遍，而且断网时一片破图。
//   现在除 data:/blob:、本应用 /static/ 静态资源和已经包装过的地址外，
//   图片一律走 /api/proxy-image：落 30 天磁盘缓存 + 浏览器强缓存，
//   源站/加速线抽风时后端的"直连→加速池→jsDelivr→原址"回退也能生效。
// ================================================================
// ================================================================
// ★ v2.11.2 新增：图片缓存预取
//
// 列表一加载就在后台把「所有图标 + 所有预览图/轮播图」批量拉进
// 本机 icons/ previews/ 磁盘缓存（30 天有效）。这样：
//   · 服务端（含自托管 data/icons、data/previews）只在首次被请求一次；
//   · 用户滚动、翻页、点详情时全部命中本地缓存，不再回源；
//   · 源站临时不可达时，图标照常显示。
// 节流：整表预取 30 分钟内只触发一次，单应用详情 10 分钟内一次。
// ================================================================
function prefetchImages(scope, appId) {
    try {
        var now = Date.now();
        if (scope === 'app') {
            if (!appId) return;
            var k = 'fnrc_pf_app_' + appId;
            var lastApp = parseInt(localStorage.getItem(k) || '0', 10);
            if (now - lastApp < 10 * 60 * 1000) return;
            localStorage.setItem(k, String(now));
        } else {
            var lastAll = parseInt(localStorage.getItem('fnrc_pf_all') || '0', 10);
            if (now - lastAll < 30 * 60 * 1000) return;
            localStorage.setItem('fnrc_pf_all', String(now));
        }
        fetch(API_BASE + '/api/cache/prefetch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({scope: scope || 'all', id: appId || ''})
        }).catch(function () { /* 预取失败不影响界面 */ });
    } catch (e) {
        /* localStorage 不可用等异常一律忽略 */
    }
}
window.prefetchImages = prefetchImages;

// kind：'icon' → 落 icons/；'preview' → 落 previews/；不传则后端按 URL 推断。
// 必须显式传：源里的文件名经常是 1.png / a1b2c3 这种，光看 URL 分不出是图标还是预览图。
function wrapImageUrl(url, kind) {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    // 已经包过代理，别二次包装
    if (url.indexOf('/api/proxy-image') !== -1) return url;

    var abs = url;
    if (url.indexOf('//') === 0) {
        abs = window.location.protocol + url;
    } else if (url.startsWith('/')) {
        abs = window.location.origin + url;
    } else if (!/^https?:\/\//i.test(url)) {
        abs = window.location.origin + '/' + url.replace(/^\.?\//, '');
    }

    // 本应用自己的 UI 资源（脚本/样式/字体/文档图标）不过代理
    if (abs.indexOf(window.location.origin + '/static/') === 0) return abs;

    var out = API_BASE + '/api/proxy-image?url=' + encodeURIComponent(abs);
    if (kind) out += '&kind=' + encodeURIComponent(kind);
    return out;
}

function extractHostJS(url) {
    if (!url) return '';
    var m = String(url).match(/^https?:\/\/([^\/:]+)/i);
    return m ? m[1].toLowerCase() : '';
}

// ================================================================
// Toast
// ================================================================
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

    toast.onmouseenter = function() { clearTimeout(toast._timer); };
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

// ================================================================
// 缓存读写
// ================================================================
function readAppsCache() {
    try {
        var cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        var data = JSON.parse(cached);
        if (data._version !== CACHE_VERSION) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }
        // ★ v2.11.1：TTL 24 小时，源站临时故障时刷新页面不再白板
        if (Date.now() - data.timestamp > APPS_CACHE_TTL) return null;
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
    localStorage.removeItem('fnsoft_apps_cache');
    localStorage.removeItem('fnsoft_notice_cache');
    localStorage.removeItem('fnsoft_downloaded_version');
    localStorage.removeItem('fnsoft_read_notices');
    localStorage.removeItem('fnsoft_shown_pushes');
    localStorage.removeItem('fnsoft_my_ratings');
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

// ================================================================
// 收藏
// ================================================================
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

// ================================================================
// 设置 Tab 切换 / 搜索
// ================================================================
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
    // ★ v2.11.1：切到"系统"面板时刷新缓存管理统计
    if (tab === 'system') {
        if (typeof loadCacheStats === 'function') setTimeout(loadCacheStats, 20);
        if (typeof loadAccelPool === 'function') setTimeout(loadAccelPool, 30);
        if (typeof loadPrefetchStatus === 'function') setTimeout(loadPrefetchStatus, 40);
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

// ================================================================
// 评分与身份标识
// ================================================================
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

function getCurrentAppVersion() {
    var el = document.getElementById('appVersion');
    if (el) {
        var txt = el.textContent || '';
        var match = txt.match(/(\d+\.\d+\.\d+)/);
        if (match) return match[1];
        return txt.replace(/[^\d.]/g, '').trim();
    }
    return '2.11.1';
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
        var titleEl2 = document.getElementById('forceUpdateTitle');
        var contentEl2 = document.getElementById('forceUpdateContent');
        if (titleEl2) titleEl2.textContent = data.title || '重要更新';
        if (contentEl2) contentEl2.innerHTML = (data.content || '请立即更新').replace(/\n/g, '<br>') + '<br><br>最新版本：<b>v' + (data.update_ver || '') + '</b>';

        var modal2 = document.getElementById('forceUpdateModal');
        if (modal2) modal2.classList.add('active');
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
