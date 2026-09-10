# ====================加载 vendor 依赖==============================
import sys
import os

# 判断运行环境
if getattr(sys, 'frozen', False):
    base_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))

# 加载 vendor
vendor_path = os.path.join(base_dir, 'vendor')
if os.path.exists(vendor_path):
    sys.path.insert(0, vendor_path)
else:
    print(f"⚠️ vendor 目录不存在: {vendor_path}")

# ======================第三方库导入=============================
import json
import subprocess
import tempfile
import requests
import threading
import time
import uuid
import re
import tarfile
import shutil
import glob
from datetime import datetime
from collections import defaultdict
from flask import Flask, render_template, jsonify, request, Response
from flask_cors import CORS
from flask_sock import Sock

flask_app = Flask(
    __name__,
    template_folder=os.path.join(base_dir, 'templates')
)
CORS(flask_app)
sock = Sock(flask_app)

# ========== 配置 ==========
PORT = 5660

# ✅ 使用 TRIM_PKGVAR 作为持久化数据根目录（应用更新时不会被覆盖）
DATA_DIR = os.environ.get('TRIM_PKGVAR', os.path.join(base_dir, 'data'))
os.makedirs(DATA_DIR, mode=0o755, exist_ok=True)

# ========== 缓存配置 ==========
CACHE_TTL = 86400  # 24小时
RATE_LIMIT_MAX = 5

# ================================================================
# ========== 源状态缓存配置 ==========
# ================================================================
_source_status_cache = {}
_cache_time = 0
SOURCE_CACHE_TTL = 300  # 5分钟

# ================================================================
# ========== 默认软件源配置 ==========
# ================================================================

DEFAULT_SOURCES = [
    {
        "id": "official",
        "name": "FN软仓官方源",
        "url": "http://rc.hhxs2026.top:5660",
        "enabled": True,
        "added_at": datetime.now().isoformat()
    }
]

# ================================================================
# ========== 获取应用安装根目录（动态，依赖环境变量） ==========
# ================================================================

def get_appcenter_base():
    """
    获取所有应用安装根目录列表。
    优先从环境变量推导（TRIM_APPDEST / TRIM_APPDEST_VOL），
    失败则扫描 /vol*/@appcenter 作为兜底。
    """
    bases = []
    
    # ✅ 方式1：从 TRIM_APPDEST 推导（最准确，飞牛系统运行时会注入）
    # /vol1/@appcenter/fn-appstores-client/target → /vol1/@appcenter
    appdest = os.environ.get('TRIM_APPDEST')
    if appdest:
        parent = os.path.dirname(os.path.dirname(appdest))
        if os.path.exists(parent):
            bases.append(parent)
    
    # ✅ 方式2：从 TRIM_APPDEST_VOL 拼接
    appdest_vol = os.environ.get('TRIM_APPDEST_VOL')
    if appdest_vol:
        cand = os.path.join(appdest_vol, '@appcenter')
        if os.path.exists(cand) and cand not in bases:
            bases.append(cand)
    
    # ✅ 方式3：扫描 /vol*/@appcenter（兜底，兼容手动调试）
    if not bases:
        for base in glob.glob('/vol*/@appcenter'):
            if os.path.exists(base):
                bases.append(base)
    
    # 如果还是没有，使用兜底值
    if not bases:
        bases.append('/vol1/@appcenter')
    
    return bases

# ================================================================
# ========== 源管理（核心） ==========
# ================================================================

def get_sources_path():
    return os.path.join(DATA_DIR, 'sources.json')

def load_sources():
    sources_path = get_sources_path()
    os.makedirs(DATA_DIR, mode=0o755, exist_ok=True)
    
    if not os.path.exists(sources_path):
        print(f"📝 sources.json 不存在，创建默认源配置")
        with open(sources_path, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_SOURCES, f, ensure_ascii=False, indent=2)
        return DEFAULT_SOURCES.copy()
    
    try:
        with open(sources_path, 'r', encoding='utf-8') as f:
            sources = json.load(f)
        print(f"✅ 加载 {len(sources)} 个软件源")
        return sources
    except Exception as e:
        print(f"⚠️ 读取 sources.json 失败: {e}，使用默认配置")
        return DEFAULT_SOURCES.copy()

def save_sources(sources):
    sources_path = get_sources_path()
    try:
        with open(sources_path, 'w', encoding='utf-8') as f:
            json.dump(sources, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"⚠️ 保存 sources.json 失败: {e}")
        return False

def get_enabled_sources():
    sources = load_sources()
    return [s for s in sources if s.get('enabled', True)]

def test_source_connectivity(url):
    try:
        resp = requests.head(f'{url}/api/apps', timeout=5)
        if resp.status_code < 400:
            return True, "连接成功"
        return False, f"HTTP {resp.status_code}"
    except requests.exceptions.Timeout:
        return False, "连接超时"
    except requests.exceptions.ConnectionError:
        return False, "无法连接"
    except Exception as e:
        return False, str(e)

def fetch_apps_from_source(source):
    url = source.get('url')
    name = source.get('name', url)
    source_id = source.get('id')
    
    try:
        resp = requests.get(f'{url}/api/apps', timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('success'):
                apps = data.get('data', [])
                for app in apps:
                    if '_source_name' not in app:
                        app['_source_name'] = name
                    if '_source_id' not in app:
                        app['_source_id'] = source_id
                    if '_source_url' not in app:
                        app['_source_url'] = url
                print(f"✅ 从 {name} 拉取 {len(apps)} 个应用")
                return apps
        return []
    except Exception as e:
        print(f"⚠️ 从 {name} 拉取失败: {e}")
        return []

def merge_apps_from_sources():
    sources = get_enabled_sources()
    if not sources:
        print("⚠️ 没有启用的软件源")
        return []
    
    app_map = {}
    
    for source in sources:
        apps = fetch_apps_from_source(source)
        for app in apps:
            app_id = app.get('id')
            if not app_id:
                continue
            
            if app_id in app_map:
                existing_app, existing_version = app_map[app_id]
                new_version = app.get('version', '0')
                if compare_versions(new_version, existing_version) > 0:
                    app_map[app_id] = (app, new_version)
            else:
                app_map[app_id] = (app, app.get('version', '0'))
    
    result = [app for app, _ in app_map.values()]
    print(f"✅ 合并后共 {len(result)} 个应用")
    return result

def compare_versions(v1, v2):
    if not v1 or not v2:
        return 0
    v1 = str(v1).replace('v', '').replace('V', '').strip()
    v2 = str(v2).replace('v', '').replace('V', '').strip()
    parts1 = [int(x) for x in v1.split('.')]
    parts2 = [int(x) for x in v2.split('.')]
    for i in range(max(len(parts1), len(parts2))):
        a = parts1[i] if i < len(parts1) else 0
        b = parts2[i] if i < len(parts2) else 0
        if a > b:
            return 1
        if a < b:
            return -1
    return 0

# ================================================================
# ========== 日志功能（脱敏） ==========
# ================================================================

def sanitize_log(text):
    if not isinstance(text, str):
        return text
    return re.sub(r'https?://[^\s]+', '[*****]', text)

def get_log_file():
    return os.path.join(DATA_DIR, 'app.log')

def log_operation(action, detail, user='system'):
    log_file = get_log_file()
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    detail_safe = sanitize_log(detail)
    log_line = f"[{timestamp}] {user} - {action}: {detail_safe}"
    try:
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, mode=0o755, exist_ok=True)
        if os.path.exists(log_file):
            with open(log_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            if len(lines) >= 500:
                with open(log_file, 'w', encoding='utf-8') as f:
                    f.writelines(lines[-400:])
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(log_line + '\n')
    except:
        pass

def get_sanitized_logs():
    log_file = get_log_file()
    logs = []
    if os.path.exists(log_file):
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        logs.append(sanitize_log(line))
        except:
            pass
    return logs

# ================================================================
# ========== 版本号相关 ==========
# ================================================================

def get_app_version():
    # 1. 优先读环境变量（飞牛系统注入）
    version = os.environ.get('TRIM_APPVER')
    if version:
        return version

    # 2. ✅ 直接从 /var/apps/fn-appstores-client/manifest 读取
    manifest_path = '/var/apps/fn-appstores-client/manifest'
    try:
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('version='):
                        return line.split('=', 1)[1].strip()
                    elif line.startswith('version:'):
                        return line.split(':', 1)[1].strip()
    except Exception as e:
        print(f"⚠️ 读取 manifest 失败: {e}")

    # 3. 兜底（正常情况下不会走到这里）
    return '2.6.0'

# ================================================================
# ========== 获取应用列表（多源模式） ==========
# ================================================================

def get_all_apps(force_refresh=False):
    cache_key = 'all_apps_list'

    if not force_refresh:
        cached = getattr(flask_app, '_app_cache', None)
        if cached and cached.get('key') == cache_key:
            cache_time = cached.get('time', 0)
            if time.time() - cache_time < CACHE_TTL:
                print(f"✅ 使用缓存应用列表")
                return cached.get('value', [])

    apps = merge_apps_from_sources()

    if not apps:
        return []

    default_url = get_default_source_url()
    for app in apps:
        app_id = app.get('id')
        if not app_id:
            continue

        if 'download_url' not in app or not app['download_url']:
            version = app.get('version', '')
            fpk_filename = f'{app_id}-{version}.fpk'
            source_url = app.get('_source_url', default_url)
            app['download_url'] = f"{source_url}/apps/{fpk_filename}"
        
        if 'icon' not in app or not app['icon']:
            source_url = app.get('_source_url', default_url)
            app['icon'] = f"{source_url}/icons/{app_id}.PNG"

    installed_apps = get_installed_apps()
    installed_versions = get_installed_apps_with_versions()
    installed_versions_dict = {app['id']: app['version'] for app in installed_versions}
    for app in apps:
        app_id = app.get('id')
        app['installed'] = app_id in installed_apps
        if app_id in installed_versions_dict:
            app['installed_version'] = installed_versions_dict[app_id]
            app['has_update'] = compare_versions(
                app.get('version', ''),
                app.get('installed_version', '')
            ) > 0
        else:
            app['has_update'] = False

    flask_app._app_cache = {
        'key': cache_key,
        'value': apps,
        'time': time.time()
    }

    return apps

def get_default_source_url():
    sources = load_sources()
    for s in sources:
        if s.get('default', False) or s.get('id') == 'official':
            return s.get('url', 'http://rc.hhxs2026.top:5660')
    return 'http://rc.hhxs2026.top:5660'

def get_app_by_id(app_id):
    apps = get_all_apps()
    for app in apps:
        if app.get('id') == app_id:
            return app
    return None

# ================================================================
# ========== 已安装应用（动态目录） ==========
# ================================================================

def get_installed_apps():
    installed = []
    
    # ✅ 使用动态检测的目录列表
    for base in get_appcenter_base():
        if os.path.exists(base):
            try:
                for item in os.listdir(base):
                    full_path = os.path.join(base, item)
                    if os.path.isdir(full_path) and not item.startswith('.'):
                        installed.append(item)
            except Exception as e:
                print(f"读取目录 {base} 失败: {e}")
    
    # 系统目录（兜底）
    system_app_dir = '/usr/local/apps/@appcenter/'
    if os.path.exists(system_app_dir):
        for item in os.listdir(system_app_dir):
            if os.path.isdir(os.path.join(system_app_dir, item)) and not item.startswith('.'):
                if item not in installed:
                    installed.append(item)
    
    return installed

def get_installed_apps_with_versions():
    installed = []
    
    for base in get_appcenter_base():
        if os.path.exists(base):
            for item in os.listdir(base):
                full_path = os.path.join(base, item)
                if os.path.isdir(full_path) and not item.startswith('.'):
                    manifest_candidates = [
                        os.path.join(full_path, 'manifest'),
                        os.path.join(full_path, 'target', 'manifest'),
                        f'/var/apps/{item}/manifest',
                    ]
                    version = ''
                    app_id = item
                    for cand in manifest_candidates:
                        if os.path.exists(cand):
                            try:
                                with open(cand, 'r') as f:
                                    content = f.read()
                                    match = re.search(r'version\s*[=:]\s*(v?[\d.]+)', content, re.IGNORECASE)
                                    if match:
                                        version = match.group(1)
                                    match_id = re.search(r'appId\s*[=:]\s*(\S+)', content, re.IGNORECASE)
                                    if match_id:
                                        app_id = match_id.group(1).strip()
                                    elif re.search(r'appname\s*[=:]\s*(\S+)', content, re.IGNORECASE):
                                        appname_match = re.search(r'appname\s*[=:]\s*(\S+)', content, re.IGNORECASE)
                                        if appname_match:
                                            app_id = appname_match.group(1).strip()
                                    break
                            except:
                                continue
                    installed.append({
                        'id': app_id,
                        'version': version,
                        'dir': item
                    })
    
    # 系统目录（兜底）
    system_app_dir = '/usr/local/apps/@appcenter/'
    if os.path.exists(system_app_dir):
        for item in os.listdir(system_app_dir):
            if os.path.isdir(os.path.join(system_app_dir, item)) and not item.startswith('.'):
                existing_ids = [app['id'] for app in installed]
                if item not in existing_ids:
                    manifest_path = os.path.join(system_app_dir, item, 'manifest')
                    version = ''
                    if os.path.exists(manifest_path):
                        try:
                            with open(manifest_path, 'r') as f:
                                content = f.read()
                                match = re.search(r'version\s*[=:]\s*(v?[\d.]+)', content, re.IGNORECASE)
                                if match:
                                    version = match.group(1)
                        except:
                            pass
                    installed.append({
                        'id': item,
                        'version': version,
                        'dir': item
                    })
    
    return installed

# ================================================================
# ========== 限流器 ==========
# ================================================================

rate_limit_storage = defaultdict(list)

def check_rate_limit(client_key, action='refresh'):
    config = {
        'refresh': {'max': RATE_LIMIT_MAX, 'window': 60},
        'install': {'max': 5, 'window': 300},
    }.get(action, {'max': 10, 'window': 60})
    now = time.time()
    window = config['window']
    max_requests = config['max']
    rate_limit_storage[client_key] = [
        t for t in rate_limit_storage[client_key]
        if now - t < window
    ]
    if len(rate_limit_storage[client_key]) >= max_requests:
        oldest = rate_limit_storage[client_key][0]
        wait_time = int(window - (now - oldest)) + 1
        return False, wait_time
    rate_limit_storage[client_key].append(now)
    return True, 0

# ================================================================
# ========== 清理桌面图标 ==========
# ================================================================

def clean_desktop_files(app_id):
    """清理应用对应的 .desktop 文件"""
    cleaned = []
    search_dirs = [
        '/usr/share/applications',
        '/usr/local/share/applications',
        '/var/apps/*/',
        '/vol*/@appcenter/*/',
    ]
    
    for pattern in search_dirs:
        if '*' in pattern:
            for base in glob.glob(pattern):
                if os.path.exists(base) and os.path.isdir(base):
                    for f in os.listdir(base):
                        if f.endswith('.desktop'):
                            full_path = os.path.join(base, f)
                            try:
                                with open(full_path, 'r', encoding='utf-8') as fp:
                                    content = fp.read()
                                    if app_id in content or app_id.lower() in content.lower():
                                        os.remove(full_path)
                                        cleaned.append(full_path)
                            except:
                                continue
        else:
            if os.path.exists(pattern):
                for f in os.listdir(pattern):
                    if f.endswith('.desktop'):
                        full_path = os.path.join(pattern, f)
                        try:
                            with open(full_path, 'r', encoding='utf-8') as fp:
                                content = fp.read()
                                if app_id in content or app_id.lower() in content.lower():
                                    os.remove(full_path)
                                    cleaned.append(full_path)
                        except:
                            continue
    return cleaned

# ================================================================
# ========== 安装执行（带进度） ==========
# ================================================================

_wizard_sessions = {}

def extract_fpk(fpk_path):
    base_dir = os.path.dirname(fpk_path)
    extract_dir = os.path.join(base_dir, 'fpk_extract')
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    os.makedirs(extract_dir)
    try:
        with tarfile.open(fpk_path, 'r:gz') as tar:
            tar.extractall(extract_dir)
        return extract_dir
    except Exception as e:
        print(f"解压 .fpk 失败: {e}")
        if os.path.exists(extract_dir):
            shutil.rmtree(extract_dir)
        return None

def parse_wizard_config(extract_dir, wizard_type='install'):
    wizard_file = os.path.join(extract_dir, 'wizard', wizard_type)
    if not os.path.exists(wizard_file):
        return None
    try:
        with open(wizard_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        return {'config': config, 'wizard_file': wizard_file}
    except Exception as e:
        print(f"解析 wizard/{wizard_type} 失败: {e}")
        return None

def cleanup_wizard_files(tmp_dir):
    try:
        if os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir)
        return True
    except Exception as e:
        print(f"清理失败: {e}")
        return False

def refresh_app_status(app_id):
    try:
        subprocess.run(['/usr/local/bin/appcenter-cli', 'list', '--refresh'],
                       capture_output=True, timeout=10)
        time.sleep(2)
        subprocess.run(['/usr/local/bin/appcenter-cli', 'start', app_id],
                       capture_output=True, timeout=30)
        time.sleep(2)
        subprocess.run(['/usr/local/bin/appcenter-cli', 'list', '--refresh'],
                       capture_output=True, timeout=10)
        return True
    except Exception as e:
        print(f"刷新应用状态失败: {e}")
        return False

def parse_docker_error(full_output):
    """解析 Docker 相关的错误信息"""
    if not full_output:
        return None
    
    full_lower = full_output.lower()
    
    # 端口占用
    if "port" in full_lower and ("already in use" in full_lower or "address already in use" in full_lower):
        return "安装失败：端口被占用，请修改向导中的端口设置"
    
    # 镜像拉取失败
    if "image" in full_lower and ("not found" in full_lower or "pull" in full_lower or "failed to pull" in full_lower):
        return "安装失败：镜像拉取失败，请检查网络或镜像地址"
    
    # 卷挂载失败
    if ("volume" in full_lower or "mount" in full_lower) and ("failed" in full_lower or "error" in full_lower):
        return "安装失败：卷挂载失败，请检查路径格式"
    
    # 容器创建失败
    if "container" in full_lower and ("failed" in full_lower or "error" in full_lower or "create" in full_lower):
        return "安装失败：容器创建失败，请检查日志"
    
    # Docker 守护进程问题
    if "docker" in full_lower and ("daemon" in full_lower or "not running" in full_lower):
        return "安装失败：Docker 服务未运行，请检查飞牛系统"
    
    # 权限问题
    if "permission" in full_lower or "denied" in full_lower:
        return "安装失败：权限不足，请检查飞牛系统设置"
    
    # 磁盘空间
    if "space" in full_lower or "no space left" in full_lower:
        return "安装失败：磁盘空间不足，请清理后重试"
    
    return None

def install_app_with_progress(app_id, download_url, ws):
    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp(prefix=f'fnsoft_{app_id}_')
        fpk_path = os.path.join(tmp_dir, f'{app_id}.fpk')

        ws.send(json.dumps({
            'event': 'progress',
            'data': {
                'app_id': app_id,
                'status': 'downloading',
                'msg': '连接中...',
                'progress': 0,
                'stage': 'download'
            }
        }))

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://gitee.com/"
        }

        resp = requests.get(download_url, headers=headers, stream=True, timeout=120, allow_redirects=True)
        if resp.status_code != 200:
            ws.send(json.dumps({
                'event': 'result',
                'data': {
                    'app_id': app_id,
                    'status': 'error',
                    'msg': f'下载失败: HTTP {resp.status_code}'
                }
            }))
            cleanup_wizard_files(tmp_dir)
            return

        total_size = int(resp.headers.get('content-length', 0))
        downloaded = 0
        start_time = time.time()
        last_update = 0

        with open(fpk_path, 'wb') as f:
            for chunk in resp.iter_content(8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    now = time.time()
                    if now - last_update > 0.5:
                        last_update = now
                        if total_size > 0:
                            progress = min(100, int(downloaded / total_size * 100))
                        else:
                            progress = 0

                        elapsed = now - start_time
                        speed = downloaded / elapsed if elapsed > 0 else 0
                        speed_str = f"{speed/1024:.1f} KB/s" if speed < 1024*1024 else f"{speed/1024/1024:.1f} MB/s"
                        downloaded_str = f"{downloaded/1024/1024:.1f} MB" if downloaded > 1024*1024 else f"{downloaded/1024:.1f} KB"
                        total_str = f"{total_size/1024/1024:.1f} MB" if total_size > 1024*1024 else f"{total_size/1024:.1f} KB"

                        ws.send(json.dumps({
                            'event': 'progress',
                            'data': {
                                'app_id': app_id,
                                'status': 'downloading',
                                'msg': f'下载中... {progress}% ({downloaded_str}/{total_str})',
                                'progress': progress,
                                'downloaded': downloaded,
                                'total': total_size,
                                'speed': speed,
                                'speed_str': speed_str,
                                'eta': 0,
                                'stage': 'download'
                            }
                        }))

        ws.send(json.dumps({
            'event': 'progress',
            'data': {
                'app_id': app_id,
                'status': 'extracting',
                'msg': '解压中...',
                'progress': 100,
                'stage': 'extract'
            }
        }))

        extract_dir = extract_fpk(fpk_path)
        if not extract_dir:
            ws.send(json.dumps({
                'event': 'result',
                'data': {
                    'app_id': app_id,
                    'status': 'error',
                    'msg': '解压失败'
                }
            }))
            cleanup_wizard_files(tmp_dir)
            return

        wizard_config = parse_wizard_config(extract_dir, 'install')
        has_install_wizard = wizard_config is not None and wizard_config.get('config')

        if has_install_wizard:
            session_id = f"{app_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
            _wizard_sessions[session_id] = {
                'app_id': app_id,
                'fpk_path': fpk_path,
                'tmp_dir': tmp_dir,
                'extract_dir': extract_dir,
                'wizard_config': wizard_config,
                'wizard_type': 'install',
                'step': 'waiting_for_input'
            }
            ws.send(json.dumps({
                'event': 'wizard.show',
                'data': {
                    'app_id': app_id,
                    'session_id': session_id,
                    'type': 'install',
                    'steps': wizard_config['config'],
                    'title': '安装向导'
                }
            }))
            return

        ws.send(json.dumps({
            'event': 'progress',
            'data': {
                'app_id': app_id,
                'status': 'installing',
                'msg': '安装中...',
                'progress': 100,
                'stage': 'install'
            }
        }))

        # ✅ 安装前清理可能的残留目录（不依赖卸载功能）
        for base in get_appcenter_base():
            cand = os.path.join(base, app_id)
            if os.path.exists(cand) and os.path.isdir(cand):
                try:
                    shutil.rmtree(cand, ignore_errors=True)
                except:
                    pass
        time.sleep(1)

        # ✅ 移除 --volume 1，与应用中心手动上传保持一致
        cmd = ['/usr/local/bin/appcenter-cli', 'install-fpk', fpk_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        # ✅ 等待系统注册完成
        time.sleep(3)

        # ✅ 用 appcenter-cli list 确认系统是否识别
        list_cmd = ['/usr/local/bin/appcenter-cli', 'list', '--refresh']
        subprocess.run(list_cmd, capture_output=True, timeout=10)
        time.sleep(2)
        
        list_result = subprocess.run(['/usr/local/bin/appcenter-cli', 'list'], capture_output=True, text=True, timeout=10)
        system_recognized = app_id.lower() in list_result.stdout.lower()

        # ✅ 同时检查目录是否存在
        installed_check = get_installed_apps()
        installed_lower = [name.lower() for name in installed_check]
        app_id_lower = app_id.lower()
        dir_exists = app_id_lower in installed_lower

        # ✅ 错误信息解析
        error_msg = result.stderr or ''
        stdout_msg = result.stdout or ''
        full_output = f"{stdout_msg}\n{error_msg}"

        if (result.returncode == 0 and system_recognized) or (result.returncode == 0 and dir_exists):
            # ✅ 安装成功（系统识别 或 目录存在）
            refresh_app_status(app_id)
            cleanup_wizard_files(tmp_dir)
            ws.send(json.dumps({
                'event': 'result',
                'data': {
                    'app_id': app_id,
                    'status': 'success',
                    'msg': '安装成功'
                }
            }))
            log_operation('安装', f'{app_id}')
        else:
            # ❌ 安装失败，解析错误信息
            user_msg = None
            
            # 先尝试解析 Docker 相关错误
            user_msg = parse_docker_error(full_output)
            
            if not user_msg:
                # 依赖缺失
                if re.search(r'依赖|dependency|missing.*dependency', full_output, re.IGNORECASE):
                    dep_match = re.search(r'依赖[：:]\s*([^\s,;.]+)', full_output)
                    if dep_match:
                        dep_name = dep_match.group(1)
                        user_msg = f'安装失败：缺少依赖「{dep_name}」，请先在应用中心安装该依赖'
                    else:
                        user_msg = '安装失败：缺少依赖，请在应用中心查看详情'
                # 权限问题
                elif re.search(r'permission|权限|denied|不允许', full_output, re.IGNORECASE):
                    user_msg = '安装失败：权限不足，请检查飞牛系统设置'
                # 磁盘空间不足
                elif re.search(r'space|空间|No space left', full_output, re.IGNORECASE):
                    user_msg = '安装失败：磁盘空间不足，请清理后重试'
                # 文件损坏
                elif re.search(r'corrupt|损坏|invalid|无效', full_output, re.IGNORECASE):
                    user_msg = '安装失败：安装包可能已损坏，请尝试重新下载'
                # 系统注册失败
                elif not system_recognized and not dir_exists:
                    user_msg = '安装失败：应用未正确注册到系统，请尝试在应用中心手动安装'
                # 其他错误
                elif error_msg and len(error_msg) < 200:
                    user_msg = f'安装失败：{error_msg.strip()}'
                else:
                    user_msg = '安装失败：请查看系统日志或尝试在应用中心手动安装'

            cleanup_wizard_files(tmp_dir)
            ws.send(json.dumps({
                'event': 'result',
                'data': {
                    'app_id': app_id,
                    'status': 'error',
                    'msg': user_msg
                }
            }))
            log_operation('安装失败', f'{app_id}: {user_msg}')

    except Exception as e:
        log_operation('安装失败', f'{app_id}: {str(e)}')
        ws.send(json.dumps({
            'event': 'result',
            'data': {
                'app_id': app_id,
                'status': 'error',
                'msg': f'安装异常：{str(e)}'
            }
        }))
        if tmp_dir:
            cleanup_wizard_files(tmp_dir)

@flask_app.route('/api/wizard/install', methods=['POST'])
def api_wizard_install():
    data = request.get_json()
    session_id = data.get('session_id')
    user_inputs = data.get('inputs', {})

    if not session_id or session_id not in _wizard_sessions:
        return jsonify({'success': False, 'message': '会话已过期，请重新安装'})

    session_data = _wizard_sessions[session_id]
    app_id = session_data['app_id']
    fpk_path = session_data['fpk_path']
    extract_dir = session_data['extract_dir']
    tmp_dir = session_data['tmp_dir']

    env_file = os.path.join(extract_dir, 'wizard.env')
    try:
        with open(env_file, 'w', encoding='utf-8') as f:
            for key, value in user_inputs.items():
                f.write(f"{key}={value}\n")
                if not key.startswith('wizard_'):
                    f.write(f"wizard_{key}={value}\n")
    except Exception as e:
        cleanup_wizard_files(tmp_dir)
        del _wizard_sessions[session_id]
        return jsonify({'success': False, 'message': f'写入环境文件失败: {str(e)}'})

    # ✅ 安装前清理可能的残留目录
    for base in get_appcenter_base():
        cand = os.path.join(base, app_id)
        if os.path.exists(cand) and os.path.isdir(cand):
            try:
                shutil.rmtree(cand, ignore_errors=True)
            except:
                pass
    time.sleep(1)

    cmd = ['/usr/local/bin/appcenter-cli', 'install-fpk', fpk_path, '--env', env_file]
    env = os.environ.copy()
    env['PATH'] = '/usr/local/bin:/usr/bin:/bin:/sbin'
    env['HOME'] = '/root'
    env['USER'] = 'root'
    log_operation('向导安装命令', f'{app_id}: {" ".join(cmd)}')
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env, cwd='/tmp')
    log_operation('向导安装输出', f'{app_id} stdout: {result.stdout}')
    log_operation('向导安装输出', f'{app_id} stderr: {result.stderr}')
    log_operation('向导安装返回码', f'{app_id}: {result.returncode}')

    cleanup_wizard_files(tmp_dir)
    del _wizard_sessions[session_id]

    time.sleep(3)

    # ✅ 用 appcenter-cli list 验证
    list_cmd = ['/usr/local/bin/appcenter-cli', 'list', '--refresh']
    subprocess.run(list_cmd, capture_output=True, timeout=10)
    time.sleep(2)
    
    list_result = subprocess.run(['/usr/local/bin/appcenter-cli', 'list'], capture_output=True, text=True, timeout=10)
    system_recognized = app_id.lower() in list_result.stdout.lower()

    installed_check = get_installed_apps()
    installed_lower = [name.lower() for name in installed_check]
    dir_exists = app_id.lower() in installed_lower

    if not system_recognized and not dir_exists:
        # 尝试解析错误信息
        full_output = f"{result.stdout}\n{result.stderr}"
        user_msg = parse_docker_error(full_output)
        if not user_msg:
            user_msg = '安装失败: 请检查系统日志或稍后重试'
        log_operation('安装假成功', f'{app_id}: {user_msg}')
        return jsonify({'success': False, 'message': user_msg})

    if system_recognized:
        log_operation('安装验证', f'{app_id}: 系统已识别（appcenter-cli list）')
    else:
        log_operation('安装验证', f'{app_id}: 目录存在（扫目录）')

    target_dir = None
    for base in get_appcenter_base():
        cand = os.path.join(base, app_id)
        if os.path.exists(cand) and os.path.isdir(cand):
            target_dir = cand
            break

    if target_dir:
        config_path = os.path.join(target_dir, 'app', 'ui', 'config')
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config_content = f.read()
                for key, value in user_inputs.items():
                    config_content = config_content.replace(f'${{{key}}}', str(value))
                with open(config_path, 'w', encoding='utf-8') as f:
                    f.write(config_content)
                log_operation('占位符替换', f'{app_id}: 已替换 {list(user_inputs.keys())}')
            except Exception as e:
                log_operation('占位符替换失败', f'{app_id}: {str(e)}')
        else:
            log_operation('占位符跳过', f'{app_id}: 未找到 app/ui/config')
    else:
        log_operation('占位符跳过', f'{app_id}: 未找到安装目录')

    refresh_app_status(app_id)
    log_operation('安装完成', f'{app_id} 带向导安装')
    return jsonify({'success': True, 'message': '安装成功'})

@flask_app.route('/api/wizard/cancel', methods=['POST'])
def api_wizard_cancel():
    data = request.get_json()
    session_id = data.get('session_id')
    if session_id and session_id in _wizard_sessions:
        session_data = _wizard_sessions[session_id]
        cleanup_wizard_files(session_data['tmp_dir'])
        del _wizard_sessions[session_id]
        return jsonify({'success': True, 'message': '已取消'})
    return jsonify({'success': False, 'message': '会话不存在'})

# ================================================================
# ========== 软件源管理 API ==========
# ================================================================

@flask_app.route('/api/sources', methods=['GET'])
def api_get_sources():
    global _source_status_cache, _cache_time
    force = request.args.get('force', 'false').lower() == 'true'
    sources = load_sources()
    
    now = time.time()
    need_refresh = force or (now - _cache_time > SOURCE_CACHE_TTL) or not _source_status_cache
    
    if need_refresh:
        status_map = {}
        for source in sources:
            url = source.get('url')
            if url:
                ok, msg = test_source_connectivity(url)
                status_map[url] = {'status': 'online' if ok else 'offline', 'msg': msg}
        _source_status_cache = status_map
        _cache_time = now
    
    for source in sources:
        url = source.get('url')
        if not source.get('enabled', True):
            source['status'] = 'disabled'
            source['status_msg'] = '已禁用'
        elif url and url in _source_status_cache:
            source['status'] = _source_status_cache[url]['status']
            source['status_msg'] = _source_status_cache[url]['msg']
        else:
            source['status'] = 'unknown'
            source['status_msg'] = '未检测'
    
    return jsonify({"success": True, "data": sources})

@flask_app.route('/api/sources/add', methods=['POST'])
def api_add_source():
    data = request.get_json()
    name = data.get('name', '').strip()
    url = data.get('url', '').strip()
    
    if not name or not url:
        return jsonify({"success": False, "message": "名称和地址不能为空"})
    
    if not url.startswith('http://') and not url.startswith('https://'):
        return jsonify({"success": False, "message": "地址必须以 http:// 或 https:// 开头"})
    
    url = url.rstrip('/')
    
    sources = load_sources()
    for s in sources:
        if s.get('url') == url:
            return jsonify({"success": False, "message": "该地址已存在"})
    
    ok, msg = test_source_connectivity(url)
    if not ok:
        return jsonify({"success": False, "message": f"无法连接到该源: {msg}"})
    
    new_source = {
        "id": f"source_{int(time.time())}",
        "name": name,
        "url": url,
        "enabled": True,
        "added_at": datetime.now().isoformat()
    }
    sources.append(new_source)
    
    if not save_sources(sources):
        return jsonify({"success": False, "message": "保存配置失败"})
    
    log_operation('添加源', f'{name} ({url})')
    return jsonify({"success": True, "data": new_source, "message": "添加成功"})

@flask_app.route('/api/sources/remove', methods=['POST'])
def api_remove_source():
    data = request.get_json()
    source_id = data.get('id')
    
    if not source_id:
        return jsonify({"success": False, "message": "缺少源 ID"})
    
    sources = load_sources()
    
    for s in sources:
        if s.get('id') == source_id and s.get('id') in ['official', 'official_backup']:
            return jsonify({"success": False, "message": "不能删除官方源"})
    
    new_sources = [s for s in sources if s.get('id') != source_id]
    
    if len(new_sources) == len(sources):
        return jsonify({"success": False, "message": "源不存在"})
    
    if not save_sources(new_sources):
        return jsonify({"success": False, "message": "保存配置失败"})
    
    log_operation('删除源', f'{source_id}')
    return jsonify({"success": True, "message": "删除成功"})

@flask_app.route('/api/sources/toggle', methods=['POST'])
def api_toggle_source():
    data = request.get_json()
    source_id = data.get('id')
    enabled = data.get('enabled', True)
    
    if not source_id:
        return jsonify({"success": False, "message": "缺少源 ID"})
    
    sources = load_sources()
    found = False
    for s in sources:
        if s.get('id') == source_id:
            s['enabled'] = enabled
            found = True
            break
    
    if not found:
        return jsonify({"success": False, "message": "源不存在"})
    
    if not save_sources(sources):
        return jsonify({"success": False, "message": "保存配置失败"})
    
    status = '启用' if enabled else '禁用'
    log_operation('切换源状态', f'{source_id} -> {status}')
    return jsonify({"success": True, "message": f"已{status}"})

@flask_app.route('/api/sources/test', methods=['POST'])
def api_test_source():
    data = request.get_json()
    url = data.get('url', '').strip()
    
    if not url:
        return jsonify({"success": False, "message": "地址不能为空"})
    
    ok, msg = test_source_connectivity(url)
    return jsonify({
        "success": ok,
        "message": msg,
        "url": url
    })

# ================================================================
# ========== 公告接口 ==========
# ================================================================

@flask_app.route('/api/notice')
def api_notice():
    sources = load_sources()
    enabled_sources = [s for s in sources if s.get('enabled', True)]
    
    for source in enabled_sources:
        url = source.get('url', '').rstrip('/')
        if not url:
            continue
        notice_url = f"{url}/api/notice"
        try:
            resp = requests.get(notice_url, timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('enabled'):
                    return jsonify(data)
        except:
            continue
    
    return jsonify({"enabled": False})

# ================================================================
# ========== 半自动更新：版本检测接口 ==========
# ================================================================

@flask_app.route('/api/check-update')
def check_update():
    """检查客户端自身是否有新版本（从官方源 /api/apps 中查找）"""
    current_version = get_app_version()
    
    official_url = get_default_source_url()
    if not official_url:
        return jsonify({"success": True, "has_update": False, "version": current_version})
    
    try:
        resp = requests.get(f'{official_url}/api/apps', timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('success'):
                apps = data.get('data', [])
                for app in apps:
                    if app.get('id') == 'fn-appstores-client':
                        latest = app.get('version', '')
                        download_url = app.get('download_url', '')
                        if compare_versions(latest, current_version) > 0 and download_url:
                            return jsonify({
                                "success": True,
                                "has_update": True,
                                "version": latest,
                                "download_url": download_url,
                                "release_notes": f"更新到 v{latest}"
                            })
                        break
    except Exception as e:
        print(f"检查客户端更新失败: {e}")
    
    return jsonify({"success": True, "has_update": False, "version": current_version})

# ================================================================
# ========== 原有路由 ==========
# ================================================================

@flask_app.route('/')
def index():
    version = get_app_version()
    return render_template('index.html', version=version)

@flask_app.route('/api/apps')
def api_apps():
    client_key = request.remote_addr
    allowed, wait_time = check_rate_limit(client_key, 'refresh')
    if not allowed:
        return jsonify({
            'success': False,
            'message': f'刷新太频繁，请在 {wait_time} 秒后重试',
            'retry_after': wait_time
        }), 429

    force_refresh = request.args.get('force', 'false').lower() == 'true'

    try:
        apps = get_all_apps(force_refresh=force_refresh)
        return jsonify({"success": True, "data": apps})
    except Exception as e:
        print(f"获取应用列表失败: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@flask_app.route('/api/refresh', methods=['POST'])
def api_refresh():
    client_key = request.remote_addr
    allowed, wait_time = check_rate_limit(client_key, 'refresh')
    if not allowed:
        return jsonify({
            'success': False,
            'message': f'刷新太频繁，请在 {wait_time} 秒后重试',
            'retry_after': wait_time
        }), 429

    try:
        apps = get_all_apps(force_refresh=True)
        return jsonify({'success': True, 'message': f'刷新成功，共 {len(apps)} 个应用', 'data': apps})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@flask_app.route('/api/installed')
def api_installed():
    installed = get_installed_apps_with_versions()
    return jsonify({"success": True, "apps": installed})

@flask_app.route('/api/app/<app_id>')
def api_app_detail(app_id):
    app = get_app_by_id(app_id)
    if app:
        return jsonify({"success": True, "data": app})
    return jsonify({"success": False, "message": "应用不存在"}), 404

@flask_app.route('/api/logs')
def api_logs():
    logs = get_sanitized_logs()
    return jsonify({"success": True, "data": logs[:500]})

@flask_app.route('/api/logs/export')
def api_logs_export():
    log_file = get_log_file()
    if not os.path.exists(log_file):
        return jsonify({'success': False, 'message': '日志文件不存在'}), 404
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            content = f.read()
        content_safe = sanitize_log(content)
        return Response(
            content_safe,
            mimetype='text/plain',
            headers={
                'Content-Disposition': f'attachment; filename=fnsoft_log_{datetime.now().strftime("%Y%m%d_%H%M%S")}.txt'
            }
        )
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ================================================================
# ========== WebSocket ==========
# ================================================================
@sock.route('/ws')
def websocket(ws):
    while True:
        data = ws.receive()
        if not data:
            break
        try:
            msg = json.loads(data)
            if msg.get('event') == 'install':
                app_id = msg['data'].get('app_id')
                download_url = msg['data'].get('download_url')
                threading.Thread(target=install_app_with_progress, args=(app_id, download_url, ws), daemon=True).start()
        except:
            pass

# ================================================================
# ========== 启动 ==========
# ================================================================

if __name__ == '__main__':
    version = get_app_version()
    print(f"✅ FN软仓 v{version} 启动在端口 {PORT}")
    print(f"📡 多源模式：从所有启用的软件源拉取应用")
    print(f"📂 数据目录: {DATA_DIR}")

    sources = load_sources()
    enabled = [s for s in sources if s.get('enabled', True)]
    print(f"📡 已启用 {len(enabled)} 个软件源:")
    for s in enabled:
        print(f"   ● {s.get('name')}: {s.get('url')}")

    flask_app.run(host='0.0.0.0', port=PORT, debug=False)