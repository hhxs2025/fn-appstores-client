# FN软仓客户端 代码知识库文档

> 本文档用于记录 FN软仓客户端 v2.6.2 的代码结构、核心逻辑和版本演进，便于后续开发和维护。


## 一、版本演进概览

| 版本 | 核心变化 | 状态 |
|------|---------|------|
| **v2.1.1** | 单一官方源，基础安装功能 | 已发布 |
| **v2.2.0-beta** | 多源管理初版（添加/删除/启用/禁用） | 已发布 |
| **v2.2.0** | 公告板 + 应用接入链接 | 已发布 |
| **v2.2.1** | 飞牛官方中继适配（`window.location.origin`） | 已发布 |
| **v2.2.2** | 源状态缓存 5 分钟 + 多源公告适配 | 已发布 |
| **v2.2.3** | 精简为单官方源，地址迁移至 `rc.hhxs2026.top:5660` | 已发布 |
| **v2.3.0** | 下载统计显示 + 公告 HTML 渲染 | 已发布 |
| **v2.3.1** | 向导环境变量双写 + 安装执行优化 + 下载重试机制 | 已发布 |
| **v2.3.2** | 三方源来源标签保留 + 应用状态识别优化 | 已发布 |
| **v2.3.3** | 占位符替换 + 安装验证强化 + 向导 UI 优化 | 已发布 |
| **v2.3.4** | 关于页公告板内容推送升级为整个关于页自定义 | 已发布 |
| **v2.4.0** | 关于页轮播图 + 自定义间隔 + 树状聚合架构适配 + FN认证标识 | 已发布 |
| **v2.4.1** | 轮播图手动切换 + 状态筛选独立行 + 富文本支持 + 公告超链接 | 已发布 |
| **v2.5.0** | 左侧导航 + 首页重构（轮播图+公告记录+四列快捷卡片）+ 设置页 + 默认首页 | 内部测试 |
| **v2.5.1** | 数据持久化 + 模板拆分 + 客户端自更新 + 应用类型筛选 + 自过滤 + 首页加载优化 | 已发布 |
| **v2.5.2** | 源管理优化 + Docker/原生筛选修复 + 按源名称筛选 + 缓存标签恢复 + 新增「商务」「教育」标签 + 新应用卡片增至10个 + 版本号动态化 | 已发布 |
| **v2.6.0** | 应用列表排序 + 安装进度显示 + 安装即时刷新 + 设置页增强 + 详情弹窗固定比例 | 已发布 |
| **v2.6.1** | **WebSocket 统一管理** + **安装任务队列** + **缓存读写统一** + **并发加载锁** + **DOM 空值保护全面加固** + **错误降级与离线缓存增强** | 已发布 |
| **v2.6.2** | **飞牛统一网关** + **HTTPS 图片代理** + **轮播图点击放大** + **端口模式可降级** | **当前版本** |

> **架构说明**：v2.3.2+ 配合服务端 v2.4.0+ 使用，服务端采用**树状聚合架构**，官方源可聚合三方源应用，客户端无需额外配置即可发现更多应用。
> **网关说明**：v2.6.2+ 接入飞牛统一网关，应用改走 Unix Socket，通过 `/app/fn-appstores-client` 路径访问，自动获得 HTTPS 适配与登录态复用。


## 二、整体架构

### 2.1 角色定位

客户端是运行在飞牛 NAS 上的 Web 应用，作为用户界面，聚合多个软件源的应用列表，提供应用浏览、安装、更新、源管理等功能。

### 2.2 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Web 框架 | Flask | Python 后端服务 |
| WSGI 服务器 | Werkzeug `make_server` | v2.6.2：通过 `host='unix://'+sock_path` 监听 Unix Socket |
| WebSocket | Flask-Sock | 实时推送安装进度，复用网关路径 `/app/fn-appstores-client/ws` |
| 前端 | HTML + CSS + JavaScript | 支持本地缓存 |
| 模板引擎 | Jinja2 | 服务端渲染 |
| 数据存储 | JSON | 源配置（`sources.json`） |
| 日志 | 文本文件 | `app.log`（自动轮转，保留 400 行） |
| 进程通信 | Unix Domain Socket | v2.6.2：`TRIM_APPDEST/app.sock` |

### 2.3 项目结构（v2.6.2）

```
fn-appstores-client/
├── app/
│   ├── manifest                  # 飞牛应用清单（v2.6.2：无 service_port）
│   ├── cmd/
│   │   └── main                  # 生命周期脚本（v2.6.2：支持网关模式启动）
│   ├── config/
│   │   ├── privilege
│   │   └── resource
│   ├── server/
│   │   ├── app.py                # 主程序（v2.6.2：统一网关 + 图片代理）
│   │   ├── app.pyc               # 编译产物
│   │   ├── requirements.txt
│   │   ├── vendor/
│   │   └── templates/
│   │       ├── layout.html       # 主布局
│   │       ├── index.html        # 入口（v2.6.2：wrapImageUrl + 轮播放大）
│   │       ├── home.html         # 首页
│   │       ├── apps.html         # 应用列表
│   │       ├── sources.html      # 源管理
│   │       ├── settings.html     # 设置页
│   │       └── modals.html       # 弹窗合集
│   └── ui/
│       ├── config                # 应用入口（v2.6.2：.url + gatewayPrefix + gatewaySocket）
│       └── images/
│           ├── icon_64.png
│           └── icon_256.png
├── ICON.PNG
└── ICON_256.PNG
```

**v2.6.2 改动文件清单**：

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/app.py` | 新增 | 统一网关启动逻辑 + PrefixMiddleware + 图片代理 |
| `server/templates/index.html` | 新增 | `wrapImageUrl` + 轮播图点击放大 + `API_BASE` 动态适配 |
| `cmd/main` | 重构 | 网关模式启动、socket 清理、status 双条件检查 |
| `manifest` | 修改 | 移除 `service_port`，`desktop_applaunchname` 对齐 |
| `ui/config` | 修改 | 顶层 key `.url`，新增 `gatewayPrefix` / `gatewaySocket` |


## 三、核心模块与函数

### 3.1 源管理模块

```python
# ========== 配置 ==========
DATA_DIR = os.environ.get('TRIM_PKGVAR', os.path.join(base_dir, 'data'))
os.makedirs(DATA_DIR, mode=0o755, exist_ok=True)

def get_sources_path():
    """获取 sources.json 文件路径（持久化目录）"""
    return os.path.join(DATA_DIR, 'sources.json')

def load_sources():
    """加载 data/sources.json，首次启动自动创建默认官方源"""
    
def save_sources(sources):
    """保存源配置到文件"""
    
def get_enabled_sources():
    """获取所有启用的软件源"""
    
def test_source_connectivity(url):
    """测试单个源地址是否可访问（HEAD 请求 /api/apps，超时 5 秒）"""
```

**默认官方源配置**：
```python
DEFAULT_SOURCES = [
    {
        "id": "official",
        "name": "FN软仓官方源",
        "url": "http://rc.hhxs2026.top:5660",
        "enabled": True,
        "added_at": datetime.now().isoformat()
    }
]
```

**源状态缓存**：
- 全局变量 `_source_status_cache`，TTL 300 秒（5 分钟）。
- 每次 `/api/sources` 请求检查缓存是否过期，过期则重新测试连通性。

### 3.2 应用拉取与合并（多源聚合）

```python
def fetch_apps_from_source(source):
    """
    从单个源拉取应用列表。
    v2.3.2 修复：不覆盖已有的 _source_name，保留服务端返回的来源信息。
    """
    url = source.get('url')
    name = source.get('name', url)
    source_id = source.get('id')
    
    resp = requests.get(f'{url}/api/apps', timeout=15)
    apps = resp.json().get('data', [])
    for app in apps:
        if '_source_name' not in app:
            app['_source_name'] = name
        if '_source_id' not in app:
            app['_source_id'] = source_id
        if '_source_url' not in app:
            app['_source_url'] = url
    return apps

def merge_apps_from_sources():
    """
    从所有启用的源拉取并合并应用列表。
    按 app_id 去重，保留版本较高的应用。
    树状聚合：服务端返回的应用已包含 _source_name / _source_id，客户端直接使用。
    """
    app_map = {}  # key: app_id, value: (app, version)
    for source in get_enabled_sources():
        apps = fetch_apps_from_source(source)
        for app in apps:
            app_id = app.get('id')
            if not app_id:
                continue
            if app_id in app_map:
                existing_app, existing_version = app_map[app_id]
                if compare_versions(app.get('version', '0'), existing_version) > 0:
                    app_map[app_id] = (app, app.get('version', '0'))
            else:
                app_map[app_id] = (app, app.get('version', '0'))
    return [app for app, _ in app_map.values()]
```

### 3.3 应用列表缓存与状态识别

```python
def get_all_apps(force_refresh=False):
    """
    获取合并后的应用列表。
    - 24小时内存缓存（CACHE_TTL = 86400 秒）。
    - 补全 download_url 和 icon（使用源地址作为 base_url）。
    - 标记 installed、installed_version、has_update。
    """
    cache_key = 'all_apps_list'
    if not force_refresh:
        cached = getattr(flask_app, '_app_cache', None)
        if cached and cached.get('key') == cache_key:
            if time.time() - cached.get('time', 0) < CACHE_TTL:
                return cached.get('value', [])
    
    apps = merge_apps_from_sources()
    # 补全 download_url / icon
    # 标记已安装状态
    flask_app._app_cache = {'key': cache_key, 'value': apps, 'time': time.time()}
    return apps

def get_installed_apps():
    """扫描 /vol*/@appcenter/ 及系统目录 /usr/local/apps/@appcenter/ 获取已安装应用目录名列表"""
    
def get_installed_apps_with_versions():
    """
    获取已安装应用及其版本号。
    从各目录的 manifest 中解析 appId 和 version。
    支持多级目录：{app_dir}/manifest、{app_dir}/target/manifest、/var/apps/{app_id}/manifest
    """
```

### 3.4 安装执行模块（带进度推送）

```python
def install_app_with_progress(app_id, download_url, ws):
    """
    无向导安装流程：
    1. 下载 FPK（通过 requests 流式下载，推送进度 + 百分比）
    2. 解压（tarfile）
    3. 检查 wizard/install 是否存在
    4. 若有向导，创建会话并推送 wizard.show 事件给前端
    5. 若无向导，调用 appcenter-cli install-fpk
    6. 安装前清理可能的残留目录
    """

def extract_fpk(fpk_path):
    """解压 .fpk（gzip 压缩的 tar 包）到临时目录"""
    
def parse_wizard_config(extract_dir, wizard_type='install'):
    """解析 wizard/install 或 wizard/uninstall 的 JSON 配置"""
    
def refresh_app_status(app_id):
    """刷新应用状态：appcenter-cli list --refresh + start app_id + list --refresh"""

@flask_app.route('/api/wizard/install', methods=['POST'])
def api_wizard_install():
    """
    向导安装流程：
    1. 写入 wizard.env（同时写入原始和 wizard_ 前缀）
    2. 调用 appcenter-cli install-fpk --env
    3. 验证安装是否成功（检查安装目录是否存在）
    4. 替换 app/ui/config 中的 ${key} 占位符
    5. 安装前清理可能的残留目录
    """

@flask_app.route('/api/wizard/cancel', methods=['POST'])
def api_wizard_cancel():
    """取消向导会话并清理临时文件"""
```

### 3.5 软件源管理 API

```python
@flask_app.route('/api/sources', methods=['GET'])
def api_get_sources():
    """获取源列表，附带连通状态（5分钟缓存）"""

@flask_app.route('/api/sources/add', methods=['POST'])
def api_add_source():
    """添加新源，测试连通性，保存配置"""

@flask_app.route('/api/sources/remove', methods=['POST'])
def api_remove_source():
    """删除源（官方源不可删除：id='official' 或 'official_backup'）"""

@flask_app.route('/api/sources/toggle', methods=['POST'])
def api_toggle_source():
    """启用/禁用源"""

@flask_app.route('/api/sources/test', methods=['POST'])
def api_test_source():
    """测试源地址连通性"""
```

### 3.6 公告接口（透传）

```python
@flask_app.route('/api/notice')
def api_notice():
    """
    按 sources.json 顺序，取第一个启用的源的 /api/notice。
    客户端 v2.5.1+ 要求服务端返回格式：
    {
        "enabled": true,
        "updated_at": "2026-08-27",
        "carousel": ["http://.../A.PNG", ...],
        "records": [
            { "date": "2026-08-27", "title": "标题", "content": "内容（支持HTML）" }
        ]
    }
    """
```

### 3.7 版本检测接口（半自动更新）

```python
@flask_app.route('/api/check-update')
def check_update():
    """
    检查客户端自身是否有新版本（从官方源 /api/apps 中查找）。
    返回 has_update、version、download_url。
    """
    current_version = get_app_version()
    official_url = get_default_source_url()
    resp = requests.get(f'{official_url}/api/apps', timeout=5)
    # 从应用列表中查找 id='fn-appstores-client' 的记录
    # 若版本高于当前版本，返回更新信息
```

### 3.8 统一网关启动（v2.6.2 新增）

```python
# ========== 全局配置 ==========
GATEWAY_PREFIX = '/app/fn-appstores-client'
GATEWAY_SOCKET_NAME = 'app.sock'
START_MODE = os.environ.get('START_MODE', 'gateway').lower()


class PrefixMiddleware:
    """
    裁剪网关前缀，把 /app/fn-appstores-client/xxx 映射到 /xxx。
    直接改 environ，不重建 WSGI 环境，对 WebSocket 升级请求更友好。
    """
    def __init__(self, app, prefix):
        self.app = app
        self.prefix = prefix.rstrip('/')

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '')
        if path.startswith(self.prefix):
            environ['SCRIPT_NAME'] = self.prefix
            environ['PATH_INFO'] = path[len(self.prefix):] or '/'
        return self.app(environ, start_response)


def start_gateway_mode():
    """
    统一网关模式：
    - 用 werkzeug 的 make_server 通过 host='unix://'+sock_path 监听 Unix Socket
    - 挂上 PrefixMiddleware 裁剪前缀
    - socket 生成后 chmod 660，让网关进程可连
    - 失败自动回退端口模式
    """
    from werkzeug.serving import make_server

    appdest = os.environ.get('TRIM_APPDEST', base_dir)
    sock_path = os.path.join(appdest, GATEWAY_SOCKET_NAME)

    if len(sock_path) > 100:
        sock_path = f"/tmp/fn-soft-{os.getpid()}.sock"

    if os.path.exists(sock_path):
        os.remove(sock_path)

    wsgi_app = PrefixMiddleware(flask_app, GATEWAY_PREFIX)

    try:
        httpd = make_server(
            host='unix://' + sock_path,
            port=0,
            app=wsgi_app,
            threaded=True
        )
        os.chmod(sock_path, 0o660)
        httpd.serve_forever()
    except Exception as e:
        print(f"❌ 统一网关模式启动失败: {e}")
        start_port_mode()


def start_port_mode():
    """端口模式：兼容旧部署"""
    flask_app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)


if __name__ == '__main__':
    if START_MODE == 'gateway':
        start_gateway_mode()
    else:
        start_port_mode()
```

### 3.9 图片代理（v2.6.2 新增）

```python
# ========== 全局缓存 ==========
_image_proxy_cache = {}
IMAGE_PROXY_CACHE_TTL = 600
IMAGE_PROXY_MAX_SIZE = 10 * 1024 * 1024
_allowed_hosts_cache = {'hosts': set(), 'time': 0}


def get_allowed_image_hosts():
    """
    白名单来源：
    1. 已配置软件源的 host
    2. 当前应用列表里 icon / screenshots 出现的 host（覆盖树状聚合的三方源）
    60 秒缓存，避免每次请求重新计算。
    """
    now = time.time()
    if now - _allowed_hosts_cache['time'] < 60 and _allowed_hosts_cache['hosts']:
        return _allowed_hosts_cache['hosts']

    hosts = set()
    for s in load_sources():
        url = s.get('url', '')
        m = re.match(r'https?://([^/:]+)', url)
        if m:
            hosts.add(m.group(1))

    try:
        apps = get_all_apps()
        for app in apps:
            u = app.get('icon', '')
            if u:
                m = re.match(r'https?://([^/:]+)', u)
                if m:
                    hosts.add(m.group(1))
            for su in (app.get('screenshots') or []):
                if su:
                    m = re.match(r'https?://([^/:]+)', su)
                    if m:
                        hosts.add(m.group(1))
    except Exception as e:
        print(f"⚠️ 收集图片 host 失败: {e}")

    hosts.add('127.0.0.1')
    hosts.add('localhost')

    _allowed_hosts_cache['hosts'] = hosts
    _allowed_hosts_cache['time'] = now
    return hosts


@flask_app.route('/api/proxy-image')
def api_proxy_image():
    """
    图片代理：
    - HTTPS 页面下，前端把 HTTP 图片转成该接口请求
    - 客户端从 HTTP 服务端拉图，转发给前端
    - 只允许白名单内的 host，防 SSRF
    - 单张限制 10MB，10 分钟内存缓存
    """
    raw_url = request.args.get('url', '')
    if not raw_url:
        return '', 400

    url = unquote(raw_url)

    m = re.match(r'https?://([^/:]+)', url)
    if not m:
        return '', 400
    host = m.group(1)
    if host not in get_allowed_image_hosts():
        return '', 403

    now = time.time()
    if url in _image_proxy_cache:
        ct, content, ts = _image_proxy_cache[url]
        if now - ts < IMAGE_PROXY_CACHE_TTL:
            return Response(content, content_type=ct)

    try:
        resp = requests.get(url, timeout=15, stream=True)
        if resp.status_code != 200:
            return '', resp.status_code

        content_type = resp.headers.get('Content-Type', 'image/png')
        chunks = []
        total = 0
        for chunk in resp.iter_content(8192):
            if not chunk:
                continue
            total += len(chunk)
            if total > IMAGE_PROXY_MAX_SIZE:
                return '', 413
            chunks.append(chunk)

        content = b''.join(chunks)
        _image_proxy_cache[url] = (content_type, content, now)
        return Response(content, content_type=content_type)
    except Exception as e:
        print(f"⚠️ 代理图片失败: {url} -> {e}")
        return '', 500
```

### 3.10 网关用户上下文（v2.6.2 新增）

```python
def get_gateway_user():
    """
    从飞牛统一网关注入的 Header 读取当前用户身份。
    仅通过网关访问时可用；端口模式或直连时返回 None。
    """
    uid = request.headers.get('X-Trim-Userid')
    if not uid:
        return None
    return {
        'uid': uid,
        'is_admin': request.headers.get('X-Trim-Isadmin', '').lower() == 'true',
        'username': request.headers.get('X-Trim-Username', '')
    }


@flask_app.route('/api/gateway-user')
def api_gateway_user():
    """调试接口：查看网关注入的用户上下文"""
    user = get_gateway_user()
    if user is None:
        return jsonify({"success": False, "message": "未通过统一网关访问"})
    return jsonify({"success": True, "data": user})
```

### 3.11 限流器

```python
rate_limit_storage = defaultdict(list)

def check_rate_limit(client_key, action='refresh'):
    """
    基于客户端 IP 的请求限流。
    - refresh: 60 秒内最多 5 次
    - install: 300 秒内最多 5 次
    """
```

### 3.12 日志模块（含脱敏）

```python
def sanitize_log(text):
    """脱敏：替换 URL 为 [*****]"""
    
def log_operation(action, detail, user='system'):
    """写入日志，自动轮转（保留最近 400 行）"""
    
def get_sanitized_logs():
    """读取并脱敏后的日志列表"""
```


## 四、前端核心模块（v2.6.2）

### 4.1 布局结构（`layout.html`）

**左侧导航（纯文字）**：
- 首页、应用、源管理、设置（4项）
- 桌面端：140px 宽，文字加粗（600），字号 14px
- 窄屏（≤1100px）：仅显示单字（首/应/源/设）
- 移动端（≤768px）：汉堡菜单展开，宽度 100px

**默认页面**：首页（`switchTab('home')`）

**顶部栏**：
- 左侧：应用名称 + 版本号
- 右侧：飞牛第三方应用市场 · 开发者:晦华先生

### 4.2 模板拆分

| 文件 | 职责 |
|------|------|
| `layout.html` | 主布局（导航、顶部栏、全局基础样式） |
| `index.html` | 入口文件（拼装页面 + 公共 JavaScript）—— **v2.6.2 新增图片代理与轮播放大** |
| `home.html` | 首页（结构 + 样式 + 首页专属 JS） |
| `apps.html` | 应用列表（结构 + 样式 + 排序） |
| `sources.html` | 源管理（结构 + 样式 + 源管理专属 JS） |
| `settings.html` | 设置页（结构 + 样式） |
| `modals.html` | 弹窗合集（结构 + 样式） |

### 4.3 统一网关适配（v2.6.2 新增）

```javascript
// API_BASE 动态判断
var GATEWAY_PREFIX = '/app/fn-appstores-client';
var API_BASE = '';
if (window.location.pathname.indexOf(GATEWAY_PREFIX) === 0) {
    API_BASE = GATEWAY_PREFIX;   // 网关模式
} else {
    API_BASE = '';               // 端口模式
}

// WebSocket URL 拼接
var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
var url = protocol + '//' + window.location.host + API_BASE + '/ws';
```

**设计要点**：
- 所有 `fetch(API_BASE + '/api/xxx')` 无需修改，网关模式下自动带上前缀
- WebSocket URL 同样跟随 `API_BASE`，网关下走 `/app/fn-appstores-client/ws`
- 页面内所有相对链接（如 `/api/proxy-image`）会被 `PrefixMiddleware` 裁剪，前端不需要单独处理

### 4.4 图片地址包装（v2.6.2 新增）

```javascript
function wrapImageUrl(url) {
    if (!url) return '';
    // 相对路径：拼当前 origin
    if (url.startsWith('/')) {
        return window.location.origin + url;
    }
    // https 页面 + http 图片：走客户端代理，绕开混合内容拦截
    if (window.location.protocol === 'https:' && url.startsWith('http://')) {
        return API_BASE + '/api/proxy-image?url=' + encodeURIComponent(url);
    }
    return url;
}
```

**调用点**（所有图片渲染处都要走这个函数）：
- `renderCarousel` — 首页轮播图
- `renderApps` — 应用卡片图标
- `openDetail` — 详情弹窗图标
- `initCarousel` — 详情页截图列表
- `openImageModal` / `imagePrev` / `imageNext` — 大图预览
- `renderQuickList` — 首页快捷卡片图标

### 4.5 轮播图点击放大（v2.6.2 新增）

```javascript
// renderCarousel 里每个轮播图元素加点击事件
track.innerHTML = images.map(function(url, index) {
    return '<div class="home-carousel-slide" ' +
           'style="background-image:url(' + url + ');cursor:zoom-in;" ' +
           'onclick="openHomeCarouselImage(' + index + ')" ' +
           'title="点击查看大图"></div>';
}).join('');

// 复用已有的大图弹窗
function openHomeCarouselImage(index) {
    if (!homeNoticeData || !homeNoticeData.carousel || homeNoticeData.carousel.length === 0) return;
    openImageModal(homeNoticeData.carousel, index);
}
```

**复用了 `modals.html` 里已有的 `openImageModal`**，无需新增弹窗结构。支持左右方向键切换、ESC 关闭、点遮罩关闭。

**圆点按钮加 `event.stopPropagation()`**：防止点击圆点切换时误触发放大。

### 4.6 首页（`home.html`）

**顶部行**：轮播图（70%）+ 公告记录列表（30%），固定高度 320px

**四列快捷卡片**：
- **已安装**：全部显示
- **可更新**：全部显示（过滤掉 FN软仓自身）
- **热度榜**：按下载量排序，取前 10
- **新应用**：按 `updated_at` 排序，取前 10

### 4.7 应用页（`apps.html`）

- 工具栏：状态 + 应用数量 + 排序下拉框 + 刷新按钮
- 搜索栏
- 固定分类标签（15 个）：全部、影音、办公、下载、AI、设计、社交、网络、工具、生活、商务、教育、效率、开发、游戏
- 应用类型筛选：全部 / Docker应用 / 原生应用
- 按源名称筛选：下拉选择框
- 排序功能：默认排序 / 按名称 / 按下载量 / 按更新时间
- 自适应网格：`grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`
- 每页 8 个应用，分页

### 4.8 设置页（`settings.html`）

标签切换：通用 / 系统 / 关于 / 统计

- **通用**：深色模式开关、导出日志、清除本地缓存
- **系统**：客户端版本、系统架构、检查更新
- **关于**：开发者、开源协议、源码仓库、交流群、聚合申请、QQ群二维码、官方源查询
- **统计**：总应用数、已安装、可更新、已配置源

### 4.9 源管理（`sources.html`）

- 添加源（名称 + 地址 + 测试 + 添加）
- 源列表：
  - **官方源**（`id === 'official'`）：地址显示为 `●●●●●●●`，不渲染启用/禁用按钮
  - **三方源**：按 `enabled` 状态显示「启用」或「禁用」按钮

### 4.10 v2.6.2 核心改动详解

#### 4.10.1 飞牛统一网关（P0）

**问题**：
- 端口模式需单独暴露 5660，与飞牛登录态脱节
- 内网穿透/HTTPS 场景需额外配置
- 无法识别当前用户

**修复**：
- 应用改走 Unix Socket，通过 `/app/fn-appstores-client` 路径访问
- 飞牛系统先校验用户会话，再转发请求到应用
- 自动注入 `X-Trim-Userid` / `X-Trim-Isadmin` / `X-Trim-Username` Header
- WebSocket 复用网关路径，自动适配 `wss://`

**涉及文件**：`app.py`、`cmd/main`、`manifest`、`ui/config`、`index.html`

**关键坑点**：

| 坑 | 原因 | 解决 |
|----|------|------|
| `run_simple('unix://...', None, ...)` 报 `port must be an integer` | werkzeug 内部会转 int | 改用 `make_server(host='unix://'+path, port=0, ...)` |
| `make_server(host=None, ...)` 报 `'NoneType' object has no attribute 'startswith'` | 老版 werkzeug 直接对 host 调 `.startswith()` | 传 `host='unix://' + sock_path` |
| `ui/config` 顶层 key 写成 `url` | 飞牛系统读的是 `.url`（带点） | 顶层 key 必须为 `.url` |
| `app.sock` 被打包进 fpk | socket 是内核对象，复制会失败 | 打包前 `find . -name "app.sock" -delete` |
| fnpack 可视化编辑器入口页空白 | 编辑器 schema 不认 `gatewayPrefix` / `gatewaySocket` | 手写 `ui/config`，命令行 `fnpack build` |

#### 4.10.2 HTTPS 图片代理（P0）

**问题**：
- HTTPS 页面下加载 HTTP 图片，浏览器混合内容拦截
- 服务端是 frp 裸 TCP 穿透，只能 http，无法提供 https
- 轮播图、图标、截图均受影响

**修复**：
- 客户端新增 `/api/proxy-image` 接口，客户端从 http 服务端拉图，转发给前端
- 前端 `wrapImageUrl` 检测到 https 页面 + http 图片时自动走代理
- 白名单仅允许已配置源及聚合源的 host，防 SSRF
- 单张限制 10MB，内存缓存 10 分钟

**数据流**：

```
浏览器(https) → 飞牛网关(https) → 客户端(同源) → http 服务端(拉图) → 返回前端
                                    ↑
                          客户端在飞牛本地，可访问 http
```

**涉及文件**：`app.py`、`index.html`

#### 4.10.3 轮播图点击放大（P1）

**问题**：轮播图内容字多、字小时看不清

**修复**：
- 轮播图加 `cursor:zoom-in` + `onclick` + `title`
- 复用 `openImageModal` 大图弹窗
- 圆点按钮加 `event.stopPropagation()` 防误触

**涉及文件**：`index.html`

#### 4.10.4 端口模式可降级（P1）

**问题**：
- 低版本飞牛系统不认网关字段
- 网关调试阶段需要快速回退

**修复**：
- `cmd/main` 中通过 `FN_SOFT_START_MODE` 环境变量切换
- 默认 `gateway`，设为 `port` 时走端口模式
- `app.py` 里 `START_MODE` 分流，`start_port_mode()` 保留

**涉及文件**：`cmd/main`、`app.py`

#### 4.10.5 生命周期脚本适配网关（P0）

**问题**：
- 网关模式下 socket 生成有时间差，纯 `sleep 2` 检查进程不可靠
- 进程活着但 socket 失效时，应用中心误报"运行中"
- 残留 socket 导致下次启动 bind 失败

**修复**：
- 启动前清理残留 `${TRIM_APPDEST}/app.sock`
- 启动后轮询等待 socket 出现（最多 10 秒）
- socket 生成后 `chmod 660`
- `status` 同时校验进程 + socket
- stop 时清理 socket

**涉及文件**：`cmd/main`


## 五、数据流

### 5.1 应用列表加载（v2.6.2）

```
用户打开软仓（通过网关或端口）
    │
    ▼
index.html 判断 API_BASE（含 GATEWAY_PREFIX → 网关模式）
    │
    ▼
loadApps() 检查缓存（带版本号 + 10分钟 TTL）
    │
    ├─ 有效 → 使用缓存，显示"缓存"状态
    │          │
    │          ▼
    │       restoreAppsView()
    │          ├─ renderFilterButtons()
    │          ├─ renderFilteredApps()
    │          └─ updateSourceFilterOptions()
    │          └─ updateHomeQuickCards()
    │
    └─ 失效 → GET API_BASE + /api/apps
                │
                ▼
            后端 get_all_apps()
                ├─ 检查内存缓存（24小时）
                ├─ 若失效，从所有启用源拉取合并
                ├─ 补全 download_url / icon
                ├─ 标记 installed、installed_version、has_update
                └─ 返回应用列表
                │
                ▼
            前端渲染应用卡片（图标走 wrapImageUrl）
                │
                ▼
            loadInstalledVersions() 更新已安装状态
                │
                ▼
            updateHomeQuickCards()
                │
                ▼
            updateSourceFilterOptions()
                │
                ▼
            sortApps() 应用排序
```

### 5.2 图片加载（v2.6.2）

```
前端渲染图片（轮播图/图标/截图）
    │
    ▼
wrapImageUrl(url)
    │
    ├─ 相对路径 → origin + url
    │
    ├─ HTTP 页面 → 原 url 直连
    │
    └─ HTTPS 页面 + HTTP 图片
         │
         ▼
    API_BASE + '/api/proxy-image?url=' + encodeURIComponent(url)
         │
         ▼
    后端 api_proxy_image()
         ├─ 白名单校验（host 必须在允许列表）
         ├─ 缓存命中 → 直接返回
         ├─ requests.get 拉图（stream）
         ├─ 限制 10MB
         └─ 写入缓存 + 返回给前端
```

### 5.3 安装流程（v2.6.2）

```
用户点击「安装」
    │
    ▼
installApp(appId)
    ├─ 检查 WebSocket 状态
    │  ├─ 未连接 → connectWS() + 2秒后重试
    │  └─ 已连接 → 继续
    ├─ 获取 download_url → API_BASE + /api/app/{appId}
    └─ addInstallTask(appId, downloadUrl)
                │
                ▼
            processInstallQueue()
                ├─ 检查是否有正在执行的任务
                ├─ 检查 WebSocket 是否就绪
                └─ 发送 install 事件到 WebSocket
                │
                ▼
            后端 install_app_with_progress
                ├─ 下载 FPK（流式推送进度 + 百分比）
                ├─ 解压 FPK
                ├─ 检查 wizard/install
                │
                ├─ 有向导 → 推送 wizard.show → 前端弹窗
                │                │
                │                ▼
                │          用户填写 → POST API_BASE + /api/wizard/install
                │
                └─ 无向导 → appcenter-cli install-fpk
                │
                ▼
            前端 handleWsMessage
                ├─ 更新进度条 + 百分比
                ├─ 安装成功后：
                │   ├─ 即时刷新卡片按钮状态（已安装）
                │   ├─ 更新首页快捷卡片
                │   ├─ 更新统计页数据
                │   ├─ 写入缓存
                │   └─ 5秒后整页刷新
                ├─ 安装失败后：
                │   ├─ 按钮恢复为「安装」
                │   └─ 显示错误信息
                └─ 处理下一个安装任务
```


## 六、关键设计决策

### 6.1 飞牛统一网关（v2.6.2 新增）

- 应用监听 Unix Socket，通过 `/app/fn-appstores-client` 路径访问
- 网关系统先校验用户会话，再转发请求到应用
- 网关注入 `X-Trim-Userid` / `X-Trim-Isadmin` / `X-Trim-Username`
- WebSocket 复用同一路径和 socket
- 端口模式保留，通过 `FN_SOFT_START_MODE=port` 降级

### 6.2 图片代理策略（v2.6.2 新增）

- 只代理 `https 页面 + http 图片` 组合，其他情况原样直连
- 白名单来源：已配置源 + 应用列表里出现的所有图片 host
- 单张限制 10MB，10 分钟内存缓存
- 复用 `wrapImageUrl` 统一入口，前端所有图片渲染处都过一遍

### 6.3 树状聚合架构（v2.4.0，服务端主导）

- 客户端保留多源拉取能力，但推荐用户仅使用官方源
- 官方源服务端通过树状聚合自动包含三方源应用
- 客户端通过 `_source_id` 和 `_source_name` 字段识别应用来源

### 6.4 FN 认证标识（v2.4.0，前端展示）

```javascript
if (app._source_id === 'official') {
    prefix = 'FN软仓官方源';
    displayName = '';
} else if (app._source_id && !app._source_id.startsWith('source_')) {
    prefix = '✅FN-';
} else {
    // 用户自添加源，显示原始名称
}
```

| 来源类型 | `_source_id` | 显示效果 |
|---------|-------------|---------|
| 官方源 | `official` | `FN软仓官方源` |
| 认证三方源 | 非 `official` 且非 `source_*` | `✅FN-{源名称}` |
| 用户自添加源 | 以 `source_` 开头 | `{源名称}` |

### 6.5 数据持久化

- 使用飞牛系统注入的 `TRIM_PKGVAR` 环境变量作为数据根目录
- `sources.json`、`app.log` 等用户数据存储于持久化目录
- 应用更新时数据不丢失

### 6.6 模板拆分策略

| 类型 | 存放位置 | 说明 |
|------|---------|------|
| 全局基础样式 | `layout.html` | 所有页面共享 |
| 公共 JavaScript | `index.html` | Toast、应用列表、安装、WebSocket、图片代理等 |
| 页面专属 JS | 各自页面文件 | `home.html`、`settings.html`、`sources.html` |
| 页面样式 | 各自页面文件 | 跟随页面，便于维护 |

### 6.7 半自动更新策略

- 客户端不做自动安装（避免文件占用问题）
- 只负责检测和下载 FPK
- 用户通过飞牛应用中心手动完成安装
- 支持重新下载（文件被误删时）

### 6.8 首页缓存策略

- 公告数据（轮播图 URL + 公告记录）5 分钟内存缓存
- 切换页面秒开，不重复请求
- 网络异常时降级使用过期缓存
- 轮播图图片由浏览器 HTTP 缓存自动处理

### 6.9 WebSocket 统一管理策略（v2.6.1 新增）

- 由 `index.html` 维护唯一全局 `ws` 实例
- 动态协议生成（`ws:` / `wss:`），兼容 HTTPS
- 指数退避重连（最大 10 次，间隔 1.5ⁿ 秒递增至 30 秒）
- 页面关闭/刷新时自动清理资源
- 安装任务队列保证断线重连后请求不丢失

### 6.10 错误降级策略（v2.6.1 新增）

- 应用列表加载失败 → 使用本地缓存（如有）
- 源列表加载失败 → 保留上次成功列表
- 首页公告加载失败 → 使用过期缓存兜底
- 所有场景均显示友好提示，不白屏


## 七、前端 UI 关键逻辑

### 7.1 应用卡片完整结构

```javascript
function renderApps(apps) {
    return apps.map(function(app) {
        // 1. 版本和更新标识
        var versionHtml = '<span class="version-text">v' + version + '</span>';
        if (app.installed && app.has_update) {
            versionHtml += ' <span class="update-badge">⬆ ' + app.version + '</span>';
        }
        if (app.installed && !app.has_update) {
            versionHtml += ' <span class="installed-badge">✓</span>';
        }

        // 2. 来源标签（含 FN 认证标识）
        // 3. 按钮状态
        // 4. 下载统计
        // 5. 进度百分比
    });
}
```

### 7.2 首页快捷卡片渲染

```javascript
function updateHomeQuickCards() {
    if (typeof allAppsData === 'undefined' || !allAppsData || allAppsData.length === 0) {
        ['quickInstalledList', 'quickUpdatableList', 'quickHotList', 'quickNewestList'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="empty">加载中...</div>';
        });
        return;
    }
    // ... 正常渲染
}
```

### 7.3 固定分类标签

```javascript
var FIXED_TAGS = ['全部', '影音', '办公', '下载', 'AI', '设计', '社交', '网络', '工具', '生活', '商务', '教育', '效率', '开发', '游戏'];
```

### 7.4 排序功能

```javascript
function changeSort() {
    var select = document.getElementById('sortSelect');
    if (!select) return;
    currentSort = select.value || 'default';
    currentPage = 1;
    renderFilteredApps();
}
```


## 八、版本对比表（v2.6.1 → v2.6.2）

| 功能/修复 | v2.6.1 | v2.6.2 |
|-----------|--------|--------|
| WebSocket 统一管理 | ✅ | ✅ |
| 安装任务队列 | ✅ | ✅ |
| 缓存读写统一 | ✅ | ✅ |
| 并发加载锁 | ✅ | ✅ |
| DOM 空值保护 | ✅ | ✅ |
| 错误降级与离线缓存 | ✅ | ✅ |
| 应用列表排序 | ✅ | ✅ |
| 安装进度百分比 | ✅ | ✅ |
| 安装即时刷新 | ✅ | ✅ |
| **飞牛统一网关** | ❌ | **✅** |
| **Unix Socket 监听** | ❌ | **✅** |
| **网关注入用户身份** | ❌ | **✅** |
| **HTTPS 图片代理** | ❌ | **✅** |
| **轮播图点击放大** | ❌ | **✅** |
| **端口模式可降级** | ❌ | **✅** |
| **生命周期脚本适配网关** | ❌ | **✅** |


## 九、v2.6.2 更新详解

### 9.1 飞牛统一网关（P0）

**问题**：端口模式需单独暴露 5660，与飞牛登录态脱节，内网穿透/HTTPS 场景需额外配置。

**修复**：应用改走 Unix Socket，通过 `/app/fn-appstores-client` 路径访问，自动获得 HTTPS 适配、登录态复用和桌面图标直达。

**涉及文件**：`app.py`、`cmd/main`、`manifest`、`ui/config`、`index.html`

### 9.2 HTTPS 图片代理（P0）

**问题**：HTTPS 页面下加载 HTTP 图片，浏览器混合内容拦截，轮播图、图标、截图不显示。

**修复**：客户端新增 `/api/proxy-image` 接口，HTTPS 页面下 HTTP 图片自动走同源代理，绕开浏览器混合内容拦截。

**涉及文件**：`app.py`、`index.html`

### 9.3 轮播图点击放大（P1）

**问题**：轮播图内容字多、字小时看不清。

**修复**：轮播图加点击事件，复用已有大图弹窗，支持左右切换、ESC 关闭。

**涉及文件**：`index.html`

### 9.4 生命周期脚本适配网关（P0）

**问题**：网关模式下 socket 生成有时间差，纯 `sleep 2` 检查进程不可靠；残留 socket 导致下次启动失败。

**修复**：启动前清理 socket，启动后轮询等待 socket 生成（最多 10 秒），`status` 同时校验进程 + socket，stop 时清理 socket。

**涉及文件**：`cmd/main`

### 9.5 端口模式可降级（P1）

**问题**：低版本飞牛系统不认网关字段，或调试阶段需要快速回退。

**修复**：`cmd/main` 中通过 `FN_SOFT_START_MODE=port` 环境变量切换，`app.py` 里 `START_MODE` 分流保留端口模式。

**涉及文件**：`cmd/main`、`app.py`


## 十、部署与运维

### 10.1 打包命令

```bash
# 1. 编译 pyc
cd app/server
python3 -m py_compile app.py
cp __pycache__/app.cpython-*.pyc app.pyc
rm -rf __pycache__

# 2. 清理运行时残留（必须，否则打包报错）
cd ../..
find . -name "app.sock" -delete
find . -name "app.pid" -delete
find . -name "app.log" -delete
find . -name ".DS_Store" -delete
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find . -type d -name "data" -path "*/server/*" -exec rm -rf {} + 2>/dev/null

# 3. 打包
fnpack build
```

### 10.2 输出文件

```
fn-appstores-client.fpk
```

### 10.3 日志查看

```bash
cat /vol*/@appdata/fn-appstores-client/app.log
```

启动日志会打印：

```
🔗 启动模式: 统一网关
   网关前缀: /app/fn-appstores-client
   Unix Socket: /vol*/@appcenter/fn-appstores-client/target/app.sock
```

### 10.4 版本号维护（v2.6.2）

| 文件 | 位置 | 说明 |
|------|------|------|
| `manifest` | `version = 2.6.2` | 飞牛应用版本 |
| `layout.html` | 左下角 | 动态渲染 `{{ version }}`，无需手动修改 |
| `app.py` | `get_app_version()` 回退值 | 兜底版本号（`2.6.2`） |

### 10.5 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TRIM_APPVER` | 应用版本号（飞牛系统注入） | 从 manifest 读取 |
| `TRIM_PKGVAR` | 数据持久化目录 | `/vol*/@appdata/fn-appstores-client/` |
| `TRIM_APPDEST` | 应用可执行文件目录 | `/vol*/@appcenter/fn-appstores-client/target/` |
| `START_MODE` | 启动模式（`gateway` / `port`） | `gateway` |
| `FN_SOFT_START_MODE` | 环境变量覆盖启动模式 | 空（用 `START_MODE`） |

### 10.6 网关注入的用户 Header

| Header | 说明 | 示例 |
|--------|------|------|
| `X-Trim-Userid` | 当前用户 UID | `1000` |
| `X-Trim-Isadmin` | 是否管理员 | `true` / `false` |
| `X-Trim-Username` | 用户名 | `admin` |

### 10.7 官方源需要配置的内容

为了让客户端自更新正常工作，官方源的 `fn-appstores.json` 中需要包含：

```json
{
  "id": "fn-appstores-client",
  "name": "FN软仓客户端",
  "version": "2.6.2",
  "download_url": "http://rc.hhxs2026.top:5660/apps/fn-appstores-client-2.6.2.fpk"
}
```


## 十一、公告编辑器（独立工具）

`notice_generator1.5.py` 是用于生成公告数据的图形化工具，**非客户端内置组件**。

**v1.5 适配 v2.5.0+ 客户端**：
- 支持编辑 `records` 数组（日期 + 标题 + 内容）
- 支持管理轮播图列表
- `interval` 字段保留但客户端忽略


## 十二、常见问题排查指南（v2.6.2）

| 问题 | 可能原因 | 排查方法 |
|------|---------|---------|
| 应用已安装但显示"安装" | 大小写不匹配 / 目录名与 id 不一致 | 检查 `/vol*/@appcenter/` 目录名与 app.id 是否一致（忽略大小写） |
| 向导应用安装失败 | 环境变量未正确写入 | 查看日志中 `wizard.env` 内容；检查 `appcenter-cli` 输出 |
| 三方源来源标签显示官方源 | 客户端版本低于 v2.3.2 | 升级客户端至 v2.6.2 |
| 可更新卡片为空 | `loadInstalledVersions` 完成后未刷新卡片 | 升级至 v2.5.1+ |
| 新应用卡片排序失效 | 服务端自动补全 `updated_at` 为当前日期 | 移除服务端自动补全逻辑 |
| sources.json 更新后丢失 | `DATA_DIR` 未指向 `TRIM_PKGVAR` | 升级至 v2.5.1+ |
| 客户端自身出现在应用列表 | 未过滤 `fn-appstores-client` | 升级至 v2.5.1+ |
| 首页加载慢或需切换才显示 | `loadHome` 等待 `allAppsData` | 升级至 v2.5.1+ |
| WebSocket 连接失败 | 双定义冲突 / 协议不匹配 | 升级至 v2.6.1+ |
| 安装请求丢失 | WebSocket 断线重连时无队列 | 升级至 v2.6.1+ |
| 缓存数据不一致 | 多处读写缓存无统一入口 | 升级至 v2.6.1+ |
| 切换页面时重复请求 | 无加载状态锁 | 升级至 v2.6.1+ |
| 页面点击无反应或白屏 | DOM 元素缺失导致脚本中断 | 升级至 v2.6.1+ |
| 网络抖动时页面空白 | 无错误降级 | 升级至 v2.6.1+ |
| **升级后桌面无图标** | `ui/config` 顶层 key 写成 `url`（应为 `.url`） | 检查 `ui/config` 结构 |
| **网关模式下 WebSocket 连不上** | URL 未带网关前缀 | 检查 `API_BASE` 判断逻辑 |
| **HTTPS 页面轮播图/图标不显示** | 未走图片代理 | DevTools 筛选 `proxy-image` 请求 |
| **打包报 `app.sock: no such device or address`** | 源码目录残留 socket 文件 | 打包前 `find . -name "app.sock" -delete` |
| **fnpack 可视化编辑器入口页空白** | 编辑器 schema 不认网关字段 | 手写 `ui/config`，命令行打包 |
| **系统版本低于 1.2.0401 装不上** | 网关需系统 ≥ 1.2.0401 | 降级 `FN_SOFT_START_MODE=port` |


## 十三、v2.6.2 稳定性改进总结

| 改进类别 | 具体修复 | 影响范围 |
|---------|---------|---------|
| **连接方式** | 端口 → Unix Socket 统一网关 | 访问方式、登录态、HTTPS |
| **图片显示** | HTTPS 页面下 HTTP 图片走客户端代理 | 轮播图/图标/截图在混合内容场景的可用性 |
| **交互体验** | 轮播图点击放大 | 首页可读性 |
| **生命周期** | socket 清理、等待生成、双条件 status | 应用中心状态准确性、网关连通性 |
| **兼容性** | 端口模式保留，环境变量切换 | 低版本系统、调试场景 |
| **打包流程** | 必须清理运行时残留 socket | 打包成功率 |