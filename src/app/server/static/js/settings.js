// ================================================================
// FN软仓 - 设置（客户端自更新）
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