// ================================================================
// FN软仓 - 向导 + 手动安装 + 依赖缺失引导
// ================================================================

// ================================================================
// 官方 API 向导弹窗（异步返回配置）
// ================================================================
var _officialWizardResolve = null;

function showOfficialWizard(appName, version, items, resolve) {
    _officialWizardResolve = resolve;
    var modal = document.getElementById('wizardModal');
    if (!modal) { resolve(null); return; }
    
    var body = document.getElementById('wizardBody');
    var titleEl = document.getElementById('wizardTitle');
    if (titleEl) titleEl.textContent = appName + ' - 安装向导';
    
    var htmlContent = '';
    var flatItems = [];
    
    if (Array.isArray(items)) {
        items.forEach(function(item) {
            if (item.items && Array.isArray(item.items)) {
                if (item.stepTitle) htmlContent += '<div class="wizard-field"><div class="hint step-title" style="font-weight:bold;margin-bottom:10px;">' + item.stepTitle + '</div></div>';
                flatItems.push(...item.items);
            } else {
                flatItems.push(item);
            }
        });
    }

    flatItems.forEach(function (item, index) {
        if (item.type === 'tips') {
            htmlContent += '<div class="wizard-field"><div class="hint">' + (item.helpText || item.label || '') + '</div></div>';
            return;
        }
        var key = item.field || item.key || item.name || ('wizard_' + index);
        var value = item.initValue ?? item.defaultValue ?? item.value ?? '';
        var required = Boolean(item.required || (item.rules || []).some(function(r) { return r.required; }));
        
        htmlContent += '<div class="wizard-field"><label>' + (item.label || key) + (required ? ' <span class="required">*</span>' : '') + '</label>';
        
        if (item.type === 'text' || item.type === 'password' || item.type === 'number') {
            htmlContent += '<input type="' + (item.type === 'password' ? 'password' : item.type === 'number' ? 'number' : 'text') + '" id="wizard_' + key + '" name="' + key + '" value="' + value + '"' + (required ? ' required' : '') + '>';
        } else if (item.type === 'radio' || item.type === 'select') {
            htmlContent += '<select id="wizard_' + key + '" name="' + key + '">';
            (item.options || []).forEach(function(opt) {
                var ov = typeof opt === 'string' ? opt : opt.value;
                var ol = typeof opt === 'string' ? opt : opt.label;
                htmlContent += '<option value="' + ov + '"' + (ov === value ? ' selected' : '') + '>' + ol + '</option>';
            });
            htmlContent += '</select>';
        } else if (item.type === 'switch' || item.type === 'checkbox') {
            var checked = value === 'true' || value === true ? ' checked' : '';
            htmlContent += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;"><input type="checkbox" id="wizard_' + key + '" name="' + key + '"' + checked + '> <span>' + (item.helpText || '') + '</span></div>';
        } else {
            htmlContent += '<input type="text" id="wizard_' + key + '" name="' + key + '" value="' + value + '"' + (required ? ' required' : '') + '>';
        }
        if (item.helpText && item.type !== 'tips' && item.type !== 'switch') {
            htmlContent += '<div class="hint">' + item.helpText + '</div>';
        }
        htmlContent += '</div>';
    });

    if (body) body.innerHTML = htmlContent || '<p>无配置项，点击确认开始安装</p>';
    
    var submitBtn = document.getElementById('wizardSubmitBtn');
    if (submitBtn) { 
        submitBtn.disabled = false; 
        submitBtn.textContent = '确认安装'; 
        submitBtn.onclick = function() { submitOfficialWizard(); };
    }
    
    var cancelBtn = document.querySelector('#wizardModal .modal-btn:not(.modal-btn-primary)');
    if (cancelBtn) {
        cancelBtn.onclick = function() { closeOfficialWizard(); };
    }

    modal.classList.add('active');
}

function submitOfficialWizard() {
    if (!_officialWizardResolve) return;
    var inputs = {};
    document.querySelectorAll('#wizardBody input, #wizardBody select, #wizardBody textarea').forEach(function(el) {
        if (!el.name) return;
        inputs[el.name] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
    });

    var modal = document.getElementById('wizardModal');
    if (modal) modal.classList.remove('active');
    
    _officialWizardResolve(inputs);
    _officialWizardResolve = null;
}

function closeOfficialWizard() {
    var modal = document.getElementById('wizardModal');
    if (modal) modal.classList.remove('active');
    if (_officialWizardResolve) {
        _officialWizardResolve(null);
        _officialWizardResolve = null;
    }
}

// ================================================================
// 手动安装（上传本地 FPK）
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

        // 注意：此处由于后端 API 修改，目前不再返回 wizard。如果后续需要支持，可再扩展。
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