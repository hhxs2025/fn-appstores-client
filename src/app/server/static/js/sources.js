// ================================================================
// FN软仓 - 源管理
// ================================================================

async function loadSources(force) {
    var container = document.getElementById('sourceList');
    if (!container) return;
    if (_loadingSources) return;
    _loadingSources = true;
    var oldHtml = container.innerHTML;
    container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:11px;">加载中...</div>';
    try {
        var resp = await fetch(API_BASE + '/api/sources?force=' + (force ? 'true' : 'false'));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        if (!data.success || !data.data) throw new Error(data.message || '加载失败');
        var sources = data.data;
        if (sources.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:11px;">暂无软件源</div>';
            _loadingSources = false;
            return;
        }
        var countEl = document.getElementById('settingsSourceCount');
        if (countEl) countEl.textContent = sources.length;

        container.innerHTML = sources.map(function (source) {
            var statusColor = source.status === 'online' ? '#5a8a5a' : source.status === 'disabled' ? '#999' : source.status === 'offline' ? '#b55a5a' : '#999';
            var statusText = source.status === 'online' ? '在线' : source.status === 'disabled' ? '已禁用' : source.status === 'offline' ? '离线' : '未知';
            var isDefault = source.id === 'official' || source.id === 'official_backup';
            var displayUrl = isDefault ? '●●●●●●●' : source.url;

            var toggleBtn = '';
            if (!isDefault) {
                if (source.enabled) {
                    toggleBtn = '<button class="btn btn-disable" onclick="toggleSource(\'' + source.id + '\',false)">禁用</button>';
                } else {
                    toggleBtn = '<button class="btn btn-enable" onclick="toggleSource(\'' + source.id + '\',true)">启用</button>';
                }
            }

            return '<div class="source-item">' +
                '<div class="info">' +
                '<div class="name-row">' +
                '<span class="name">' + source.name + '</span>' +
                (isDefault ? '<span class="badge">官方</span>' : '') +
                '<span class="status" style="color:' + statusColor + ';">● ' + statusText + '</span>' +
                '</div>' +
                '<div class="url">' + displayUrl + '</div>' +
                (source.status_msg && source.status !== 'online' ? '<div class="status-msg">' + source.status_msg + '</div>' : '') +
                '</div>' +
                '<div class="actions">' +
                toggleBtn +
                (isDefault ? '' : '<button class="btn btn-delete" onclick="removeSource(\'' + source.id + '\')">删除</button>') +
                '</div>' +
                '</div>';
        }).join('');
    } catch (e) {
        if (oldHtml) {
            container.innerHTML = oldHtml;
            showToast('加载源列表失败，显示上次缓存', 'warning');
        } else {
            container.innerHTML = '<div style="text-align:center;padding:12px;color:#b55a5a;font-size:11px;">加载失败: ' + e.message + '</div>';
        }
    } finally {
        _loadingSources = false;
    }
}

async function addSource() {
    var nameEl = document.getElementById('newSourceName');
    var urlEl = document.getElementById('newSourceUrl');
    if (!nameEl || !urlEl) return;
    var name = nameEl.value.trim();
    var url = urlEl.value.trim();
    if (!name || !url) {showToast('请填写名称和地址', 'warning'); return;}
    try {
        var resp = await fetch(API_BASE + '/api/sources/add', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name, url: url})
        });
        var data = await resp.json();
        if (data.success) {
            showToast('添加成功', 'success');
            nameEl.value = '';
            urlEl.value = '';
            var resultEl = document.getElementById('testResult');
            if (resultEl) resultEl.textContent = '';
            loadSources();
            setTimeout(function () {refreshApps();}, 500);
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {showToast('添加失败: ' + e.message, 'error');}
}

async function removeSource(sourceId) {
    if (!confirm('确定要删除该软件源吗？')) return;
    try {
        var resp = await fetch(API_BASE + '/api/sources/remove', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: sourceId})
        });
        var data = await resp.json();
        if (data.success) {
            showToast('删除成功', 'success');
            loadSources();
            setTimeout(function () {refreshApps();}, 500);
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {showToast('删除失败: ' + e.message, 'error');}
}

async function toggleSource(sourceId, enabled) {
    try {
        var resp = await fetch(API_BASE + '/api/sources/toggle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: sourceId, enabled: enabled})
        });
        var data = await resp.json();
        if (data.success) {
            showToast(data.message, 'success');
            loadSources();
            setTimeout(function () {refreshApps();}, 500);
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {showToast('操作失败: ' + e.message, 'error');}
}

async function testSourceUrl() {
    var urlEl = document.getElementById('newSourceUrl');
    var resultEl = document.getElementById('testResult');
    if (!urlEl || !resultEl) return;
    var url = urlEl.value.trim();
    if (!url) {resultEl.textContent = '请输入地址'; resultEl.style.color = '#b55a5a'; return;}
    resultEl.textContent = '测试中...';
    resultEl.style.color = 'var(--text-muted)';
    try {
        var resp = await fetch(API_BASE + '/api/sources/test', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url: url})
        });
        var data = await resp.json();
        if (data.success) {
            resultEl.textContent = data.message;
            resultEl.style.color = '#5a8a5a';
        } else {
            resultEl.textContent = data.message;
            resultEl.style.color = '#b55a5a';
        }
    } catch (e) {
        resultEl.textContent = '测试失败: ' + e.message;
        resultEl.style.color = '#b55a5a';
    }
}