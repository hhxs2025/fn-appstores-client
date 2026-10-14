// ================================================================
// FN软仓 - 应用列表 / 详情 / 轮播
// ================================================================

// ================================================================
// 应用列表过滤
// ================================================================
function filterByTag(tag) {
    currentTag = tag;
    document.querySelectorAll('.filter-btn[data-tag]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.tag === tag);
    });
    currentPage = 1;
    renderFilteredApps();
}
window.filterByTag = filterByTag;

function filterByAppType(type) {
    currentAppType = type;
    document.querySelectorAll('.type-filter-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    currentPage = 1;
    renderFilteredApps();
}
window.filterByAppType = filterByAppType;

function filterBySource(sourceName) {
    currentSourceFilter = sourceName || 'all';
    currentPage = 1;
    renderFilteredApps();
}
window.filterBySource = filterBySource;

function changeSort() {
    var select = document.getElementById('sortSelect');
    if (!select) {
        console.warn('[sort] sortSelect 不存在');
        return;
    }
    currentSort = select.value || 'default';
    currentPage = 1;
    console.log('[sort] 切换排序:', currentSort,
                '| allAppsData.length =', (allAppsData || []).length);
    renderFilteredApps();
}
window.changeSort = changeSort;

function renderFilterButtons() {
    var container = document.getElementById('filterBar');
    if (!container) return;
    var html = '';
    FIXED_TAGS.forEach(function(tag) {
        html += '<button class="filter-btn' + (tag === currentTag ? ' active' : '') + '" data-tag="' + tag + '" onclick="filterByTag(\'' + tag + '\')">' + tag + '</button>';
    });
    container.innerHTML = html;
}

function getUniqueSourceNames() {
    var names = {};
    allAppsData.forEach(function(app) {
        if (app.id === 'fn-appstores-client') return;
        var src = app._source_name || '未知源';
        names[src] = true;
    });
    return Object.keys(names).sort();
}

function updateSourceFilterOptions() {
    var select = document.getElementById('sourceFilterSelect');
    if (!select) return;
    var names = getUniqueSourceNames();
    var html = '<option value="all">全部源</option>';
    names.forEach(function(name) {
        var selected = currentSourceFilter === name ? ' selected' : '';
        html += '<option value="' + name + '"' + selected + '>' + name + '</option>';
    });
    select.innerHTML = html;
}

function sortApps(apps) {
    if (!apps || apps.length <= 1) return apps;
    if (currentSort === 'default') return apps;

    var sorted = apps.slice();

    switch (currentSort) {
        case 'name':
            sorted.sort(function(a, b) {
                var an = String(a.name || '');
                var bn = String(b.name || '');
                if (an === bn) return 0;
                return an < bn ? -1 : 1;
            });
            break;

        case 'author':
            function normAuthor(s) {
                return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
            }
            sorted.sort(function(a, b) {
                var aa = normAuthor(a.author);
                var bb = normAuthor(b.author);
                if (!aa && !bb) {
                    var an = String(a.name || '');
                    var bn = String(b.name || '');
                    return an < bn ? -1 : (an > bn ? 1 : 0);
                }
                if (!aa) return 1;
                if (!bb) return -1;
                var la = aa.toLowerCase();
                var lb = bb.toLowerCase();
                if (la !== lb) return la < lb ? -1 : 1;
                var an = String(a.name || '');
                var bn = String(b.name || '');
                return an < bn ? -1 : (an > bn ? 1 : 0);
            });
            break;

        case 'downloads':
            sorted.sort(function(a, b) { return (b.downloads || 0) - (a.downloads || 0); });
            break;

        case 'updated':
            sorted.sort(function(a, b) {
                var da = String(a.updated_at || '');
                var db = String(b.updated_at || '');
                if (da === db) return 0;
                return da < db ? 1 : -1;
            });
            break;
    }

    return sorted;
}

function getCurrentPageData(apps) { return apps; }
function renderPagination() {}
function prevPage() {}
function nextPage() {}

function getFilteredApps() {
    var result = allAppsData.filter(function(app) { return app.id !== 'fn-appstores-client'; });
    var keywordEl = document.getElementById('searchInput');
    if (keywordEl) {
        var keyword = keywordEl.value.toLowerCase().trim();
        if (keyword) {
            result = result.filter(function(app) {
                return (app.name && app.name.toLowerCase().includes(keyword)) ||
                    (app.desc && app.desc.toLowerCase().includes(keyword)) ||
                    (app.author && app.author.toLowerCase().includes(keyword));
            });
        }
    }
    if (currentTag !== '全部') {
        result = result.filter(function(app) {
            var appTags = getTagsArray(app.tags);
            return appTags.some(function(t) { return t === currentTag; });
        });
    }
    if (currentAppType === 'docker') {
        result = result.filter(function(app) {
            if (app.type) {
                var typeLower = String(app.type).toLowerCase();
                if (typeLower === 'docker' || typeLower === '容器') return true;
            }
            var tags = getTagsArray(app.tags);
            return tags.some(function(t) {
                var tl = t.toLowerCase();
                return tl.includes('docker') || tl.includes('容器');
            });
        });
    } else if (currentAppType === 'native') {
        result = result.filter(function(app) {
            if (app.type) {
                var typeLower = String(app.type).toLowerCase();
                if (typeLower === '原生' || typeLower === 'native' || typeLower === '本地') return true;
                if (typeLower === 'docker' || typeLower === '容器') return false;
            }
            var tags = getTagsArray(app.tags);
            return !tags.some(function(t) {
                var tl = t.toLowerCase();
                return tl.includes('docker') || tl.includes('容器');
            });
        });
    }
    if (currentSourceFilter !== 'all') {
        result = result.filter(function(app) {
            return (app._source_name || '未知源') === currentSourceFilter;
        });
    }
    return sortApps(result);
}

function renderFilteredApps() {
    var filtered = getFilteredApps();
    console.log('[render] 过滤后', filtered.length, '个应用 | 排序:', currentSort);
    renderApps(filtered);
    var countEl = document.getElementById('appCount');
    if (countEl) countEl.textContent = filtered.length;
    if (typeof updateSettingsStats === 'function') updateSettingsStats();
}

// ================================================================
// 轮播
// ================================================================
function initCarousel(screenshots) {
    var container = document.getElementById('carouselContainer');
    if (!container) return;
    var track = document.getElementById('carouselTrack');
    var dotsContainer = document.getElementById('carouselDots');
    slideCount = screenshots ? screenshots.length : 0;
    currentSlide = 0;
    if (slideCount === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    window._currentScreenshots = screenshots;
    if (track) {
        track.innerHTML = screenshots.map(function(url, index) {
            return '<img src="' + wrapImageUrl(url) + '" alt="应用截图" loading="lazy" onerror="this.style.display=\'none\'" onclick="event.stopPropagation();openImageModal(window._currentScreenshots || [], ' + index + ')">';
        }).join('');
    }
    var prevBtn = document.getElementById('carouselPrev');
    var nextBtn = document.getElementById('carouselNext');
    if (prevBtn) prevBtn.classList.toggle('show', slideCount > 1);
    if (nextBtn) nextBtn.classList.toggle('show', slideCount > 1);
    if (dotsContainer) {
        dotsContainer.innerHTML = slideCount > 1 ? screenshots.map(function(_, i) {
            return '<button class="dot' + (i === 0 ? ' active' : '') + '" onclick="goToSlide(' + i + ')"></button>';
        }).join('') : '';
    }
    updateCarousel();
}

function updateCarousel() {
    var track = document.getElementById('carouselTrack');
    if (track) track.style.transform = 'translateX(-' + (currentSlide * 100) + '%)';
    document.querySelectorAll('.carousel-dots .dot').forEach(function(dot, i) {
        dot.classList.toggle('active', i === currentSlide);
    });
}

function carouselPrev() { if (slideCount > 1) { currentSlide = (currentSlide - 1 + slideCount) % slideCount; updateCarousel(); } }
function carouselNext() { if (slideCount > 1) { currentSlide = (currentSlide + 1) % slideCount; updateCarousel(); } }
function goToSlide(index) { currentSlide = index; updateCarousel(); }
window.carouselPrev = carouselPrev;
window.carouselNext = carouselNext;
window.goToSlide = goToSlide;

// ================================================================
// 大图预览
// ================================================================
function openImageModal(images, index) {
    if (!images || images.length === 0) return;
    imageList = images;
    currentImageIndex = index || 0;
    var img = document.getElementById('modalImage');
    if (!img) return;
    img.src = wrapImageUrl(imageList[currentImageIndex]);
    var counter = document.getElementById('imageCounter');
    if (counter) counter.textContent = (currentImageIndex + 1) + ' / ' + imageList.length;
    var prevBtn = document.getElementById('imagePrevBtn');
    var nextBtn = document.getElementById('imageNextBtn');
    if (prevBtn) prevBtn.style.display = imageList.length > 1 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = imageList.length > 1 ? 'flex' : 'none';
    var modal = document.getElementById('imageModal');
    if (modal) modal.classList.add('active');
}
function closeImageModal() {
    var modal = document.getElementById('imageModal');
    if (modal) modal.classList.remove('active');
}
function imagePrev() {
    if (imageList.length === 0) return;
    currentImageIndex = (currentImageIndex - 1 + imageList.length) % imageList.length;
    var img = document.getElementById('modalImage');
    if (img) img.src = wrapImageUrl(imageList[currentImageIndex]);
    var counter = document.getElementById('imageCounter');
    if (counter) counter.textContent = (currentImageIndex + 1) + ' / ' + imageList.length;
}
function imageNext() {
    if (imageList.length === 0) return;
    currentImageIndex = (currentImageIndex + 1) % imageList.length;
    var img = document.getElementById('modalImage');
    if (img) img.src = wrapImageUrl(imageList[currentImageIndex]);
    var counter = document.getElementById('imageCounter');
    if (counter) counter.textContent = (currentImageIndex + 1) + ' / ' + imageList.length;
}
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.imagePrev = imagePrev;
window.imageNext = imageNext;

document.addEventListener('keydown', function(e) {
    var modal = document.getElementById('imageModal');
    if (!modal || !modal.classList.contains('active')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); imagePrev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); imageNext(); }
    if (e.key === 'Escape') { e.preventDefault(); closeImageModal(); }
});

// ================================================================
// 详情视图
// ================================================================
function openDetail(appId) {
    if (appId === 'fn-appstores-client') {
        switchTab('settings');
        setTimeout(function() { switchSettingTab('system'); }, 300);
        showToast('请在「设置 → 系统」中检查更新', 'info');
        return;
    }
    var app = allAppsData.find(function(a) { return a.id === appId; });
    if (!app) {
        showToast('应用数据不存在，请刷新重试', 'error');
        return;
    }

    var appsTab = document.getElementById('tabApps');
    if (!appsTab || !appsTab.classList.contains('active')) {
        window._pendingDetailAppId = appId;
        if (typeof switchTab === 'function') {
            switchTab('apps');
        }
        return;
    }

    currentDetailApp = app;

    var listView = document.getElementById('appsListView');
    var detailView = document.getElementById('appsDetailView');
    if (listView) listView.classList.remove('active');
    if (detailView) {
        detailView.classList.add('active');
        detailView.scrollTop = 0;
    }

    var iconEl = document.getElementById('detailIcon');
    if (iconEl) iconEl.innerHTML = app.icon ? '<img src="' + wrapImageUrl(app.icon) + '" alt="">' : '·';

    var titleEl = document.getElementById('detailTitle');
    if (titleEl) titleEl.textContent = app.name;

    var ratingInline = document.getElementById('detailRatingInline');
    if (ratingInline) {
        if (app.rating_count > 0) {
            ratingInline.textContent = '★ ' + (app.rating_avg || 0).toFixed(1);
            ratingInline.style.display = '';
        } else {
            ratingInline.style.display = 'none';
        }
    }

    var tags = getTagsArray(app.tags);
    var category = tags.length > 0 ? tags[0] : '';
    var sourceName = '';
    if (app._source_id === 'official') {
        sourceName = '🎖️官方';
    } else if (app._source_name) {
        sourceName = '🎖️三方';
    }
    var parts = [];
    if (category) parts.push(category);
    if (sourceName) parts.push(sourceName);
    var subtitleEl = document.getElementById('detailSubtitle');
    if (subtitleEl) subtitleEl.textContent = parts.join(' · ') || '—';

    document.getElementById('detailMetaAuthor').textContent = app.author || '-';
    document.getElementById('detailMetaVersion').textContent = app.version ? 'v' + app.version : '-';
    document.getElementById('detailMetaSource').textContent =
        app._source_id === 'official' ? '🎖️官方' : '🎖️三方';
    document.getElementById('detailMetaDownloads').textContent = (app.downloads || 0);
    document.getElementById('detailMetaUpdated').textContent = app.updated_at || '-';
    document.getElementById('detailMetaType').textContent = app.type || '未指定';

    var changelogSection = document.getElementById('detailChangelogSection');
    var changelogEl = document.getElementById('detailChangelog');
    if (changelogEl && changelogSection) {
        var rawText = (app.desc || '').replace(/<[^>]+>/g, '').trim();
        var lines = rawText.split(/\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
        if (lines.length >= 2) {
            var html = '<ol class="changelog-list">';
            lines.forEach(function (line) { html += '<li>' + line + '</li>'; });
            html += '</ol>';
            changelogEl.innerHTML = html;
            changelogSection.style.display = '';
        } else {
            changelogSection.style.display = 'none';
        }
    }

    var descEl = document.getElementById('detailDesc');
    if (descEl) descEl.innerHTML = app.desc || '暂无描述';

    var btn = document.getElementById('detailInstallBtn');
    if (btn) {
        if (app.installed && app.has_update) {
            btn.textContent = '更新';
            btn.className = 'card-btn btn-update';
            btn.disabled = false;
            btn.dataset.action = 'update';
        } else if (app.installed) {
            btn.textContent = '已安装';
            btn.className = 'card-btn btn-opened';
            btn.disabled = true;
            btn.dataset.action = 'none';
        } else {
            btn.textContent = '安装';
            btn.className = 'card-btn btn-install';
            btn.disabled = false;
            btn.dataset.action = 'install';
        }
        btn.dataset.appId = app.id;
    }

    syncDetailFavoriteBtn(app.id);
    showManageButtons(!!app.installed);

    var repoBtn = document.getElementById('detailRepoBtn');
    if (repoBtn) {
        if (app.repo) {
            var repoUrl = app.repo.replace(/\.git$/, '').replace(/\/$/, '');
            repoBtn.href = repoUrl + '/issues';
            repoBtn.style.display = 'inline-flex';
        } else {
            repoBtn.style.display = 'none';
        }
    }

    var scSection = document.getElementById('detailScreenshotsSection');
    if (app.screenshots && app.screenshots.length > 0) {
        if (scSection) scSection.style.display = '';
        initCarousel(app.screenshots);
    } else {
        if (scSection) scSection.style.display = 'none';
    }

    loadRating(app.id);
}
window.openDetail = openDetail;

// ================================================================
// 收藏按钮（详情页 + 卡片快捷）
// ================================================================
function syncDetailFavoriteBtn(appId) {
    var btn = document.getElementById('detailFavBtn');
    var icon = document.getElementById('detailFavIcon');
    var text = document.getElementById('detailFavText');
    if (!btn || !icon || !text) return;
    var isFav = (typeof isFavorite === 'function') && isFavorite(appId);
    btn.dataset.appId = appId;
    if (isFav) {
        btn.classList.add('active');
        icon.textContent = '★';
        text.textContent = '已收藏';
    } else {
        btn.classList.remove('active');
        icon.textContent = '☆';
        text.textContent = '收藏';
    }
}
window.syncDetailFavoriteBtn = syncDetailFavoriteBtn;

function toggleDetailFavorite() {
    try {
        if (!currentDetailApp) {
            console.warn('[fav] 无 currentDetailApp');
            return;
        }
        if (typeof toggleFavorite !== 'function') {
            console.warn('[fav] toggleFavorite 未定义');
            return;
        }
        var nowFav = toggleFavorite(currentDetailApp.id);
        syncDetailFavoriteBtn(currentDetailApp.id);

        var cardBtn = document.querySelector('.card-fav-btn[data-app-id="' + currentDetailApp.id + '"]');
        if (cardBtn) cardBtn.classList.toggle('active', nowFav);

        showToast(nowFav ? '已收藏' : '已取消收藏', 'success');

        var panel = document.getElementById('spanel-favorites');
        if (panel && panel.classList.contains('active') && typeof window.renderFavorites === 'function') {
            window.renderFavorites();
        }
        if (typeof updateSettingsStats === 'function') updateSettingsStats();
    } catch (e) {
        console.error('[fav] toggleDetailFavorite 异常:', e);
        showToast('操作失败：' + e.message, 'error');
    }
}
window.toggleDetailFavorite = toggleDetailFavorite;

function toggleCardFavorite(appId) {
    try {
        if (!appId) return;
        if (typeof toggleFavorite !== 'function') {
            console.warn('[fav] toggleFavorite 未定义');
            return;
        }
        var nowFav = toggleFavorite(appId);
        var btn = document.querySelector('.card-fav-btn[data-app-id="' + appId + '"]');
        if (btn) {
            btn.classList.toggle('active', nowFav);
            btn.textContent = nowFav ? '★' : '☆';
        }
        if (currentDetailApp && currentDetailApp.id === appId) syncDetailFavoriteBtn(appId);
        showToast(nowFav ? '已收藏' : '已取消收藏', 'success');

        var panel = document.getElementById('spanel-favorites');
        if (panel && panel.classList.contains('active') && typeof window.renderFavorites === 'function') {
            window.renderFavorites();
        }
        if (typeof updateSettingsStats === 'function') updateSettingsStats();
    } catch (e) {
        console.error('[fav] toggleCardFavorite 异常:', e);
        showToast('操作失败：' + e.message, 'error');
    }
}
window.toggleCardFavorite = toggleCardFavorite;

function backToAppsList() {
    var listView = document.getElementById('appsListView');
    var detailView = document.getElementById('appsDetailView');
    if (detailView) detailView.classList.remove('active');
    if (listView) listView.classList.add('active');
    currentDetailApp = null;
}
window.backToAppsList = backToAppsList;

function detailInstall() {
    var btn = document.getElementById('detailInstallBtn');
    if (!btn) return;
    var appId = btn.dataset.appId;
    if (!appId) return;
    if (btn.dataset.action === 'none') { showToast('应用已安装', 'info'); return; }
    if (btn.dataset.action === 'update') updateApp(appId);
    else installApp(appId);
}
window.detailInstall = detailInstall;

function jumpToAppDetail(appId) {
    var appsTab = document.getElementById('tabApps');
    if (!appsTab || !appsTab.classList.contains('active')) {
        window._pendingDetailAppId = appId;
        switchTab('apps');
        return;
    }
    backToAppsList();
    setTimeout(function () { openDetail(appId); }, 30);
}
window.jumpToAppDetail = jumpToAppDetail;

// ================================================================
// 渲染应用卡片
// ================================================================
function renderApps(apps) {
    var grid = document.getElementById('appGrid');
    if (!grid) return;
    if (!apps || apps.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="icon">·</div><p>暂无符合条件的应用</p></div>';
        return;
    }
    grid.innerHTML = apps.map(function(app) {
        var btnHtml = '';
        if (app.installed && app.has_update) {
            btnHtml = '<button class="card-btn btn-update" id="installBtn-' + app.id + '" onclick="event.stopPropagation();updateApp(\'' + app.id + '\')">更新</button>';
        } else if (app.installed) {
            btnHtml = '<button class="card-btn btn-opened" disabled>已安装</button>';
        } else {
            btnHtml = '<button class="card-btn btn-install" id="installBtn-' + app.id + '" onclick="event.stopPropagation();installApp(\'' + app.id + '\')">安装</button>';
        }

        var ratingHtml = '';
        if (app.rating_count > 0) {
            ratingHtml = '<span class="rating-inline" title="' + (app.rating_avg || 0).toFixed(1) + ' 分 · ' + app.rating_count + ' 人评分">★ ' + (app.rating_avg || 0).toFixed(1) + '</span>';
        }

        var tags = getTagsArray(app.tags);
        var category = tags.length > 0 ? tags[0] : '';
        var sourceName = '';
        if (app._source_id === 'official') {
            sourceName = '🎖️官方';
        } else if (app._source_name) {
            sourceName = '🎖️三方';
        }
        var parts = [];
        if (category) parts.push(category);
        if (sourceName) parts.push(sourceName);
        var subtitle = parts.join(' · ');

        var updateDot = (app.installed && app.has_update) ? '<span class="update-dot"></span>' : '';

        var favActive = (typeof isFavorite === 'function' && isFavorite(app.id)) ? ' active' : '';
        var favStar = favActive ? '★' : '☆';
        var favBtnHtml = '<button class="card-fav-btn' + favActive + '" ' +
            'data-app-id="' + app.id + '" ' +
            'title="收藏/取消收藏" ' +
            'onclick="event.stopPropagation();toggleCardFavorite(\'' + app.id + '\');">' + favStar + '</button>';

        return '<div class="app-card" id="card-' + app.id + '" onclick="openDetail(\'' + app.id + '\')">' +
            favBtnHtml +
            '<div class="card-icon">' +
                (app.icon ? '<img src="' + wrapImageUrl(app.icon) + '" loading="lazy" alt="">' : '·') +
            '</div>' +
            '<div class="card-info">' +
                '<div class="card-name">' + app.name + ratingHtml + updateDot + '</div>' +
                (subtitle ? '<div class="card-subtitle">' + subtitle + '</div>' : '') +
            '</div>' +
            '<div class="card-action" onclick="event.stopPropagation();">' + btnHtml + '</div>' +
            '</div>';
    }).join('');
}

// ================================================================
// 加载应用
// ================================================================
async function loadApps() {
    if (_loadingApps) return;
    _loadingApps = true;
    var cachedData = readAppsCache();
    if (cachedData) {
        allAppsData = cachedData;
        setTimeout(function () {
            renderFilterButtons();
            renderFilteredApps();
            var badge = document.getElementById('statusBadge');
            if (badge) {badge.textContent = '缓存'; badge.className = 'badge cached';}
            if (typeof updateSourceFilterOptions === 'function') updateSourceFilterOptions();
            if (typeof updateHomeQuickCards === 'function') updateHomeQuickCards();
            _loadingApps = false;
        }, 100);
        loadAppsFromServer(true);
        return;
    }
    await loadAppsFromServer(false);
}
window.loadApps = loadApps;

async function loadAppsFromServer(silent) {
    try {
        var controller = new AbortController();
        setTimeout(function () {controller.abort();}, 30000);
        var resp = await fetch(API_BASE + '/api/apps', {signal: controller.signal});
        if (resp.status === 429) {
            var data = await resp.json();
            if (!silent) showToast(data.message, 'warning');
            startCooldown(data.retry_after || 30);
            var grid = document.getElementById('appGrid');
            if (grid) grid.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>请求过于频繁，请 ' + (data.retry_after || 30) + ' 秒后点击刷新</p></div>';
            _loadingApps = false;
            return;
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        if (data.success && data.data.length > 0) {
            allAppsData = data.data;
            await loadInstalledVersions();
            renderFilterButtons();
            currentPage = 1;
            renderFilteredApps();
            if (!silent) {
                var badge = document.getElementById('statusBadge');
                if (badge) {badge.textContent = '在线'; badge.className = 'badge connected';}
                updateLastRefreshTime();
            }
            writeAppsCache(allAppsData);
            if (typeof updateSourceFilterOptions === 'function') updateSourceFilterOptions();
            if (typeof updateHomeQuickCards === 'function') updateHomeQuickCards();

            var devTab = document.getElementById('tabDevelopers');
            if (devTab && devTab.classList.contains('active') && typeof renderDevelopers === 'function') {
                renderDevelopers();
            }
        } else if (!silent) {
            var grid = document.getElementById('appGrid');
            if (grid) grid.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>加载失败，请点击右上角「刷新」重试</p></div>';
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            var fallbackData = readAppsCache();
            if (fallbackData) {
                allAppsData = fallbackData;
                renderFilterButtons();
                renderFilteredApps();
                if (typeof updateHomeQuickCards === 'function') updateHomeQuickCards();
                if (!silent) showToast('使用离线缓存（网络异常）', 'warning');
            } else if (!silent) {
                showToast('加载失败: ' + e.message, 'error');
                var grid = document.getElementById('appGrid');
                if (grid) grid.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>加载失败，请点击右上角「刷新」重试</p></div>';
            }
        }
    } finally {
        _loadingApps = false;
    }
}

function restoreAppsView() {
    try {
        var cachedData = readAppsCache();
        if (cachedData) {
            allAppsData = cachedData;
            renderFilterButtons();
            renderFilteredApps();
            var badge = document.getElementById('statusBadge');
            if (badge) {badge.textContent = '缓存'; badge.className = 'badge cached';}
            if (typeof updateSourceFilterOptions === 'function') updateSourceFilterOptions();
            return;
        }
    } catch (e) {}
    if (allAppsData && allAppsData.length > 0) {
        renderFilteredApps();
        if (typeof updateSourceFilterOptions === 'function') updateSourceFilterOptions();
        return;
    }
    loadApps();
}
window.restoreAppsView = restoreAppsView;

async function loadInstalledVersions() {
    try {
        var resp = await fetch(API_BASE + '/api/installed');
        var data = await resp.json();
        if (data.success) {
            installedAppsCache = {};
            data.apps.forEach(function (app) {installedAppsCache[app.id] = app.version;});
            var now = Date.now();
            allAppsData.forEach(function (app) {
                if (app._justInstalledAt && now - app._justInstalledAt < 30000) {
                    return;
                }
                if (app.id in installedAppsCache) {
                    app.installed = true;
                    app.installed_version = installedAppsCache[app.id];
                    app.has_update = app.installed_version && app.version && compareVersions(app.version, app.installed_version) > 0;
                } else {
                    app.installed = false;
                    app.has_update = false;
                }
            });
            writeAppsCache(allAppsData);
            if (typeof updateHomeQuickCards === 'function') updateHomeQuickCards();
            _installedLoaded = true;
        }
    } catch (e) {}
}

function updateLastRefreshTime() {
    var el = document.getElementById('lastRefresh');
    if (el) el.textContent = '上次刷新: ' + new Date().toLocaleTimeString();
}

async function refreshApps() {
    var btn = document.getElementById('refreshBtn');
    var badge = document.getElementById('statusBadge');
    if (!btn || !badge) return;
    if (refreshCooldown || btn.disabled) {showToast('请稍后再试', 'warning'); return;}
    btn.disabled = true;
    btn.textContent = '刷新中...';
    badge.textContent = '加载中';
    badge.className = 'badge loading';
    try {
        var resp = await fetch(API_BASE + '/api/refresh', {method: 'POST', headers: {'Content-Type': 'application/json'}});
        var data = await resp.json();
        if (resp.status === 429) {
            showToast(data.message, 'warning');
            startCooldown(data.retry_after || 30);
            badge.textContent = '限流中';
            badge.className = 'badge error';
            return;
        }
        if (data.success) {
            allAppsData = data.data;
            await loadInstalledVersions();
            renderFilterButtons();
            currentPage = 1;
            renderFilteredApps();
            showToast(data.message, 'success');
            updateLastRefreshTime();
            badge.textContent = '在线';
            badge.className = 'badge connected';
            writeAppsCache(allAppsData);
            if (typeof updateSourceFilterOptions === 'function') updateSourceFilterOptions();

            var devTab2 = document.getElementById('tabDevelopers');
            if (devTab2 && devTab2.classList.contains('active') && typeof renderDevelopers === 'function') {
                renderDevelopers();
            }
        } else {
            showToast('刷新失败: ' + data.message, 'error');
            badge.textContent = '失败';
            badge.className = 'badge error';
        }
    } catch (e) {
        showToast('刷新失败: ' + e.message, 'error');
        badge.textContent = '错误';
        badge.className = 'badge error';
    } finally {
        startCooldown(REFRESH_COOLDOWN);
        btn.disabled = false;
        btn.textContent = '刷新';
    }
}
window.refreshApps = refreshApps;

function startCooldown(seconds) {
    var btn = document.getElementById('refreshBtn');
    if (!btn) return;
    refreshCooldown = true;
    var remaining = seconds;
    if (refreshTimer) clearInterval(refreshTimer);
    btn.classList.add('cooldown');
    refreshTimer = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
            clearInterval(refreshTimer);
            refreshTimer = null;
            refreshCooldown = false;
            btn.disabled = false;
            btn.textContent = '刷新';
            btn.classList.remove('cooldown');
        } else {
            btn.textContent = remaining + 's';
        }
    }, 1000);
}

// ================================================================
// ★ 应用管理：停止 / 启动 / 重启 / 卸载
// ================================================================

function showManageButtons(installed) {
    var ids = ['detailStopBtn', 'detailStartBtn', 'detailRestartBtn', 'detailUninstallBtn'];
    ids.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = installed ? '' : 'none';
    });
}
window.showManageButtons = showManageButtons;

async function manageApp(action, appId) {
    if (!appId) {
        showToast('缺少应用 ID', 'error');
        return;
    }

    var actionText = {
        stop: '停止',
        start: '启动',
        restart: '重启',
        uninstall: '卸载'
    }[action] || action;

    var btnMap = {
        stop: 'detailStopBtn',
        start: 'detailStartBtn',
        restart: 'detailRestartBtn',
        uninstall: 'detailUninstallBtn'
    };

    var appName = currentDetailApp ? (currentDetailApp.name || appId) : appId;
    if (action === 'uninstall') {
        if (!confirm('确定要卸载「' + appName + '」吗？\n\n应用的配置数据、用户数据会保留（飞牛系统默认行为）。')) return;
    } else if (action === 'restart') {
        if (!confirm('确定要重启「' + appName + '」吗？')) return;
    } else if (action === 'stop') {
        if (!confirm('确定要停止「' + appName + '」吗？\n\n停止后应用将无法访问，可随时重新启动。')) return;
    }

    var allBtns = ['detailStopBtn', 'detailStartBtn', 'detailRestartBtn', 'detailUninstallBtn'];
    var origText = {};
    allBtns.forEach(function(id) {
        var b = document.getElementById(id);
        if (b) { b.disabled = true; origText[id] = b.textContent; }
    });
    var self = document.getElementById(btnMap[action]);
    if (self) self.textContent = actionText + '中...';

    showToast(actionText + '中，请稍候...', 'info');

    try {
        var resp = await fetch(
            API_BASE + '/api/app/' + encodeURIComponent(appId) + '/' + action,
            { method: 'POST', headers: {'Content-Type': 'application/json'} }
        );
        var data = await resp.json();

        if (data.success) {
            showToast(data.message || (actionText + '成功'), 'success');

            if (action === 'uninstall' && currentDetailApp) {
                currentDetailApp.installed = false;
                currentDetailApp.installed_version = '';
                currentDetailApp.has_update = false;
                var appInList = allAppsData.find(function(a) { return a.id === appId; });
                if (appInList) {
                    appInList.installed = false;
                    appInList.installed_version = '';
                    appInList.has_update = false;
                }
                if (typeof writeAppsCache === 'function') writeAppsCache(allAppsData);
                setTimeout(function() {
                    if (typeof refreshApps === 'function') refreshApps();
                    if (typeof backToAppsList === 'function') backToAppsList();
                }, 800);
            } else {
                setTimeout(function() {
                    if (currentDetailApp && currentDetailApp.id === appId) {
                        openDetail(appId);
                    }
                }, 500);
            }

            if (typeof updateHomeQuickCards === 'function') updateHomeQuickCards();
            if (typeof updateSettingsStats === 'function') updateSettingsStats();
        } else {
            showToast(data.message || (actionText + '失败'), 'error');
            console.error('[manage] ' + action + ' 失败:', data);
        }
    } catch (e) {
        showToast(actionText + '失败: ' + e.message, 'error');
        console.error('[manage] ' + action + ' 异常:', e);
    } finally {
        allBtns.forEach(function(id) {
            var b = document.getElementById(id);
            if (b) {
                b.disabled = false;
                if (origText[id] !== undefined) b.textContent = origText[id];
            }
        });
    }
}
window.manageApp = manageApp;

function stopApp() {
    if (!currentDetailApp) return;
    manageApp('stop', currentDetailApp.id);
}
function startApp() {
    if (!currentDetailApp) return;
    manageApp('start', currentDetailApp.id);
}
function restartApp() {
    if (!currentDetailApp) return;
    manageApp('restart', currentDetailApp.id);
}
function uninstallApp() {
    if (!currentDetailApp) return;
    manageApp('uninstall', currentDetailApp.id);
}

window.stopApp = stopApp;
window.startApp = startApp;
window.restartApp = restartApp;
window.uninstallApp = uninstallApp;