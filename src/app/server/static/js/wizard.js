// ================================================================
// FN软仓 - 向导 + 手动安装 + 依赖缺失引导
// ================================================================

// ================================================================
// 向导
// ================================================================
function showWizardFromSession(sessionId, steps, title, appId) {
    currentWizardSessionId = sessionId;
    _wizardPendingAppID = appId || null;
    var modal = document.getElementById('wizardModal');
    if (!modal) return;
    var body = document.getElementById('wizardBody');
    var status = document.getElementById('wizardStatus');
    var titleEl = document.getElementById('wizardTitle');
    if (titleEl) titleEl.textContent = title || '安装向导';
    if (status) status.textContent = '请填写配置项';

    var htmlContent = '';
    if (steps && steps.length > 0) {
        var items = steps.flatMap(function (step) {return step.items || [];});
        if (items.length === 0) {
            htmlContent = '<p>无配置项，点击确认安装</p>';
        } else {
            items.forEach(function (item) {
                if (item.type === 'tips') {
                    htmlContent += '<div class="wizard-field"><div class="hint" style="margin-bottom:8px;">' + (item.helpText || item.label || item.initValue || '提示信息') + '</div></div>';
                    return;
                }
                var required = item.rules && item.rules.some(function (r) {return r.required;});
                htmlContent += '<div class="wizard-field"><label>' + (item.label || item.field) + (required ? ' <span class="required">*</span>' : '') + '</label>';
                if (item.type === 'text' || item.type === 'password') {
                    var inputType = item.type === 'password' ? 'password' : 'text';
                    htmlContent += '<input type="' + inputType + '" id="wizard_' + item.field + '" name="' + item.field + '" value="' + (item.initValue || '') + '"' + (required ? ' required' : '') + '>';
                } else if (item.type === 'radio' || item.type === 'select') {
                    htmlContent += '<select id="wizard_' + item.field + '" name="' + item.field + '">';
                    (item.options || []).forEach(function (opt) {
                        htmlContent += '<option value="' + opt.value + '"' + (opt.value === item.initValue ? ' selected' : '') + '>' + opt.label + '</option>';
                    });
                    htmlContent += '</select>';
                } else if (item.type === 'switch') {
                    var checked = item.initValue === 'true' || item.initValue === true;
                    htmlContent += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;"><input type="checkbox" id="wizard_' + item.field + '" name="' + item.field + '"' + (checked ? ' checked' : '') + '> <span>' + item.label + '</span></div>';
                } else {
                    htmlContent += '<input type="text" id="wizard_' + item.field + '" name="' + item.field + '" value="' + (item.initValue || '') + '">';
                }
                if (item.helpText && item.type !== 'tips') htmlContent += '<div class="hint">' + item.helpText + '</div>';
                htmlContent += '</div>';
            });
        }
    } else {
        htmlContent = '<p>无配置项，点击确认安装</p>';
    }
    if (body) body.innerHTML = htmlContent;
    var submitBtn = document.getElementById('wizardSubmitBtn');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '确认安装'; }
    modal.classList.add('active');
}

function closeWizard() {
    if (_wizardPollTimer) {
        clearInterval(_wizardPollTimer);
        _wizardPollTimer = null;
    }
    if (currentWizardSessionId) {
        fetch(API_BASE + '/api/wizard/cancel', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({session_id: currentWizardSessionId})
        }).catch(function () { });
        currentWizardSessionId = null;
    }
    _wizardPendingAppID = null;
    var modal = document.getElementById('wizardModal');
    if (modal) modal.classList.remove('active');
}

async function submitWizard() {
    var btn = document.getElementById('wizardSubmitBtn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '提交中...';
    var status = document.getElementById('wizardStatus');
    if (status) status.textContent = '提交中...';

    var inputs = {};
    document.querySelectorAll('#wizardBody input, #wizardBody select, #wizardBody textarea').forEach(function (el) {
        var name = el.name;
        if (!name) return;
        inputs[name] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
    });

    var sessionId = currentWizardSessionId;
    if (!sessionId) {
        if (status) status.textContent = '会话已过期';
        btn.disabled = false;
        btn.textContent = '确认安装';
        return;
    }

    try {
        var resp = await fetch(API_BASE + '/api/wizard/install', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({session_id: sessionId, inputs: inputs})
        });
        var result = await resp.json();

        if (result.success && result.async) {
            if (status) status.textContent = '安装中，请稍候...';
            btn.textContent = '安装中...';

            var cancelBtn = document.querySelector('#wizardModal .modal-btn:not(.modal-btn-primary)');
            if (cancelBtn) cancelBtn.disabled = true;

            var checkCount = 0;
            var maxChecks = 60;
            if (_wizardPollTimer) clearInterval(_wizardPollTimer);
            _wizardPollTimer = setInterval(function () {
                checkCount++;
                if (status) status.textContent = '安装中，请稍候... (' + (checkCount * 2) + 's)';

                fetch(API_BASE + '/api/wizard/status?session_id=' + encodeURIComponent(sessionId))
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        if (!d.success) return;

                        if (d.status === 'success') {
                            clearInterval(_wizardPollTimer);
                            _wizardPollTimer = null;
                            if (status) status.textContent = '安装成功';
                            showToast('安装成功', 'success');
                            isInstalling = false;
                            if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
                            closeWizard();
                            setTimeout(function () { refreshApps(); }, 500);
                            processInstallQueue();
                        } else if (d.status === 'failed') {
                            clearInterval(_wizardPollTimer);
                            _wizardPollTimer = null;
                            var errMsg = d.message || '未知错误';
                            if (status) status.textContent = '安装失败: ' + errMsg;
                            showToast('安装失败: ' + errMsg, 'error');
                            isInstalling = false;
                            if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
                            btn.disabled = false;
                            btn.textContent = '确认安装';
                            if (cancelBtn) cancelBtn.disabled = false;
                            processInstallQueue();
                        }
                    })
                    .catch(function () {});

                if (checkCount >= maxChecks) {
                    clearInterval(_wizardPollTimer);
                    _wizardPollTimer = null;
                    if (status) status.textContent = '安装超时，请刷新页面查看结果';
                    showToast('安装超时，请刷新页面查看', 'warning');
                    isInstalling = false;
                    if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
                    btn.disabled = false;
                    btn.textContent = '确认安装';
                    if (cancelBtn) cancelBtn.disabled = false;
                    setTimeout(function () { refreshApps(); }, 1000);
                    processInstallQueue();
                }
            }, 2000);
            return;
        }

        if (result.success) {
            if (status) status.textContent = '安装成功';
            showToast('安装成功', 'success');
            closeWizard();
            isInstalling = false;
            if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
            processInstallQueue();
            setTimeout(function () { refreshApps(); }, 2000);
        } else {
            if (status) status.textContent = result.message;
            btn.disabled = false;
            btn.textContent = '确认安装';
            isInstalling = false;
            if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
            processInstallQueue();
        }
    } catch (e) {
        if (status) status.textContent = e.message;
        btn.disabled = false;
        btn.textContent = '确认安装';
        isInstalling = false;
        if (installTimeoutTimer) { clearTimeout(installTimeoutTimer); installTimeoutTimer = null; }
        processInstallQueue();
    }
}

// ================================================================
// 手动安装
// ================================================================
function showManualInstall() {
    var modal = document.getElementById('manualInstallModal');
    if (!modal) return;

    var fileInput = document.getElementById('manualFpkFile');
    if (fileInput) fileInput.value = '';

    var progressWrap = document.getElementById('manualInstallProgressWrap');
    if (progressWrap) progressWrap.style.display = 'none';

    var bar = document.getElementById('manualInstallProgressBar');
    if (bar) bar.style.width = '0%';

    var text = document.getElementById('manualInstallProgressText');
    if (text) text.textContent = '';

    var status = document.getElementById('manualInstallStatus');
    if (status) { status.textContent = ''; status.style.color = ''; status.className = ''; }

    var log = document.getElementById('manualInstallLog');
    if (log) { log.textContent = ''; log.style.display = 'none'; }

    var btn = document.getElementById('manualInstallBtn');
    if (btn) { btn.disabled = false; btn.textContent = '开始安装'; }

    var sec = document.getElementById('manualSecondaryBtn');
    if (sec) { sec.textContent = '关闭'; sec.onclick = closeManualInstall; }

    modal.classList.add('active');
}

function closeManualInstall() {
    var modal = document.getElementById('manualInstallModal');
    if (modal) modal.classList.remove('active');
}

function doManualInstall() {
    var fileInput = document.getElementById('manualFpkFile');
    var file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
        if (typeof showToast === 'function') showToast('请先选择 FPK 文件', 'warning');
        return;
    }
    if (!file.name.toLowerCase().endsWith('.fpk')) {
        if (typeof showToast === 'function') showToast('文件必须是 .fpk', 'warning');
        return;
    }

    var btn = document.getElementById('manualInstallBtn');
    var status = document.getElementById('manualInstallStatus');
    var progressWrap = document.getElementById('manualInstallProgressWrap');
    var bar = document.getElementById('manualInstallProgressBar');
    var text = document.getElementById('manualInstallProgressText');
    var log = document.getElementById('manualInstallLog');
    var sec = document.getElementById('manualSecondaryBtn');

    btn.disabled = true;
    btn.textContent = '上传中...';
    if (progressWrap) progressWrap.style.display = 'block';
    if (status) { status.textContent = ''; status.style.color = ''; }
    if (log) { log.textContent = ''; log.style.display = 'none'; }

    var fd = new FormData();
    fd.append('fpk', file);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE + '/api/install-local');

    xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        var pct = Math.round(e.loaded / e.total * 100);
        if (bar) bar.style.width = pct + '%';
        if (text) {
            text.textContent = pct + '% · ' +
                (e.loaded / 1024 / 1024).toFixed(1) + ' / ' +
                (e.total / 1024 / 1024).toFixed(1) + ' MB';
        }
    };

    xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) {}

        // 带向导：关闭手动安装弹窗，打开向导弹窗
        if (xhr.status === 200 && data.success && data.wizard) {
            closeManualInstall();
            if (typeof showWizardFromSession === 'function') {
                showWizardFromSession(data.session_id, data.steps, data.title, data.app_id);
            } else if (typeof showToast === 'function') {
                showToast('此应用需要填写安装向导', 'info');
            }
            return;
        }

        if (xhr.status === 200 && data.success) {
            btn.textContent = '安装成功';
            btn.disabled = true;
            if (status) {
                status.textContent = data.message || '安装成功';
                status.style.color = '#4a8a4a';
            }
            if (text) text.textContent = '上传完成，安装完成';
            if (sec) sec.textContent = '关闭';
            if (typeof showToast === 'function') showToast('安装成功', 'success');
            setTimeout(function () {
                closeManualInstall();
                if (typeof refreshApps === 'function') refreshApps();
            }, 2000);
            return;
        }

        btn.disabled = false;
        btn.textContent = '重试';
        var msg = data.message || ('HTTP ' + xhr.status);
        if (status) {
            status.textContent = msg;
            status.style.color = '#b54a4a';
        }
        if (log && data.data) {
            log.style.display = 'block';
            var out = (data.data.stdout || '') + '\n' + (data.data.stderr || '');
            log.textContent = out.trim();
        }
        if (sec) sec.textContent = '关闭';
        if (typeof showToast === 'function') showToast(msg, 'error');
    };

    xhr.onerror = function () {
        btn.disabled = false;
        btn.textContent = '重试';
        if (status) {
            status.textContent = '网络错误';
            status.style.color = '#b54a4a';
        }
        if (typeof showToast === 'function') showToast('网络错误', 'error');
    };

    xhr.send(fd);
}

function manualSecondaryAction() {
    closeManualInstall();
}

// ================================================================
// 依赖缺失引导
// ================================================================
var _missingDepName = '';

function showMissingDepModal(depName) {
    _missingDepName = depName || '';
    var nameEl = document.getElementById('missingDepName');
    if (nameEl) nameEl.textContent = _missingDepName || '(未知依赖)';
    var modal = document.getElementById('missingDepModal');
    if (modal) modal.classList.add('active');
}

function closeMissingDepModal() {
    var modal = document.getElementById('missingDepModal');
    if (modal) modal.classList.remove('active');
}

async function openMissingDepInAppCenter() {
    var depName = _missingDepName;
    closeMissingDepModal();
    if (!depName) return;

    if (window.trimSdk && typeof window.trimSdk.openAppSetting === 'function') {
        try {
            await window.trimSdk.openAppSetting();
            setTimeout(function () {
                if (typeof showToast === 'function') {
                    showToast('请在应用中心搜索「' + depName + '」并安装', 'info');
                }
            }, 300);
            return;
        } catch (e) {
            console.warn('打开应用中心失败:', e);
        }
    }

    if (typeof showToast === 'function') {
        showToast('请手动打开飞牛应用中心，搜索「' + depName + '」并安装', 'warning');
    }
}

function copyMissingDepName() {
    if (!_missingDepName) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(_missingDepName).then(function () {
            if (typeof showToast === 'function') {
                showToast('已复制依赖名', 'success');
            }
        }).catch(function () {
            _fallbackCopy(_missingDepName);
        });
    } else {
        _fallbackCopy(_missingDepName);
    }
}

function _fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        if (typeof showToast === 'function') {
            showToast('已复制依赖名', 'success');
        }
    } catch (e) {}
    document.body.removeChild(ta);
}