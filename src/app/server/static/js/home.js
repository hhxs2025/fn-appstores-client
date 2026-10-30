// ================================================================
// FN软仓 - 首页 + 公告 + 快捷卡片
// ================================================================

var READ_NOTICES_KEY = 'fnsoft_read_notices';

// ★ 自动轮播状态
var _homeCarouselTimer = null;
var HOME_CAROUSEL_INTERVAL = 5000;      // 5 秒一张
var _homeCarouselItems = [];            // 解析后的 [{image, link, linkType}]

// ★ 首页刷新 TTL
var HOME_REFRESH_TTL = 5 * 60 * 1000;
var homeLoadedTime = 0;

function noticeRecordId(record) {
    if (!record) return '';
    var date = record.date || '';
    var title = record.title || '';
    return date + '|' + title;
}

function getReadNotices() {
    try {
        var raw = localStorage.getItem(READ_NOTICES_KEY);
        if (!raw) return {};
        var obj = JSON.parse(raw);
        return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
        return {};
    }
}

function isNoticeRead(record) {
    var id = noticeRecordId(record);
    if (!id) return true;
    var map = getReadNotices();
    return !!map[id];
}

function markNoticeRead(record) {
    var id = noticeRecordId(record);
    if (!id) return;
    var map = getReadNotices();
    if (map[id]) return;
    map[id] = Date.now();
    var keys = Object.keys(map);
    if (keys.length > 500) {
        keys.sort(function(a, b) { return map[a] - map[b]; });
        var remove = keys.slice(0, keys.length - 500);
        remove.forEach(function(k) { delete map[k]; });
    }
    try {
        localStorage.setItem(READ_NOTICES_KEY, JSON.stringify(map));
    } catch (e) {}
}

// ★ 加 5 分钟 TTL，切回首页时超时会静默刷新
async function loadHome(force) {
    if (!force && homeLoaded && (Date.now() - homeLoadedTime) < HOME_REFRESH_TTL) {
        return;
    }
    if (_loadingHome) return;
    _loadingHome = true;
    var now = Date.now();
    var hasCache = homeNoticeCache && (now - homeNoticeCacheTime) < HOME_CACHE_TTL;
    try {
        var data;
        if (hasCache && !force) {
            data = homeNoticeCache;
        } else {
            var resp = await fetch(API_BASE + '/api/notice');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            data = await resp.json();
            homeNoticeCache = data;
            homeNoticeCacheTime = now;
        }
        homeNoticeData = data;
        renderCarousel(data);
        renderNoticeRecords(data);
        if (allAppsData && allAppsData.length > 0) {
            updateHomeQuickCards();
        } else {
            ['quickInstalledList', 'quickUpdatableList', 'quickHotList', 'quickNewestList'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.innerHTML = '<div class="empty">加载中...</div>';
            });
            checkAndShowDownloaded();
        }
        homeLoaded = true;
        homeLoadedTime = Date.now();
    } catch (e) {
        if (homeNoticeCache) {
            data = homeNoticeCache;
            homeNoticeData = data;
            renderCarousel(data);
            renderNoticeRecords(data);
            homeLoaded = true;
        } else {
            var content = document.getElementById('homeNoticeContent');
            if (content) content.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px 0;">加载公告失败</div>';
            homeLoaded = true;
        }
        homeLoadedTime = Date.now();
    } finally {
        _loadingHome = false;
    }
}

// ================================================================
// ★ 轮播图数据解析：兼容三种格式
// ================================================================
function parseCarouselItem(item) {
    if (item && typeof item === 'object') {
        return {
            image: item.image || item.url || '',
            link: item.link || '',
            linkType: item.link_type || ''
        };
    }
    var s = String(item || '');
    var i = s.indexOf('|');
    if (i === -1) return { image: s, link: '', linkType: '' };

    var image = s.slice(0, i).trim();
    var target = s.slice(i + 1).trim();
    var linkType = '', link = target;
    var ci = target.indexOf(':');
    if (ci > 0) {
        var t = target.slice(0, ci).toLowerCase();
        if (t === 'app' || t === 'tag' || t === 'url' || t === 'tab') {
            linkType = t;
            link = target.slice(ci + 1);
        }
    }
    return { image: image, link: link, linkType: linkType };
}

// ★ 解析 `图片|目标` 格式，点击走 onHomeCarouselClick
function renderCarousel(data) {
    var track = document.getElementById('homeCarouselTrack');
    var dotsContainer = document.getElementById('homeCarouselDots');
    if (!track) return;

    stopHomeCarouselAuto();

    if (data.enabled && data.carousel && data.carousel.length > 0) {
        var items = data.carousel
            .map(parseCarouselItem)
            .filter(function (x) { return x.image; });
        _homeCarouselItems = items;
        homeSlideCount = items.length;
        homeSlideIndex = 0;

        track.innerHTML = items.map(function (item, index) {
            var url = wrapImageUrl(item.image);
            var cursor = item.link ? 'pointer' : 'zoom-in';
            var title = item.link ? '' : '点击查看大图';
            return '<div class="home-carousel-slide" style="background-image:url(' + url + ');cursor:' + cursor + ';" ' +
                'onclick="onHomeCarouselClick(' + index + ')"' + (title ? ' title="' + title + '"' : '') + '></div>';
        }).join('');

        if (dotsContainer) {
            dotsContainer.innerHTML = homeSlideCount > 1 ? items.map(function (_, i) {
                return '<button class="dot' + (i === 0 ? ' active' : '') + '" onclick="event.stopPropagation();homeCarouselGoTo(' + i + ')"></button>';
            }).join('') : '';
        }

        startHomeCarouselAuto();
    } else {
        _homeCarouselItems = [];
        track.innerHTML = '<div class="home-carousel-slide" style="background:var(--card-bg);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text-muted);">暂无轮播图</div>';
        homeSlideCount = 1;
        homeSlideIndex = 0;
        if (dotsContainer) dotsContainer.innerHTML = '';
    }
}

// ★ 点击轮播图，有跳转目标就跳，没有就看大图
function onHomeCarouselClick(index) {
    var item = _homeCarouselItems[index];
    if (!item) return;

    if (!item.link) {
        openHomeCarouselImage(index);
        return;
    }

    switch (item.linkType) {
        case 'app':
            if (typeof jumpToAppDetail === 'function') {
                jumpToAppDetail(item.link);
            } else if (typeof openDetail === 'function') {
                openDetail(item.link);
            }
            break;

        case 'tag':
            if (typeof switchTab === 'function') switchTab('apps');
            setTimeout(function () {
                if (typeof filterByTag === 'function') filterByTag(item.link);
            }, 120);
            break;

        case 'url':
            if (/^https?:\/\//i.test(item.link)) {
                var w = window.open(item.link, '_blank', 'noopener');
                if (!w && typeof showToast === 'function') {
                    showToast('浏览器阻止了新窗口，请手动复制链接：' + item.link, 'warning');
                }
            }
            break;

        case 'tab':
            if (typeof switchTab === 'function') switchTab(item.link);
            break;

        default:
            openHomeCarouselImage(index);
            break;
    }
}

function openHomeCarouselImage(index) {
    if (!_homeCarouselItems || _homeCarouselItems.length === 0) return;
    var images = _homeCarouselItems.map(function (x) { return x.image; });
    if (typeof openImageModal === 'function') {
        openImageModal(images, index);
    }
}

// ================================================================
// ★ 自动轮播控制（加固版）
// ================================================================
function startHomeCarouselAuto() {
    stopHomeCarouselAuto();
    if (homeSlideCount <= 1) {
        console.log('[carousel] 只有 ' + homeSlideCount + ' 张图，跳过自动轮播');
        return;
    }
    _homeCarouselTimer = setInterval(function () {
        if (homeSlideCount <= 1) return;
        homeSlideIndex = (homeSlideIndex + 1) % homeSlideCount;
        homeCarouselUpdate();
    }, HOME_CAROUSEL_INTERVAL);
    console.log('[carousel] 自动轮播已启动，' + HOME_CAROUSEL_INTERVAL + 'ms，共 ' + homeSlideCount + ' 张');
}

function stopHomeCarouselAuto() {
    if (_homeCarouselTimer) {
        clearInterval(_homeCarouselTimer);
        _homeCarouselTimer = null;
    }
}

document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        stopHomeCarouselAuto();
    } else {
        if (_homeCarouselItems && _homeCarouselItems.length > 1) {
            startHomeCarouselAuto();
        }
    }
});

// ================================================================
// 公告渲染
// ================================================================
function renderNoticeRecords(data) {
    var container = document.getElementById('homeNoticeContent');
    if (!container) return;
    if (!data.enabled || !data.records || data.records.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px 0;">暂无公告</div>';
        return;
    }
    var html = '<div class="notice-records">';
    data.records.slice(0, 5).forEach(function (record, index) {
        var unread = !isNoticeRead(record);
        html += '<div class="notice-record' + (unread ? ' unread' : '') + '" ' +
            'data-notice-id="' + escapeAttr(noticeRecordId(record)) + '" ' +
            'onclick="openNoticeDetail(' + index + ')">' +
            '<span class="record-unread-dot"></span>' +
            '<div class="record-date">' + record.date + '</div>' +
            '<div class="record-title">' + record.title + '</div>' +
            '</div>';
    });
    if (data.records.length > 5) html += '<div class="notice-more" onclick="openAllNotices()">查看全部公告 →</div>';
    html += '</div>';
    container.innerHTML = html;
}

function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function homeCarouselUpdate() {
    var track = document.getElementById('homeCarouselTrack');
    if (track) track.style.transform = 'translateX(-' + (homeSlideIndex * 100) + '%)';
    document.querySelectorAll('#homeCarouselDots .dot').forEach(function (dot, i) {
        dot.classList.toggle('active', i === homeSlideIndex);
    });
}

// ★ 手动操作后重置自动轮播计时
function homeCarouselPrev(e) {
    if (e) e.stopPropagation();
    if (homeSlideCount <= 1) return;
    homeSlideIndex = (homeSlideIndex - 1 + homeSlideCount) % homeSlideCount;
    homeCarouselUpdate();
    startHomeCarouselAuto();
}
function homeCarouselNext(e) {
    if (e) e.stopPropagation();
    if (homeSlideCount <= 1) return;
    homeSlideIndex = (homeSlideIndex + 1) % homeSlideCount;
    homeCarouselUpdate();
    startHomeCarouselAuto();
}
function homeCarouselGoTo(index) {
    if (index < 0 || index >= homeSlideCount) return;
    homeSlideIndex = index;
    homeCarouselUpdate();
    startHomeCarouselAuto();
}

function updateHomeQuickCards() {
    if (!allAppsData || allAppsData.length === 0) {
        ['quickInstalledList', 'quickUpdatableList', 'quickHotList', 'quickNewestList'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="empty">加载中...</div>';
        });
        return;
    }
    var filteredData = allAppsData.filter(function (app) {return app.id !== 'fn-appstores-client';});
    var installed = filteredData.filter(function (app) {return app.installed;});
    var countEl = document.getElementById('quickInstalledCount');
    if (countEl) countEl.textContent = installed.length;
    renderQuickList('quickInstalledList', installed, 'installed');

    var updatable = filteredData.filter(function (app) {return app.has_update;});
    var updatableCount = document.getElementById('quickUpdatableCount');
    if (updatableCount) updatableCount.textContent = updatable.length;
    renderQuickList('quickUpdatableList', updatable, 'updatable');

    var hot = filteredData.slice().sort(function (a, b) {return (b.downloads || 0) - (a.downloads || 0);}).slice(0, 10);
    renderQuickList('quickHotList', hot, 'hot');

    var newest = filteredData.slice().sort(function (a, b) {
        return new Date(b.updated_at || '1970-01-01') - new Date(a.updated_at || '1970-01-01');
    }).slice(0, 10);
    renderQuickList('quickNewestList', newest, 'newest');
}

function renderQuickList(containerId, apps, type) {
    var container = document.getElementById(containerId);
    if (!container) return;
    if (!apps || apps.length === 0) {container.innerHTML = '<div class="empty">暂无应用</div>'; return;}
    var display = apps.slice(0, 8);
    var html = '';
    display.forEach(function (app) {
        var iconHtml = app.icon ? '<img src="' + wrapImageUrl(app.icon) + '" alt="" loading="lazy">' : '·';
        var meta = type === 'hot' ? '↓ ' + (app.downloads || 0) :
            type === 'installed' ? 'v' + (app.installed_version || app.version) :
                type === 'updatable' ? '⬆ ' + app.version :
                    '📅 ' + (app.updated_at || '');
        html += '<div class="item" onclick="event.stopPropagation();jumpToAppDetail(\'' + app.id + '\')">' +
            '<span class="icon-sm">' + iconHtml + '</span>' +
            '<span class="name">' + app.name + '</span>' +
            '<span class="meta">' + meta + '</span>' +
            '</div>';
    });
    container.innerHTML = html;
}

function openNoticeDetail(index) {
    var data = homeNoticeData;
    if (!data || !data.records || !data.records[index]) return;
    var record = data.records[index];

    markNoticeRead(record);
    var id = noticeRecordId(record);
    var el = document.querySelector('.notice-record[data-notice-id="' + cssEscape(id) + '"]');
    if (el) el.classList.remove('unread');

    var titleEl = document.getElementById('noticeDetailTitle');
    if (titleEl) titleEl.textContent = record.title;
    var bodyEl = document.getElementById('noticeDetailBody');
    if (bodyEl) bodyEl.innerHTML = sanitizeDesc(record.content);
    var modal = document.getElementById('noticeDetailModal');
    if (modal) modal.classList.add('active');
}

function openAllNotices() {
    var data = homeNoticeData;
    if (!data || !data.records || data.records.length === 0) return;
    var titleEl = document.getElementById('noticeDetailTitle');
    if (titleEl) titleEl.textContent = '全部公告';
    var html = '';
    data.records.forEach(function (record, idx) {
        var unread = !isNoticeRead(record);
        html += '<div class="notice-all-item' + (unread ? ' unread' : '') + '" ' +
            'data-notice-id="' + escapeAttr(noticeRecordId(record)) + '" ' +
            'style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">' +
            '<span class="notice-all-unread"></span>' +
            '<div style="font-size:11px;color:var(--text-muted);">' + record.date + '</div>' +
            '<div style="font-size:14px;font-weight:600;color:var(--text-primary);cursor:pointer;" ' +
            'onclick="event.stopPropagation();openNoticeDetail(' + idx + ')">' + record.title + '</div>' +
            '</div>';
    });
    var bodyEl = document.getElementById('noticeDetailBody');
    if (bodyEl) bodyEl.innerHTML = html;
    var modal = document.getElementById('noticeDetailModal');
    if (modal) modal.classList.add('active');
}

function closeNoticeDetail() {
    var modal = document.getElementById('noticeDetailModal');
    if (modal) modal.classList.remove('active');
}

function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, '\\$&');
}

function sanitizeDesc(html) {
    var allowedTags = ['p', 'a', 'b', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'br'];
    var allowedStyles = ['font-size', 'color'];
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');

    function cleanNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
        if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode('');
        var tag = node.tagName.toLowerCase();
        if (allowedTags.indexOf(tag) === -1) {
            var fragment = document.createDocumentFragment();
            node.childNodes.forEach(function (child) {fragment.appendChild(cleanNode(child));});
            return fragment;
        }
        var newEl = document.createElement(tag);
        if (tag === 'a') {
            var href = node.getAttribute('href');
            if (href) {newEl.setAttribute('href', href); newEl.setAttribute('target', '_blank'); newEl.setAttribute('rel', 'noopener noreferrer');}
        }
        var style = node.getAttribute('style');
        if (style) {
            var allowedStyle = '';
            style.split(';').forEach(function (rule) {
                var parts = rule.trim().split(':');
                if (parts.length === 2) {
                    var prop = parts[0].trim().toLowerCase();
                    var val = parts[1].trim();
                    if (allowedStyles.indexOf(prop) !== -1 && val) allowedStyle += prop + ':' + val + ';';
                }
            });
            if (allowedStyle) newEl.setAttribute('style', allowedStyle);
        }
        node.childNodes.forEach(function (child) {newEl.appendChild(cleanNode(child));});
        return newEl;
    }

    var fragment = document.createDocumentFragment();
    doc.body.childNodes.forEach(function (child) {fragment.appendChild(cleanNode(child));});
    return fragment.innerHTML || html;
}