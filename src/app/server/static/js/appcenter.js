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
        let code = 0;
        try {
            const body = await response.json();
            msg = acMessage(body) || body.message || msg;
            // ★ 修复：HTTP 非 200 时也要提取业务错误码，
            //   否则下方 acCode(e) 拿到 0，10236 等业务码会被当成未知错误误判
            code = Number((body && body.code) || (body && body.data && body.data.code)) || 0;
        } catch (_) {}
        const err = new Error(msg);
        if (code) err.code = code;
        throw err;
    }
    return response.json();
}

function acThrowIfError(result) {
    const code = acCode(result);
    if (code && !(result && result.data)) {
        // ★ 优化：优先使用官方错误码文案，避免裸露 "app-center code xxxx"
        const err = new Error(acMessage(result) || errCodeMessage(code) || `app-center code ${code}`);
        err.code = code;
        throw err;
    }
    return result;
}

const ERR_CODE_I18N_MAP = {
    10100: "任务尚未就绪",
    10236: "应用已是最新版本，无需重复安装",
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
    _installedMapCache = null;
}

// ★ 关键：已安装版本的权威来源。
//   飞牛的版本记录在 trim 内部数据库里（不是 manifest 文件，也不保证 app-center 的
//   app/installed 接口实时同步）。本地后端 /api/installed 走的是
//   appcenter-cli list --refresh → 飞牛内部数据库，读不到才回退 manifest，
//   这里优先取它，失败才退回 app-center 接口。
let _installedMapCache = null;
async function getInstalledVersionMap(force = false) {
    if (!force && _installedMapCache) return _installedMapCache;
    const base = (typeof API_BASE !== 'undefined' ? API_BASE : '');
    try {
        const url = base + '/api/installed' + (force ? '?refresh=1' : '');
        const resp = await fetch(url, { cache: 'no-store', credentials: 'include' });
        if (resp.ok) {
            const body = await resp.json();
            const list = (body && (body.apps || (body.data && body.data.apps))) || [];
            if (Array.isArray(list) && list.length) {
                const map = {};
                for (const a of list) {
                    const id = a.id || a.appName || a.name;
                    if (id) map[id] = a.version || '';
                }
                _installedMapCache = map;
                return map;
            }
        }
    } catch (_e) { /* 回退 app-center */ }

    const map = {};
    const apps = await acGetInstalledApps(true);
    for (const a of (apps || [])) {
        const id = a.appName || a.name || a.app_name;
        if (id) map[id] = a.version || a.installedVersion || '';
    }
    _installedMapCache = map;
    return map;
}

// 安装/更新完成后回查系统里的真实版本。
// 服务端任务返回成功并不代表应用真的换成了目标版本（同名版本被系统跳过、
// 装到了别的卷、任务被内部回滚）。这里以飞牛的已装版本记录为准做校验。
async function verifyInstalledVersion(appID, expectVersion, budgetMs = 10000) {
    const deadline = Date.now() + budgetMs;
    let actual = '';
    const key = String(appID || '');
    while (true) {
        clearInstalledAppsCache();
        const map = await getInstalledVersionMap(true);
        actual = map[key] || map[key.toLowerCase()] || '';
        if (!actual) {
            // 大小写不敏感兜底
            for (const k of Object.keys(map)) {
                if (k.toLowerCase() === key.toLowerCase()) { actual = map[k]; break; }
            }
        }
        if (!expectVersion) return { ok: true, actual };
        if (actual && compareVersions(actual, expectVersion) >= 0) return { ok: true, actual };
        if (Date.now() >= deadline) return { ok: false, actual };
        await new Promise(r => setTimeout(r, 1000));
    }
}

// 版本号比较 —— 必须与后端 utils.go 的 CompareVersions 完全一致。
// 飞牛的版本号形如 3.12.4-11（upstream-build），只按 "." 切会把 "4-11" 变成 NaN，
// 导致 3.12.4-11 被判成低于 3.12.4，进而永久显示"可更新"。
// 规则：按 . - _ 空白 切段，每段取第一串数字；缺位补 0。
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const parse = (s) => String(s)
        .trim()
        .replace(/^[vV]/, '')
        .split(/[.\-_\s]+/)
        .map(seg => {
            const m = String(seg).match(/\d+/);
            return m ? parseInt(m[0], 10) : 0;
        });
    const p1 = parse(v1);
    const p2 = parse(v2);
    const n = Math.max(p1.length, p2.length);
    for (let i = 0; i < n; i++) {
        const a = i < p1.length ? p1[i] : 0;
        const b = i < p2.length ? p2[i] : 0;
        if (a > b) return 1;
        if (a < b) return -1;
    }
    return 0;
}

async function runOfficialInstallFlow(appId, fpkPath, options = {}) {
    const { onProgress, onWizard, baseProgress = 40, maxProgress = 100, expectVersion } = options;
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

    // ★ 新增：安装包实际版本必须达到商店展示的目标版本。
    //   若源站下发的 fpk 还是旧包，安装会"成功"但版本不变 —— 提前拦下并说清原因。
    if (expectVersion && version && compareVersions(version, expectVersion) < 0) {
        throw new Error(`下载到的安装包版本为 ${version}，低于目标版本 ${expectVersion}。`
            + `该软件源下发的安装包可能尚未更新，请稍后重试或联系源站管理员。`);
    }

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

    let installResult = null;
    let alreadyLatest = false;
    const makeCustom = () => {
        if (wizardData && Object.keys(wizardData).length > 0) {
            return Object.entries(wizardData).map(([k, v]) => ({ key: k, value: String(v) }));
        }
        return undefined;
    };

    if (isUpdate) {
        const payload = { appName, packageType, updateVersion: version, systemParameters, customParameters: makeCustom() };
        let updateErr = null;
        try {
            installResult = acThrowIfError(await appCenterFetch('update/task', { method: 'POST', body: payload }));
        } catch (e) {
            updateErr = e;
        }
        if (!installResult && updateErr) {
            // ★ 修复：更新任务失败后兜底走覆盖安装。若安装接口返回 10236（该版本已安装），
            //   说明目标版本其实已经在系统中 —— 此前会把 "app-center code 10236" 直接抛给用户，
            //   导致「应用已安装」的误导性报错且更新流程永远走不完。
            try {
                const instPayload = { appName, version, packageType, upgrade: true, systemParameters, customParameters: makeCustom() };
                installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: instPayload }));
            } catch (instErr) {
                const instCode = acCode(instErr);
                if (instCode === 10236) {
                    // ★ 关键修复：「应用已安装」≠「已是最新」。
                    //   isUpdate 分支进来时，目标版本本来就高于已装版本；
                    //   此时兜底安装还回 10236，只能说明 update/task 根本没下发成功。
                    //   以前把它当 alreadyLatest，最后报「版本仍是旧版」，把真实原因藏掉了。
                    const curVer = (installedInfo && installedInfo.version) || '';
                    const needUpgrade = !curVer || compareVersions(version, curVer) > 0;
                    if (needUpgrade) {
                        const upCode = acCode(updateErr);
                        const detail = errCodeMessage(upCode) || (updateErr && updateErr.message) || '应用中心未接受更新任务';
                        const codeText = upCode ? `（错误码 ${upCode}）` : '';
                        throw new Error(`更新任务未能下发：${detail}${codeText}。`
                            + `系统当前版本 ${curVer || '未知'}，目标版本 ${version}。`);
                    }
                    alreadyLatest = true;
                } else {
                    // 优先暴露真正的更新失败原因，而不是兜底安装的误导性错误
                    const upCode = acCode(updateErr);
                    throw new Error(errCodeMessage(upCode)
                        || (updateErr && updateErr.message)
                        || errCodeMessage(instCode)
                        || '更新失败，请查看系统日志');
                }
            }
        }
    } else {
        const payload = { appName, version, packageType, upgrade: false, systemParameters, customParameters: makeCustom() };
        try {
            installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: payload }));
        } catch (e) {
            if (acCode(e) === 10236) {
                if (installedInfo && compareVersions(version, installedInfo.version) <= 0) {
                    // 已安装且目标版本不高于已装版本 → 无需任何操作
                    alreadyLatest = true;
                } else {
                    const updatePayload = { appName, packageType, updateVersion: version, systemParameters, customParameters: makeCustom() };
                    try {
                        installResult = acThrowIfError(await appCenterFetch('update/task', { method: 'POST', body: updatePayload }));
                        isUpdate = true;
                    } catch (e2) {
                        if (acCode(e2) === 10236 || acCode(e2) === 10370) {
                            alreadyLatest = true;
                        } else {
                            throw e2;
                        }
                    }
                }
            } else {
                throw e;
            }
        }
    }

    // ★ 目标版本已在系统中：先回查真实版本，确认真的到位才按成功收尾
    if (alreadyLatest) {
        const verify = await verifyInstalledVersion(appName, version, 8000);
        if (verify.ok) {
            clearInstalledAppsCache();
            onProgress({ msg: "应用已是最新版本", progress: maxProgress, done: true, stage: 'install' });
            return true;
        }
        throw new Error(`应用中心认为该版本已安装，但系统实际版本为 ${verify.actual || '未知'}（目标 ${version}），两者不一致。`
            + `请到飞牛应用中心查看该应用状态，必要时先在应用中心完成一次更新。`);
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
                // ★ 任务完成 ≠ 版本已换。回查已安装列表，版本没变就如实报错，
                //   不再出现「提示更新成功，重开客户端仍显示可更新」。
                onProgress({ msg: "正在校验安装结果...", progress: 99, stage: 'install' });
                const verify = await verifyInstalledVersion(appName, version, 8000);
                if (!verify.ok) {
                    throw new Error(`安装任务已完成，但系统中该应用版本仍为 ${verify.actual || '未知'}（目标 ${version}）。`
                        + `可能是安装包被系统拒绝、安装到了其它存储卷，或应用中心仍在后台收尾。请到飞牛应用中心查看该应用的版本与更新状态。`);
                }
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