// ================================================================
// FN软仓 - 首页 + 公告 + 快捷卡片
// ================================================================

// ★ 需求2：公告已读状态（localStorage）
var READ_NOTICES_KEY = 'fnsoft_read_notices';

// 生成公告唯一 ID（date + title 组合，与顺序无关）
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
    if (map[id]) return; // 已读，不重复写
    map[id] = Date.now();
    // 简单裁剪：最多保留最近 500 条已读记录，防止 localStorage 撑爆
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

async function loadHome() {
    if (homeLoaded) return;
    if (_loadingHome) return;
    _loadingHome = true;
    var now = Date.now();
    var hasCache = homeNoticeCache && (now - homeNoticeCacheTime) < HOME_CACHE_TTL;
    try {
        var data;
        if (hasCache) {
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
    } finally {
        _loadingHome = false;
    }
}

function renderCarousel(data) {
    var track = document.getElementById('homeCarouselTrack');
    var dotsContainer = document.getElementById('homeCarouselDots');
    if (!track) return;
    if (data.enabled && data.carousel && data.carousel.length > 0) {
        var images = data.carousel.map(wrapImageUrl);
        homeSlideCount = images.length;
        homeSlideIndex = 0;
        track.innerHTML = images.map(function (url, index) {
            return '<div class="home-carousel-slide" style="background-image:url(' + url + ');cursor:zoom-in;" onclick="openHomeCarouselImage(' + index + ')" title="点击查看大图"></div>';
        }).join('');
        if (dotsContainer) {
            dotsContainer.innerHTML = homeSlideCount > 1 ? images.map(function (_, i) {
                return '<button class="dot' + (i === 0 ? ' active' : '') + '" onclick="event.stopPropagation();homeCarouselGoTo(' + i + ')"></button>';
            }).join('') : '';
        }
    } else {
        track.innerHTML = '<div class="home-carousel-slide" style="background:var(--card-bg);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text-muted);">暂无轮播图</div>';
        homeSlideCount = 1;
        homeSlideIndex = 0;
        if (dotsContainer) dotsContainer.innerHTML = '';
    }
}

function openHomeCarouselImage(index) {
    if (!homeNoticeData || !homeNoticeData.carousel || homeNoticeData.carousel.length === 0) return;
    openImageModal(homeNoticeData.carousel, index);
}

// ★ 需求2：渲染公告记录，带未读红点
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

function homeCarouselPrev(e) {if (e) e.stopPropagation(); if (homeSlideCount <= 1) return; homeSlideIndex = (homeSlideIndex - 1 + homeSlideCount) % homeSlideCount; homeCarouselUpdate();}
function homeCarouselNext(e) {if (e) e.stopPropagation(); if (homeSlideCount <= 1) return; homeSlideIndex = (homeSlideIndex + 1) % homeSlideCount; homeCarouselUpdate();}
function homeCarouselGoTo(index) {if (index < 0 || index >= homeSlideCount) return; homeSlideIndex = index; homeCarouselUpdate();}

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

// ★ 需求2：打开公告详情 → 标记已读
function openNoticeDetail(index) {
    var data = homeNoticeData;
    if (!data || !data.records || !data.records[index]) return;
    var record = data.records[index];

    // 标记已读
    markNoticeRead(record);
    // 更新 DOM（去掉 unread）
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

// ★ 需求2：全部公告 → 每条可单独标记已读
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

// CSS.escape 兜底
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