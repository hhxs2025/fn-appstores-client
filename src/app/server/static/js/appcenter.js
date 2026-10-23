// ================================================================
// FN软仓 - 飞牛官方应用中心底层 API 封装 (App Center API)
// ================================================================

const AC_BASE = '/app-center/v1';

function acData(result) {
    return result && typeof result === 'object' && result.data != null ? result.data : result;
}

function extractTaskId(result) {
    const data = acData(result);
    const cands = [];
    if (data && typeof data === 'object') {
        cands.push(data.installTaskId, data.taskId, data.id, data.downloadTaskId, data.uninstallTaskId);
    }
    cands.push(result.installTaskId, result.taskId, result.id, result.downloadTaskId, result.uninstallTaskId);
    for (const c of cands) {
        if (c !== undefined && c !== null && String(c) !== '') return String(c);
    }
    return '';
}

function acMessage(result, data) {
    return String(
        (data && (data.outputText || data.message || data.msg)) ||
        (result && result.data && (result.data.outputText || result.data.message || result.data.msg)) ||
        (result && (result.outputText || result.message || result.msg)) ||
        ''
    );
}

function acCode(result) {
    if (result && typeof result === 'object') {
        const c = result.code || (result.data && result.data.code) || 0;
        return Number(c) || 0;
    }
    return 0;
}

async function appCenterFetch(path, options = {}) {
    const url = `${AC_BASE}/${path}`;
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : {},
        cache: 'no-store',
        credentials: 'include',
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    
    if (!response.ok) {
        let msg = `app-center HTTP ${response.status}`;
        try {
            const body = await response.json();
            msg = acMessage(body) || body.message || msg;
        } catch (_) {}
        throw new Error(msg);
    }
    return response.json();
}

function acThrowIfError(result) {
    const code = acCode(result);
    if (code && !(result && result.data)) {
        const err = new Error(acMessage(result) || `app-center code ${code}`);
        err.code = code;
        throw err;
    }
    return result;
}

const ERR_CODE_I18N_MAP = {
    10100: "任务尚未就绪",
    10236: "应用已安装",
    10300: "找不到应用",
    10370: "没有可用的更新",
    10371: "该应用不允许本地更新",
    10372: "应用更新异常",
    10375: "应用正在更新中，请稍候",
    10390: "该应用不允许卸载",
};

function errCodeMessage(code) {
    return ERR_CODE_I18N_MAP[Number(code) || 0] || "";
}

let _installedAppsCache = null;
async function acGetInstalledApps(force = false) {
    if (!force && _installedAppsCache) return _installedAppsCache;
    try {
        const result = await appCenterFetch(`app/installed?language=zh-CN`);
        const data = acData(result);
        let apps = [];
        if (Array.isArray(data)) apps = data;
        else if (data && typeof data === 'object') {
            for (const key of ['list', 'apps', 'items']) {
                if (Array.isArray(data[key])) { apps = data[key]; break; }
            }
        }
        _installedAppsCache = apps;
        return apps;
    } catch (_e) {
        return [];
    }
}

function clearInstalledAppsCache() {
    _installedAppsCache = null;
}

function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    v1 = String(v1).replace(/^v/, '');
    v2 = String(v2).replace(/^v/, '');
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const a = parts1[i] || 0;
        const b = parts2[i] || 0;
        if (a > b) return 1;
        if (a < b) return -1;
    }
    return 0;
}

async function runOfficialInstallFlow(appId, fpkPath, options = {}) {
    const { onProgress, onWizard, baseProgress = 40, maxProgress = 100 } = options;
    const lang = 'zh-CN';

    onProgress({ msg: "正在解析安装包...", progress: baseProgress, stage: 'install' });
    const dlResult = await appCenterFetch(`download/task`, {
        method: 'POST',
        body: { packageSourceType: 'file', path: fpkPath }
    });
    const dlTaskId = extractTaskId(dlResult);
    
    let downloadInfo = null;
    let parseProgress = baseProgress;
    while (true) {
        await new Promise(r => setTimeout(r, 1000));
        const statusResult = await appCenterFetch(`download/status?downloadTaskId=${dlTaskId}&language=${lang}`);
        const statusData = acData(statusResult);
        const st = statusData.status;
        
        if (st === 2) { 
            downloadInfo = statusData;
            break;
        } else if (st === 3) { 
            throw new Error(acMessage(statusResult) || '解析失败');
        }
        
        if (statusData.progress) {
            let mapped = baseProgress + (statusData.progress / 100) * 20;
            if (mapped > parseProgress) {
                parseProgress = mapped;
                onProgress({ msg: "正在解析...", progress: parseProgress, stage: 'install' });
            }
        }
    }

    const appName = downloadInfo.appName;
    const version = downloadInfo.version;
    const packageType = downloadInfo.packageType || 'file';
    const installedInfo = downloadInfo.installedInfo;

    let isUpdate = false;
    let isOverwrite = false;
    if (installedInfo) {
        const cmp = compareVersions(version, installedInfo.version);
        if (cmp > 0) isUpdate = true;
        else isOverwrite = true;
    }

    onProgress({ msg: "检查安装环境...", progress: 60, stage: 'install' });
    let installInfoData = null;
    try {
        let infoUrl = `install/info?appName=${appName}&version=${version}&packageType=${packageType}&language=${lang}`;
        if (isUpdate) {
            infoUrl = `update/info?appName=${appName}&packageType=${packageType}&updateVersion=${version}&language=${lang}`;
        }
        const infoResult = await appCenterFetch(infoUrl);
        installInfoData = acData(infoResult);
    } catch (e) {
        if (acCode(e) !== 10236) {
            throw e; 
        }
    }

    let wizardData = null;
    const wizardInfo = installInfoData && (installInfoData.wizardInfo || installInfoData);
    const hasWizard = wizardInfo && (
        wizardInfo.hasWizard || 
        (Array.isArray(wizardInfo.wizardContent) && wizardInfo.wizardContent.length > 0) ||
        (Array.isArray(wizardInfo.steps) && wizardInfo.steps.length > 0)
    );

    if (hasWizard && !isUpdate && !isOverwrite) {
        const items = wizardInfo.wizardContent || wizardInfo.steps || [];
        wizardData = await onWizard(appName, version, items);
        if (!wizardData) {
            throw new Error('USER_CANCELLED');
        }
    }

    onProgress({ msg: isUpdate ? "正在更新..." : "正在安装...", progress: 60, stage: 'install' });
    const systemParameters = {
        agreedToProtocol: true,
        installVolumeID: installInfoData?.volumeID || 1,
        dataVolumeId: 1,
        immediateStart: true
    };

    let installResult;
    const makeCustom = () => {
        if (wizardData && Object.keys(wizardData).length > 0) {
            return Object.entries(wizardData).map(([k, v]) => ({ key: k, value: String(v) }));
        }
        return undefined;
    };

    if (isUpdate) {
        const payload = { appName, packageType, updateVersion: version, systemParameters, customParameters: makeCustom() };
        try {
            installResult = acThrowIfError(await appCenterFetch('update/task', { method: 'POST', body: payload }));
        } catch (e) {
            const instPayload = { appName, version, packageType, upgrade: true, systemParameters, customParameters: makeCustom() };
            installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: instPayload }));
        }
    } else {
        const payload = { appName, version, packageType, upgrade: false, systemParameters, customParameters: makeCustom() };
        try {
            installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: payload }));
        } catch (e) {
            if (acCode(e) === 10236) {
                const updatePayload = { appName, packageType, updateVersion: version, systemParameters, customParameters: makeCustom() };
                installResult = acThrowIfError(await appCenterFetch('update/task', { method: 'POST', body: updatePayload }));
                isUpdate = true;
            } else {
                throw e;
            }
        }
    }

    const installTaskId = extractTaskId(installResult);

    let currentProgress = 60;
    const fakeTimer = setInterval(() => {
        if (currentProgress < 98) {
            let step = (98 - currentProgress) * 0.05;
            if (step < 0.1) step = 0.1;
            currentProgress += step;
            onProgress({ 
                msg: isUpdate ? "正在更新系统组件..." : "正在安装系统组件...", 
                progress: currentProgress,
                stage: 'install'
            });
        }
    }, 300);

    try {
        while (true) {
            await new Promise(r => setTimeout(r, 1500));
            let statusResult;
            if (isUpdate) {
                statusResult = await appCenterFetch('update/status', { method: 'POST', body: { taskId: installTaskId, language: lang } });
            } else {
                statusResult = await appCenterFetch('install/status', { method: 'POST', body: { taskId: installTaskId, language: lang } });
            }
            
            const statusData = acData(statusResult);
            const st = statusData.status;
            
            if (st === 2) {
                clearInterval(fakeTimer);
                clearInstalledAppsCache();
                onProgress({ msg: isUpdate ? "更新成功" : "安装成功", progress: maxProgress, done: true, stage: 'install' });
                return true;
            } else if (st === 3) {
                clearInterval(fakeTimer);
                const fullErr = acMessage(statusResult) || JSON.stringify(statusResult) || '安装失败，请查看系统日志';
                throw new Error(fullErr);
            }
            
            if (statusData.progress) {
                let mappedReal = 60 + ((statusData.progress || 0) / 100) * 38;
                if (mappedReal > currentProgress) {
                    currentProgress = mappedReal;
                }
            }
        }
    } catch (err) {
        clearInterval(fakeTimer);
        throw err;
    }
}

async function runOfficialUninstallFlow(appId, options = {}) {
    const { onProgress } = options;
    const lang = 'zh-CN';
    
    onProgress({ msg: "正在停止应用并准备卸载...", progress: 5, stage: 'install' });
    
    const res = await appCenterFetch('uninstall/task', {
        method: 'POST',
        body: {
            appName: appId,
            systemParameters: { agreedToProtocol: true, deleteData: false }
        }
    });
    
    const taskId = extractTaskId(res);
    if (!taskId) throw new Error('无法获取卸载任务 ID');
    
    while (true) {
        await new Promise(r => setTimeout(r, 1500));
        const statusRes = await appCenterFetch('uninstall/status', {
            method: 'POST',
            body: { taskId: taskId, language: lang }
        });
        
        const statusData = acData(statusRes);
        const st = statusData.status;
        
        if (st === 2) {
            clearInstalledAppsCache();
            onProgress({ msg: "卸载成功", progress: 100, done: true, stage: 'install' });
            return true;
        } else if (st === 3) {
            throw new Error(acMessage(statusRes) || '卸载失败');
        }
        
        let mapped = 5 + ((statusData.progress || 0) / 100) * 95;
        onProgress({ msg: "正在卸载...", progress: mapped, stage: 'install' });
    }
}