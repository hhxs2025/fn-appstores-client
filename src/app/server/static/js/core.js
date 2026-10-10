// ================================================================
// FN软仓 - 核心模块
// 全局变量 + 工具函数 + 缓存 + 评分 + 搜索
// ================================================================

// ================================================================
// 统一网关适配
// ================================================================
var GATEWAY_PREFIX = '/app/fn-appstores-client';
var API_BASE = '';
if (window.location.pathname.indexOf(GATEWAY_PREFIX) === 0) {
    API_BASE = GATEWAY_PREFIX;
    console.log('🔗统一网关模式，API_BASE =', API_BASE);
} else {
    console.log('🔗端口模式，API_BASE = (相对根路径)');
}

// ================================================================
// 全局状态
// ================================================================
var FIXED_TAGS = ['全部', '影音', '办公', '下载', 'AI', '设计', '社交', '网络', '工具', '生活', '商务', '教育', '效率', '开发', '游戏'];

var currentTag = '全部';
var currentAppType = 'all';
var currentSourceFilter = 'all';
var currentSort = 'default';
var currentPage = 1;
var allAppsData = [];
var installedAppsCache = {};
var currentDetailApp = null;
var currentSlide = 0;
var slideCount = 0;
var refreshCooldown = false;
var refreshTimer = null;
var REFRESH_COOLDOWN = 30;
var currentWizardSessionId = null;
var _wizardPendingAppID = null;
var _wizardPollTimer = null;
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

// ================================================================
// 图片地址包装
// ================================================================
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

// ================================================================
// Toast
// ================================================================
function showToast(msg, type) {
    var toast = document.getElementById('toast');
    if (!toast) {
        console.warn('Toast 元素不存在');
        return;
    }
    toast.textContent = msg;
    toast.className = 'toast show ' + (type || '');
    var durations = { success: 2500, error: 4000, warning: 3000, info: 2000 };
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
        toast.classList.remove('show');
    }, durations[type] || 3000);
}

// ================================================================
// 工具函数
// ================================================================
function compareVersions(v1, v2) {
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
        if (Date.now() - data.timestamp > 10 * 60 * 1000) {
            return null;
        }
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

// ================================================================
// 设置 tab 切换
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
    // 切换时同步主题开关
    if (typeof syncThemeSwitches === 'function') {
        setTimeout(syncThemeSwitches, 20);
    }
}

// ================================================================
// ★ v2.9.1：搜索（带防抖）
// ================================================================
function searchApps() {
    currentPage = 1;
    renderFilteredApps();
}

var _searchDebounceTimer = null;
function searchAppsDebounced() {
    if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(function () {
        currentPage = 1;
        renderFilteredApps();
    }, 250);
}

// ================================================================
// 应用统计（供 renderFilteredApps / handleWsMessage 调用）
// ================================================================
function updateSettingsStats() {
    if (!allAppsData || allAppsData.length === 0) return;
    var filteredData = allAppsData.filter(function (app) {return app.id !== 'fn-appstores-client';});
    var totalEl = document.getElementById('settingsTotalApps');
    if (totalEl) totalEl.textContent = filteredData.length;
    var installedEl = document.getElementById('settingsInstalled');
    if (installedEl) installedEl.textContent = filteredData.filter(function (app) {return app.installed;}).length;
    var updatableEl = document.getElementById('settingsUpdatable');
    if (updatableEl) updatableEl.textContent = filteredData.filter(function (app) {return app.has_update;}).length;
}

// ================================================================
// 评分系统
// ================================================================
var MY_RATINGS_KEY = 'fnsoft_my_ratings';

function getMyRatings() {
    try { return JSON.parse(localStorage.getItem(MY_RATINGS_KEY) || '{}'); } catch (e) { return {}; }
}
function getMyRating(appId) {
    var all = getMyRatings();
    return all[appId] || 0;
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