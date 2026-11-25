// ================================================================
// FN软仓 - 飞牛官方应用中心底层 API 封装 (App Center API)
// ★ v2.11.1 变更：
//   1. 安装卷不再硬编码 vol1，自动探测可用存储空间（修复 ARM 机顶盒/
//      多存储空间用户安装失败）；
//   2. 遇到 10236"已安装"/10370"没有可用的更新"时，自动识别幽灵安装
//      记录：先卸载（保留 @appdata 用户数据）再全新安装，修复
//      "提示已安装但实际未安装成功"的更新失败问题。
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

// ★ v2.11.2：wizard 字段本地缓存。首次/重装弹向导填写后按 appName 存一份，
// 覆盖安装时若 install/info 因"已安装"拿不到 wizardInfo，用它兜底，避免
// install/task 报 "wizard required field xxx not found"。仅存向导里用户填的
// 配置值（端口、管理员密码等），不含安装包本身，体积可忽略。
const WIZARD_CACHE_KEY = 'fnsoft_wizard_fields';
function saveWizardFields(appName, data) {
    try {
        let all = {};
        try { all = JSON.parse(localStorage.getItem(WIZARD_CACHE_KEY) || '{}') || {}; } catch (_) {}
        all[appName] = data;
        localStorage.setItem(WIZARD_CACHE_KEY, JSON.stringify(all));
    } catch (_) {}
}
function loadWizardFields(appName) {
    try {
        const all = JSON.parse(localStorage.getItem(WIZARD_CACHE_KEY) || '{}') || {};
        return all[appName] || null;
    } catch (_) {
        return null;
    }
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

// ================================================================
// ★ v2.11.1 新增：解析可用的安装卷
// 优先级：install/info 或 update/info 返回的 volumeID >
//         本客户端后端探测到的存储空间列表 > 兜底 1
// ================================================================
let _volumesCache = null;
async function fetchAvailableVolumes() {
    if (_volumesCache) return _volumesCache;
    try {
        const resp = await fetch(API_BASE + '/api/volumes', { cache: 'no-store' });
        const data = await resp.json();
        if (data.success && Array.isArray(data.volumes) && data.volumes.length > 0) {
            _volumesCache = {
                volumes: data.volumes.map(Number),
                defaultVolume: Number(data.default_volume) || data.volumes.map(Number)[0]
            };
            return _volumesCache;
        }
    } catch (e) {
        console.warn('[volume] 获取存储空间列表失败:', e);
    }
    _volumesCache = { volumes: [1], defaultVolume: 1 };
    return _volumesCache;
}

// ★ v2.11.2 修正：飞牛 app/installed 返回的字段名是 installedVolumeID，
// update 时优先装回原卷，避免跨卷更新导致体积翻倍或直接失败。
async function resolveInstallVolume(installInfoData, appName, isUpdate) {
    const info = installInfoData || {};
    const infoVol = Number(info.volumeID || info.volumeId || info.installedVolumeID) || 0;

    // 1) 更新：装回原来的卷（最安全，飞牛的更新是按卷比对的）
    if (isUpdate && appName) {
        try {
            const installed = await acGetInstalledApps(true);
            const rec = (installed || []).find(function (a) {
                return (a.appName || a.name || a.id) === appName;
            });
            const v = Number(rec && (rec.installedVolumeID || rec.volumeID || rec.volumeId)) || 0;
            if (v > 0) return v;
        } catch (e) {
            /* 拿不到就继续往下兜底 */
        }
    }

    // 2) install/info、update/info 里带卷信息就直接用
    if (infoVol > 0) return infoVol;

    // 3) 本机探测（ARM 无存储空间 1 / 多盘场景）
    const volInfo = await fetchAvailableVolumes();
    if (volInfo.volumes.indexOf(volInfo.defaultVolume) !== -1) return volInfo.defaultVolume;
    return volInfo.volumes[0] || 1;
}

// ================================================================
// ★ v2.11.1 新增：幽灵安装记录修复
// 场景：飞牛数据库里存在该应用的安装记录（上次安装失败/文件丢失等残留），
// 但实际文件并不完整。此时 install/task 报 10236"已安装"、update/task 报
// 10370"没有可用的更新"，怎么装都装不上。
// 处理：先走官方卸载（deleteData:false，@appdata 用户数据保留），卸载完成
// 后再发起全新安装。
// ================================================================
async function uninstallWithProgress(appName, onProgress) {
    onProgress && onProgress({ msg: "检测到异常安装记录，正在清理（用户数据保留）...", progress: 60, stage: 'install' });
    const res = await appCenterFetch('uninstall/task', {
        method: 'POST',
        body: {
            appName: appName,
            systemParameters: { agreedToProtocol: true, deleteData: false }
        }
    });
    const taskId = extractTaskId(res);
    if (!taskId) throw new Error('无法获取卸载任务 ID');

    const deadline = Date.now() + 120 * 1000;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        const statusRes = await appCenterFetch('uninstall/status', {
            method: 'POST',
            body: { taskId: taskId, language: 'zh-CN' }
        });
        const statusData = acData(statusRes);
        const st = statusData.status;
        if (st === 2) {
            clearInstalledAppsCache();
            onProgress && onProgress({ msg: "异常记录清理完成，重新安装中...", progress: 62, stage: 'install' });
            return true;
        }
        if (st === 3) {
            throw new Error(acMessage(statusRes) || '清理异常安装记录失败');
        }
    }
    throw new Error('清理异常安装记录超时，请到飞牛应用中心手动卸载后重试');
}

async function runOfficialInstallFlow(appId, fpkPath, options = {}) {
    const { onProgress, onWizard, baseProgress = 40, maxProgress = 100, isDocker = false } = options;
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

    // ★ v2.11.2 修复：覆盖安装（同版本重装，isOverwrite=true）也必须带上 wizard 字段。
    // 旧逻辑只在"全新安装"时弹向导，重装时跳过 → customParameters 为空 → 飞牛 install/task
    // 报 "wizard required field xxx not found"（如无忧客服通的 wizard_admin_password）。
    // 典型触发链：首次装大镜像卡在 98% → 用户关闭客户端 → 重开后再装 → 系统判定已安装 →
    // 走覆盖安装 → 旧逻辑跳过向导 → 报错。
    // 双保险：
    //   1) 能拿到 wizardInfo 时，覆盖安装也弹向导重新收集（去掉旧的 !isOverwrite）；
    //   2) 覆盖安装时 install/info 可能因"已安装"返回 10236 而拿不到 wizardInfo，此时
    //      向导弹不出，改为复用首次安装时缓存的 wizard 字段（见 saveWizardFields/loadWizardFields）。
    // isUpdate 保持不弹（更新沿用飞牛系统侧旧配置，弹了反而多余）。
    if (hasWizard && !isUpdate) {
        const items = wizardInfo.wizardContent || wizardInfo.steps || [];
        wizardData = await onWizard(appName, version, items);
        if (!wizardData) {
            throw new Error('USER_CANCELLED');
        }
        // 首次/重装弹向导填写后缓存，供后续 install/info 拿不到配置时兜底
        saveWizardFields(appName, wizardData);
    } else if (isOverwrite && !isUpdate) {
        const cached = loadWizardFields(appName);
        if (cached && Object.keys(cached).length > 0) {
            wizardData = cached;
        }
    }

    onProgress({ msg: isUpdate ? "正在更新..." : "正在安装...", progress: 60, stage: 'install' });

    // ★ v2.11.1：安装卷动态解析，不再硬编码 vol1
    const volumeID = await resolveInstallVolume(installInfoData, appName, isUpdate);
    const systemParameters = {
        agreedToProtocol: true,
        installVolumeID: volumeID,
        dataVolumeId: volumeID,
        immediateStart: true
    };

    let installResult;
    const makeCustom = () => {
        if (wizardData && Object.keys(wizardData).length > 0) {
            return Object.entries(wizardData).map(([k, v]) => ({ key: k, value: String(v) }));
        }
        return undefined;
    };

    // ★ v2.11.1：幽灵记录判定 —— 10236(已安装)/10370(没有可用的更新) 且实际
    // 安装并未成功时，卸载后重装
    const isGhostRecordErr = (e) => {
        const code = acCode(e);
        if (code === 10236 || code === 10370) return true;
        const msg = (e && e.message) || '';
        return msg.indexOf('已安装') !== -1 && msg.indexOf('更新失败') === -1 &&
            (msg.indexOf('10236') !== -1 || msg.indexOf('10370') !== -1);
    };

    if (isUpdate) {
        const payload = { appName, packageType, updateVersion: version, systemParameters, customParameters: makeCustom() };
        try {
            installResult = acThrowIfError(await appCenterFetch('update/task', { method: 'POST', body: payload }));
        } catch (e) {
            if (isGhostRecordErr(e)) {
                // 更新接口认为"没有可用更新/已安装"，但用户明确要更新 → 幽灵记录处理
                await uninstallWithProgress(appName, onProgress);
                const instPayload = { appName, version, packageType, upgrade: false, systemParameters, customParameters: makeCustom() };
                installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: instPayload }));
                isUpdate = false;
            } else {
                const instPayload = { appName, version, packageType, upgrade: true, systemParameters, customParameters: makeCustom() };
                try {
                    installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: instPayload }));
                } catch (e2) {
                    if (isGhostRecordErr(e2)) {
                        await uninstallWithProgress(appName, onProgress);
                        const freshPayload = { appName, version, packageType, upgrade: false, systemParameters, customParameters: makeCustom() };
                        installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: freshPayload }));
                        isUpdate = false;
                    } else {
                        throw e2;
                    }
                }
            }
        }
    } else {
        const payload = { appName, version, packageType, upgrade: false, systemParameters, customParameters: makeCustom() };
        try {
            installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: payload }));
        } catch (e) {
            if (acCode(e) === 10236) {
                const updatePayload = { appName, packageType, updateVersion: version, systemParameters, customParameters: makeCustom() };
                try {
                    installResult = acThrowIfError(await appCenterFetch('update/task', { method: 'POST', body: updatePayload }));
                    isUpdate = true;
                } catch (e3) {
                    if (isGhostRecordErr(e3)) {
                        await uninstallWithProgress(appName, onProgress);
                        const freshPayload = { appName, version, packageType, upgrade: false, systemParameters, customParameters: makeCustom() };
                        installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: freshPayload }));
                        isUpdate = false;
                    } else {
                        throw e3;
                    }
                }
            } else if (isGhostRecordErr(e)) {
                await uninstallWithProgress(appName, onProgress);
                installResult = acThrowIfError(await appCenterFetch('install/task', { method: 'POST', body: payload }));
            } else {
                throw e;
            }
        }
    }

    const installTaskId = extractTaskId(installResult);

    let currentProgress = 60;
    const installStartAt = Date.now();

    // ★ 安装耗时提示（v2.11.2）：飞牛底层在部署阶段 install/status 可能长时间停留在
    // 中间态（无进度推进），旧文案固定且进度爬到 98% 即停，弹窗看起来像"卡死"，
    // 容易被误判为失败而手动干预导致真正失败。改为按等待时长切换分阶段文案 + 已用时。
    // 文案按应用类型分流：Docker 应用提"镜像/容器"，native 应用只用中性的"组件/环境"，
    // 避免给非容器应用显示错误的"拉取镜像"提示。类型由调用方 apps.js 依据 app.type/tags 判定后传入。
    const DOCKER_STAGES = [
        { at: 20,  msg: isUpdate ? "正在拉取镜像并重建容器（可能需要几分钟），请勿关闭页面..." : "正在拉取 Docker 镜像、创建容器（首次安装较慢），请勿关闭页面..." },
        { at: 60,  msg: isUpdate ? "正在重建容器并恢复数据，首次更新耗时较长，请耐心等待..." : "正在初始化容器与应用环境，首次启动耗时较长，请耐心等待..." },
        { at: 150, msg: "镜像拉取/容器构建耗时超出预期，仍在继续；请勿重复点击或离开页面，可留意系统日志..." }
    ];
    const NATIVE_STAGES = [
        { at: 20,  msg: isUpdate ? "正在安装系统组件（可能需要几分钟），请勿关闭页面..." : "正在解压并安装应用组件（首次安装较慢），请勿关闭页面..." },
        { at: 60,  msg: isUpdate ? "正在写入更新并恢复数据，耗时较长，请耐心等待..." : "正在初始化应用环境与配置，首次启动耗时较长，请耐心等待..." },
        { at: 150, msg: "应用部署耗时超出预期，仍在继续；请勿重复点击或离开页面，可留意系统日志..." }
    ];
    const INSTALL_STAGES = isDocker ? DOCKER_STAGES : NATIVE_STAGES;
    const stageMsg = (elapsedSec) => {
        let msg = isUpdate ? "正在更新系统组件..." : "正在安装系统组件...";
        for (let i = 0; i < INSTALL_STAGES.length; i++) {
            if (elapsedSec >= INSTALL_STAGES[i].at && INSTALL_STAGES[i].msg) msg = INSTALL_STAGES[i].msg;
        }
        return msg;
    };
    const fmtElapsed = (sec) => {
        if (sec < 60) return sec + ' 秒';
        var m = Math.floor(sec / 60), s = sec % 60;
        return m + ' 分 ' + (s < 10 ? '0' + s : s) + ' 秒';
    };
    const fakeTimer = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - installStartAt) / 1000);
        if (currentProgress < 98) {
            let step = (98 - currentProgress) * 0.05;
            if (step < 0.1) step = 0.1;
            currentProgress += step;
        }
        onProgress({
            msg: stageMsg(elapsedSec) + '（已用时 ' + fmtElapsed(elapsedSec) + '）',
            progress: currentProgress,
            stage: 'install',
            elapsed_sec: elapsedSec
        });
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
