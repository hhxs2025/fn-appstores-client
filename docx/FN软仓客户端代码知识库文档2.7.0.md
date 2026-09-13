# FN软仓客户端 代码知识库文档

> 本文档用于记录 FN软仓客户端 v2.7.0 的代码结构、核心逻辑和版本演进，便于后续开发和维护。


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
| **v2.6.1** | WebSocket 统一管理 + 安装任务队列 + 缓存读写统一 + 并发加载锁 + DOM 空值保护全面加固 + 错误降级与离线缓存增强 | 已发布 |
| **v2.6.2** | 飞牛统一网关 + HTTPS 图片代理 + 轮播图点击放大 + 端口模式可降级 | 已发布 |
| **v2.7.0** | **后端 Go 重写**（Gin） + **开发者星球 3D 可视化** + **独立安装进度弹窗** + **安装超时强制复位** + **类型容错** | **当前版本** |

> **架构说明**：v2.3.2+ 配合服务端 v2.4.0+ 使用，服务端采用**树状聚合架构**，官方源可聚合三方源应用，客户端无需额外配置即可发现更多应用。
> **网关说明**：v2.6.2+ 接入飞牛统一网关，应用改走 Unix Socket，通过 `/app/fn-appstores-client` 路径访问，自动获得 HTTPS 适配与登录态复用。
> **重写说明**：v2.7.0 后端从 Python 迁移到 Go，性能与部署体验提升，前端保留全部既有能力并新增开发者星球与安装进度弹窗。


## 二、整体架构

### 2.1 角色定位

客户端是运行在飞牛 NAS 上的 Web 应用，作为用户界面，聚合多个软件源的应用列表，提供应用浏览、安装、更新、源管理等功能。

### 2.2 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Web 框架 | Gin | Go 轻量级 Web 框架 |
| WebSocket | gorilla/websocket | 实时推送安装进度，复用网关路径 `/app/fn-appstores-client/ws` |
| 前端 | HTML + CSS + JavaScript | 支持本地缓存 |
| 模板引擎 | Go `html/template` | 服务端渲染 |
| 数据存储 | JSON | 源配置（`sources.json`） |
| 日志 | 文本文件 | `app.log`（自动轮转，保留 400 行） |
| 进程通信 | Unix Domain Socket | `TRIM_APPDEST/app.sock` |
| 编译产物 | Go 原生二进制 | 无运行时依赖，支持 amd64 / arm64 |

### 2.3 项目结构（v2.7.0）

```
fn-appstores-client/
├── app/
│   ├── manifest                  # 飞牛应用清单（无 service_port）
│   ├── cmd/
│   │   └── main                  # 生命周期脚本（网关模式启动）
│   ├── config/
│   │   ├── privilege
│   │   └── resource
│   ├── server/                   # ★ Go 后端
│   │   ├── main.go               # 入口
│   │   ├── config.go             # 配置与环境变量
│   │   ├── gateway.go            # 路由注册 + 网关/端口模式
│   │   ├── apps.go               # 应用列表 + 多源聚合 + 已安装检测
│   │   ├── sources.go            # 源管理
│   │   ├── install.go            # 安装 + 进度推送
│   │   ├── wizard.go             # 向导会话
│   │   ├── proxy.go              # 图片代理
│   │   ├── handlers.go           # 公告 + 自更新 + 日志
│   │   ├── websocket.go          # WebSocket 处理
│   │   ├── utils.go              # 版本比较 + 类型容错 + 日志
│   │   ├── go.mod
│   │   └── templates/
│   │       ├── layout.html       # 主布局
│   │       ├── index.html        # 入口（{{template "content"}}）
│   │       ├── home.html         # 首页
│   │       ├── apps.html         # 应用列表
│   │       ├── developers.html   # ★ 开发者星球（新增）
│   │       ├── sources.html      # 源管理
│   │       ├── settings.html     # 设置页
│   │       └── modals.html       # 弹窗合集
│   └── ui/
│       ├── config                # 应用入口（.url + gatewayPrefix + gatewaySocket）
│       └── images/
│           ├── icon_64.png
│           └── icon_256.png
├── ICON.PNG
└── ICON_256.PNG
```

**v2.7.0 改动文件清单**：

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/*.go` | 全部新增 | 后端从 Python 迁移到 Go |
| `server/templates/*.html` | 语法改写 | Jinja2 → Go template |
| `server/templates/developers.html` | 新增 | 开发者星球 3D 可视化 |
| `server/templates/modals.html` | 新增 | 独立安装进度弹窗 |
| `layout.html` | 修改 | 侧边栏新增「开发者」项 |
| `cmd/main` | 修改 | 改为启动 Go 二进制 |


## 三、核心模块与函数（Go 后端）

### 3.1 配置模块（`config.go`）

```go
// 全局配置变量
var (
    BaseDir   string
    DataDir   string
    StartMode string
    Port      int
    Version   string
)

const (
    GatewayPrefix      = "/app/fn-appstores-client"
    GatewaySocketName  = "app.sock"
    DefaultPort        = 5660
    DefaultVersion     = "2.7.0"
    DefaultOfficialURL = "http://rc.hhxs2026.top:5660"
    SourceCacheTTL     = 300
    AppCacheTTL        = 86400
    ImageCacheTTL      = 600
    ImageMaxSize       = 10 * 1024 * 1024
)

// 初始化配置
func initConfig() {
    // BaseDir 从可执行文件目录推导
    // DataDir 从 TRIM_PKGVAR 读取，回退到 BaseDir/data
    // StartMode 从 START_MODE 读取，默认 gateway
    // Version 优先 TRIM_APPVER，其次读 manifest，最后兜底 DefaultVersion
}

// detectVersion 优先 TRIM_APPVER，其次读 manifest
func detectVersion() string {
    // 优先级：环境变量 TRIM_APPVER > /var/apps/{appname}/manifest > BaseDir/manifest > DefaultVersion
}
```

### 3.2 网关模式（`gateway.go`）

```go
func registerRoutes(rg *gin.RouterGroup) {
    rg.GET("/", IndexPage)
    rg.GET("/api/apps", APIApps)
    rg.HEAD("/api/apps", APIApps)
    rg.POST("/api/refresh", APIRefresh)
    rg.GET("/api/installed", APIInstalled)
    rg.GET("/api/app/:app_id", APIAppDetail)
    rg.GET("/api/sources", APISources)
    rg.POST("/api/sources/add", APIAddSource)
    rg.POST("/api/sources/remove", APIRemoveSource)
    rg.POST("/api/sources/toggle", APIToggleSource)
    rg.POST("/api/sources/test", APITestSource)
    rg.GET("/api/notice", APINotice)
    rg.GET("/api/check-update", APICheckUpdate)
    rg.GET("/api/proxy-image", APIProxyImage)
    rg.GET("/api/logs", APILogs)
    rg.GET("/api/logs/export", APILogsExport)
    rg.GET("/api/gateway-user", APIGatewayUser)
    rg.POST("/api/wizard/install", APIWizardInstall)
    rg.POST("/api/wizard/cancel", APIWizardCancel)
    rg.GET("/ws", HandleWS)
}

// ★ v2.7.0 关键改进：网关模式下同时注册"挂根"和"带前缀"两套路由
// 兼容网关"保留前缀"/"剥掉前缀"两种转发方式
func buildRouter(prefix string) *gin.Engine {
    gin.SetMode(gin.ReleaseMode)
    r := gin.New()
    r.Use(gin.Recovery())
    r.LoadHTMLGlob("templates/*.html")

    if prefix == "" {
        r.Static("/static", "./static")
        registerRoutes(r.Group(""))
    } else {
        r.Static("/static", "./static")
        r.Static(prefix+"/static", "./static")

        registerRoutes(r.Group(""))        // 挂根注册（网关剥前缀时命中）
        registerRoutes(r.Group(prefix))    // 带前缀注册（网关保留前缀时命中）
    }
    return r
}

// 统一网关模式：直接 net.Listen("unix", sockPath)
func startGatewayMode() {
    appdest := os.Getenv("TRIM_APPDEST")
    if appdest == "" {
        appdest = BaseDir
    }
    sockPath := filepath.Join(appdest, GatewaySocketName)

    if len(sockPath) > 100 {
        sockPath = fmt.Sprintf("/tmp/fn-soft-%d.sock", os.Getpid())
    }

    if _, err := os.Stat(sockPath); err == nil {
        os.Remove(sockPath)
    }

    router := buildRouter(GatewayPrefix)

    ln, err := net.Listen("unix", sockPath)
    if err != nil {
        log.Printf("❌ Unix Socket 监听失败: %v，回退端口模式", err)
        startPortMode()
        return
    }
    os.Chmod(sockPath, 0660)

    log.Printf("🔗 统一网关模式: %s → %s", GatewayPrefix, sockPath)
    http.Serve(ln, router)
}
```

**设计要点**：

- 相比 Python 版的 `PrefixMiddleware` 手动剥前缀，Go 版直接双注册，**更稳妥**
- 网关无论保留前缀还是剥前缀，都能命中对应路由
- 静态资源 `/static` 也同时注册两种路径

### 3.3 应用管理（`apps.go`）

```go
type App struct {
    ID          string          `json:"id"`
    Name        string          `json:"name"`
    Version     string          `json:"version"`
    Desc        string          `json:"desc,omitempty"`
    Author      string          `json:"author,omitempty"`
    Tags        string          `json:"tags,omitempty"`
    Repo        string          `json:"repo,omitempty"`
    UpdatedAt   string          `json:"updated_at,omitempty"`
    DownloadURL string          `json:"download_url,omitempty"`
    Icon        string          `json:"icon,omitempty"`
    Screenshots ScreenshotsFlex `json:"screenshots,omitempty"`
    Type        string          `json:"type,omitempty"`
    Arch        string          `json:"arch,omitempty"`
    SortOrder   SortOrderFlex   `json:"sort_order"`
    Downloads   int64           `json:"downloads,omitempty"`      // ★ v2.7.0 新增

    Installed        bool   `json:"installed,omitempty"`
    InstalledVersion string `json:"installed_version,omitempty"`
    HasUpdate        bool   `json:"has_update,omitempty"`

    SourceName string `json:"_source_name,omitempty"`
    SourceURL  string `json:"_source_url,omitempty"`
    SourceID   string `json:"_source_id,omitempty"`
}

// 多源并发拉取
func MergeAppsFromSources() []App {
    // goroutine + channel 并发拉取所有启用源
    // 按 id + arch 去重，保留版本较高的
}

// 汇总 + 缓存
func GetAllApps(force bool) []App {
    // 24 小时内存缓存
    // 补全 download_url / icon
    // 标记 installed / installed_version / has_update
    // 按 sort_order 降序，再按 updated_at 降序
}
```

### 3.4 安装执行（`install.go`）

```go
// ProgressSender 接口，解耦 WebSocket 与 HTTP
type ProgressSender interface {
    Send(event string, data interface{}) error
}

// 下载 + 进度推送
// ★ 关键改进：CheckRedirect 在 302 到 Gitee 后重新补 Referer / UA
//   Go 默认跨域会清掉 Referer，导致 Gitee 限速
func downloadWithProgress(url, dst, appID string, sender ProgressSender) error {
    const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    client := &http.Client{
        Timeout: 1800 * time.Second,   // 30 分钟
        CheckRedirect: func(req *http.Request, via []*http.Request) error {
            if len(via) >= 10 {
                return fmt.Errorf("重定向次数过多")
            }
            req.Header.Set("User-Agent", browserUA)
            req.Header.Set("Referer", "https://gitee.com/")
            req.Header.Set("Accept", "*/*")
            req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
            return nil
        },
    }

    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("User-Agent", browserUA)
    req.Header.Set("Referer", "https://gitee.com/")
    // ...

    // 64KB 缓冲区（比 Python 版的 8KB 快）
    // 进度推送包含 downloaded / total 字节数字段
}
```

### 3.5 类型容错（`utils.go`）

Go 强类型，但外部 JSON 可能字段类型不一致，新增两个自定义 Unmarshal：

```go
// sort_order 可能是 int 也可能是 string
type SortOrderFlex int

func (s *SortOrderFlex) UnmarshalJSON(data []byte) error {
    var n int
    if err := json.Unmarshal(data, &n); err == nil {
        *s = SortOrderFlex(n)
        return nil
    }
    var str string
    if err := json.Unmarshal(data, &str); err == nil {
        if v, err2 := strconv.Atoi(str); err2 == nil {
            *s = SortOrderFlex(v)
            return nil
        }
    }
    *s = 0
    return nil
}

// screenshots 可能是 []string 也可能是 string
type ScreenshotsFlex []string

func (s *ScreenshotsFlex) UnmarshalJSON(data []byte) error {
    var arr []string
    if err := json.Unmarshal(data, &arr); err == nil {
        *s = arr
        return nil
    }
    var str string
    if err := json.Unmarshal(data, &str); err == nil {
        if str != "" {
            *s = []string{str}
        } else {
            *s = []string{}
        }
        return nil
    }
    *s = []string{}
    return nil
}
```

### 3.6 版本比较增强

```go
// 支持 v/V 前缀，支持 . - _ 空格分隔，支持带后缀的版本（如 1.0.0-beta）
var versionSegRe = regexp.MustCompile(`[.\-_\s]+`)
var digitsRe = regexp.MustCompile(`\d+`)

func CompareVersions(v1, v2 string) int {
    if v1 == "" || v2 == "" {
        return 0
    }
    p1 := parseVersionParts(v1)
    p2 := parseVersionParts(v2)
    // 逐段比较
}
```

### 3.7 图片代理（`proxy.go`）

```go
// 白名单：已配置源 host + 应用列表里所有 icon/screenshots host + 本地
// 60 秒白名单缓存
// 10 分钟图片缓存
// 单张 10MB 限制

func APIProxyImage(c *gin.Context) {
    rawURL := c.Query("url")
    imgURL, err := url.QueryUnescape(rawURL)
    // ...
    if !isAllowedHost(extractHost(imgURL)) {
        c.String(403, "")
        return
    }
    // 缓存命中 → 直接返回
    // 否则 http.Get 拉图 + 大小限制 + 写入缓存
}
```

### 3.8 网关用户上下文

```go
func APIGatewayUser(c *gin.Context) {
    uid := c.GetHeader("X-Trim-Userid")
    if uid == "" {
        c.JSON(200, gin.H{"success": false, "message": "未通过统一网关访问"})
        return
    }
    c.JSON(200, gin.H{
        "success": true,
        "data": gin.H{
            "uid":      uid,
            "is_admin": strings.EqualFold(c.GetHeader("X-Trim-Isadmin"), "true"),
            "username": c.GetHeader("X-Trim-Username"),
        },
    })
}
```

### 3.9 向导会话（`wizard.go`）

```go
type WizardSession struct {
    AppID      string
    FPKPath    string
    TmpDir     string
    ExtractDir string
    Config     interface{}
    CreatedAt  time.Time
}

// ★ v2.7.0 新增：每 10 分钟清理超 30 分钟的过期会话
func cleanupOldSessions() {
    wizardMu.Lock()
    defer wizardMu.Unlock()
    cutoff := time.Now().Add(-30 * time.Minute)
    for id, s := range wizardSessions {
        if s.CreatedAt.Before(cutoff) {
            os.RemoveAll(s.TmpDir)
            delete(wizardSessions, id)
        }
    }
}
```

### 3.10 限流与日志

与 Python 版一致：

- 刷新：60 秒内最多 5 次
- 安装：300 秒内最多 5 次
- 日志：超过 200KB 时保留最后 400 行
- 日志脱敏：URL 替换为 `[*****]`


## 四、前端核心模块（v2.7.0）

### 4.1 布局结构（`layout.html`）

**左侧导航**：首页、应用、**开发者**（v2.7.0 新增）、源管理、设置（5项）

- 桌面端：140px 宽，文字加粗（600），字号 14px
- 窄屏（≤1100px）：仅显示单字（首/应/开/源/设）
- 移动端（≤768px）：汉堡菜单展开，宽度 100px

**默认页面**：首页（`switchTab('home')`）

### 4.2 模板语法变化

| 类型 | v2.6.2（Jinja2） | v2.7.0（Go template） |
|------|-----------------|----------------------|
| 嵌入模板 | `{% include "home.html" %}` | `{{template "home" .}}` |
| 定义模板 | 无包裹，直接写 | `{{define "home"}}...{{end}}` |
| 变量 | `{{ version }}` | `{{.Version}}` |

### 4.3 开发者星球（`developers.html`）★ 新增

**核心亮点**：3D 球形可视化，把开发者映射到球面上的星星。

**核心算法**：

```javascript
// 斐波那契球面均匀分布
function fibSpherePoint(i, n) {
    var phi = Math.acos(1 - 2 * (i + 0.5) / n);
    var theta = Math.PI * (1 + Math.sqrt(5)) * i;
    return {
        nx: Math.cos(theta) * Math.sin(phi),
        ny: Math.sin(theta) * Math.sin(phi),
        nz: Math.cos(phi)
    };
}

// 3D 投影：绕 Y 轴 → 绕 X 轴 → 透视
```

**视觉设计**：

- 每颗星独立呼吸相位和速度（5~9 秒周期）
- 十字星芒 + 径向渐变光晕 + 核心三层叠加
- 三种配色区分开发者类型：
  - 官方开发者：金白色系 `rgb(255, 215, 120)`
  - 认证开发者：蓝白色系 `rgb(180, 215, 255)`
  - 个人开发者：纯白偏冷 `rgb(235, 240, 250)`
- 星星大小与开发者应用数挂钩（`3.2 + Math.sqrt(count) * 1.15`）
- 180 颗背景散星带独立闪烁
- 中心光晕呼吸

**交互**：

- 拖动旋转（X 轴限位 ±80°）
- 滚轮缩放（0.55 ~ 2.0 倍）
- 悬停显示 tooltip（开发者名 + 应用数 + 类型）
- 点击打开开发者详情弹窗
- 自动旋转（`0.00006 rad/ms`）+ 轻微 X 轴摆动

**窄屏降级**：<900px 时隐藏球体，切换为卡片网格布局。

**性能优化**：

- Tab 未激活时降帧（500ms 检查一次）
- 深度排序（远 → 近）
- 悬停检测用缓存坐标

**开发者详情弹窗**：头像、应用数、总下载、最近更新、应用列表（点击可跳转详情）。

### 4.4 独立安装进度弹窗（`modals.html`）★ 新增

v2.6.2 只能在卡片上看到细进度条，v2.7.0 增加了独立弹窗。

**结构**：

- 大图标 + 应用名 + 当前阶段
- 大百分比数字（20px）
- 进度条（渐变蓝 / 绿 / 红）
- 速度 + 已下载/总大小详情
- 成功后自动关闭（3 秒）
- 失败时保留并显示错误信息

**新增函数**：

```javascript
function showInstallModal(appId, appName, appVersion, iconUrl) {...}
function updateInstallModalProgress(data) {...}
function setInstallModalResult(success, message) {...}
function closeInstallModal() {...}
```

### 4.5 WebSocket 安装任务优化

| 项 | v2.6.2 | v2.7.0 |
|----|--------|--------|
| 安装超时 | 无 | 30 分钟强制复位队列 |
| WebSocket 重连 | 复位 `isInstalling` | 同 + 清除超时定时器 |
| 向导弹出 | 保留队列状态 | 重置 `isInstalling` 并处理下一个任务 |
| 安装弹窗 | 无 | 弹出 + 更新 + 结果 |

新增 `installTimeoutTimer` 全局变量：

```javascript
function processInstallQueue() {
    // ...
    if (installTimeoutTimer) clearTimeout(installTimeoutTimer);
    installTimeoutTimer = setTimeout(function() {
        console.warn('⚠️ 安装任务超时 30 分钟，强制复位队列');
        isInstalling = false;
        installTimeoutTimer = null;
        processInstallQueue();
    }, 30 * 60 * 1000);
    // ...
}
```

### 4.6 统一网关适配

与 v2.6.2 相同：

```javascript
var GATEWAY_PREFIX = '/app/fn-appstores-client';
var API_BASE = '';
if (window.location.pathname.indexOf(GATEWAY_PREFIX) === 0) {
    API_BASE = GATEWAY_PREFIX;
}
```

### 4.7 图片地址包装

与 v2.6.2 相同：`wrapImageUrl()` 统一处理 HTTPS 页面下的 HTTP 图片。

### 4.8 轮播图点击放大

与 v2.6.2 相同：`openHomeCarouselImage(index)` 复用大图弹窗。

### 4.9 其他页面

- **首页**：轮播图 + 公告记录 + 四列快捷卡片（与 v2.6.2 一致）
- **应用页**：工具栏 + 搜索 + 分类标签 + 类型筛选 + 源筛选 + 排序 + 分页（与 v2.6.2 一致）
- **设置页**：通用 / 系统 / 关于 / 统计（与 v2.6.2 一致）
- **源管理**：添加 / 测试 / 启用 / 禁用 / 删除（与 v2.6.2 一致）


## 五、v2.7.0 核心改动详解

### 5.1 后端 Go 重写（P0）

**原因**：
- Python 运行时及第三方依赖在启动速度、内存占用与并发处理上存在瓶颈
- 需产出 amd64 / arm64 双架构产物
- 单二进制无运行时依赖，部署更稳定

**效果**：

| 项 | Python | Go |
|----|--------|-----|
| 启动时间 | 1~2 秒 | <100ms |
| 常驻内存 | ~50MB | ~15MB |
| 并发模型 | 线程 + GIL | goroutine |
| 部署依赖 | Python + vendor | 单二进制 |
| 交叉编译 | 无 | `GOARCH=arm64` 直接出 ARM 版 |

**涉及文件**：`server/` 下全部 `.go` 文件 + `templates/` 全部改写为 Go template

### 5.2 开发者星球（P0）

**问题**：应用列表页面只能罗列应用，缺少对开发者的直观呈现

**修复**：

- 新增 `developers.html`，用 3D 球面可视化开发者
- 侧边栏新增「开发者」导航项
- 从 `allAppsData` 聚合开发者数据（应用数、总下载、最近更新）
- 三种颜色区分官方 / 认证 / 个人开发者
- 自动旋转 + 拖动 + 缩放 + 悬停 + 点击详情

**涉及文件**：`templates/developers.html`、`templates/layout.html`、`templates/index.html`

### 5.3 独立安装进度弹窗（P0）

**问题**：v2.6.2 只在卡片上显示细进度条，不够直观，切页或滚动后看不到进度

**修复**：

- 新增独立安装进度弹窗
- 大图标 + 应用名 + 大百分比数字 + 速度详情
- 成功 3 秒自动关闭，失败保留显示

**涉及文件**：`templates/modals.html`、`templates/index.html`

### 5.4 安装超时强制复位（P1）

**问题**：WebSocket 断线或服务端卡死时，`isInstalling` 永远为 true，队列不再执行

**修复**：30 分钟安装超时定时器，超时强制复位

**涉及文件**：`templates/index.html`

### 5.5 类型容错（P1）

**问题**：Go 强类型，外部 JSON 字段可能是 `int` 或 `string`，解析失败会导致整个列表加载不出来

**修复**：`SortOrderFlex` 和 `ScreenshotsFlex` 自定义 `UnmarshalJSON`

**涉及文件**：`server/utils.go`

### 5.6 网关双注册（P1）

**问题**：网关有时保留前缀、有时剥掉前缀，Python 版靠 `PrefixMiddleware` 硬裁，不同网关行为下可能失效

**修复**：Go 版 `buildRouter()` 在网关模式下**同时注册两套路由**（挂根 + 带前缀），无论网关怎么转发都能命中

**涉及文件**：`server/gateway.go`

### 5.7 向导会话清理（P1）

**问题**：用户打开向导后不提交也不取消，临时目录和 session 一直留着

**修复**：每 10 分钟扫描一次，清理超 30 分钟的会话

**涉及文件**：`server/wizard.go`


## 六、数据流

### 6.1 应用列表加载

```
用户打开软仓
    │
    ▼
index.html 判断 API_BASE（含 GATEWAY_PREFIX → 网关模式）
    │
    ▼
loadApps() 检查缓存（带版本号 + 10分钟 TTL）
    │
    ├─ 有效 → 使用缓存，显示"缓存"状态
    │
    └─ 失效 → GET API_BASE + /api/apps
                │
                ▼
            Go 后端 GetAllApps()
                ├─ 检查内存缓存（24小时）
                ├─ 若失效，goroutine 并发拉取所有启用源
                ├─ 按 id + arch 去重，保留高版本
                ├─ 补全 download_url / icon
                ├─ 标记 installed、installed_version、has_update
                └─ 返回应用列表
                │
                ▼
            前端渲染（图标走 wrapImageUrl）
```

### 6.2 安装流程

```
用户点击「安装」
    │
    ▼
installApp(appId)
    ├─ 获取 download_url → API_BASE + /api/app/{appId}
    ├─ showInstallModal()  ★ 弹出独立进度弹窗
    └─ addInstallTask(appId, downloadUrl)
                │
                ▼
            processInstallQueue()
                ├─ 设置 30 分钟超时定时器
                └─ 发送 install 事件到 WebSocket
                │
                ▼
            Go 后端 InstallAppWithProgress
                ├─ downloadWithProgress() 下载 FPK（流式推送进度 + 下载字节数）
                ├─ ExtractFPK() 解压
                ├─ 检查 wizard/install
                │
                ├─ 有向导 → 推送 wizard.show → 前端弹窗
                │
                └─ 无向导 → appcenter-cli install-fpk
                │
                ▼
            前端 handleWsMessage
                ├─ updateInstallModalProgress() ★ 更新独立弹窗
                ├─ 安装成功后：
                │   ├─ setInstallModalResult(true) ★ 显示成功
                │   ├─ 即时刷新卡片按钮状态
                │   ├─ 更新首页快捷卡片 + 统计
                │   ├─ 写入缓存
                │   └─ 5 秒后整页刷新
                └─ 安装失败后：
                    ├─ setInstallModalResult(false) ★ 显示失败
                    └─ 按钮恢复
```

### 6.3 开发者星球渲染

```
用户点击侧边栏「开发者」
    │
    ▼
switchTab('developers')
    │
    ▼
renderDevelopers()
    ├─ buildDeveloperData() 从 allAppsData 聚合
    ├─ 窗口宽 ≥ 900px → startSphere(devs)
    │   ├─ sphereResize() 计算画布尺寸
    │   ├─ initStars() 斐波那契球面分布 + 背景散星
    │   └─ sphereRenderLoop() 启动 requestAnimationFrame
    └─ 否则 → renderGridFallback() 卡片列表
```


## 七、关键设计决策

### 7.1 后端 Go 化（v2.7.0 新增）

- 使用 Gin 作为 Web 框架
- 使用 gorilla/websocket 处理实时推送
- 单二进制产物，无运行时依赖
- 支持 amd64 / arm64 交叉编译

### 7.2 网关双注册策略（v2.7.0 新增）

- 不依赖中间件剥前缀，直接注册两套路由
- 兼容网关"保留前缀"和"剥掉前缀"两种行为
- 静态资源也双路径注册

### 7.3 开发者星球可视化（v2.7.0 新增）

- 纯 Canvas 2D 手写 3D 投影（无第三方库）
- 斐波那契球面均匀分布
- 每颗星独立呼吸相位和速度
- 三种配色区分开发者类型
- 窄屏自动降级为卡片列表

### 7.4 安装弹窗与卡片进度双显示（v2.7.0 新增）

- 独立弹窗：聚焦单次安装，视觉突出
- 卡片进度：列表中同时可见
- 两者独立更新，互不干扰

### 7.5 类型容错（v2.7.0 新增）

- `SortOrderFlex` / `ScreenshotsFlex` 兼容多类型
- 避免单个字段类型异常导致整个列表解析失败

### 7.6 树状聚合架构（v2.4.0，服务端主导）

- 客户端保留多源拉取能力，但推荐用户仅使用官方源
- 官方源服务端通过树状聚合自动包含三方源应用
- 客户端通过 `_source_id` 和 `_source_name` 字段识别应用来源

### 7.7 FN 认证标识（v2.4.0，前端展示）

| 来源类型 | `_source_id` | 显示效果 |
|---------|-------------|---------|
| 官方源 | `official` | `FN软仓官方源` |
| 认证三方源 | 非 `official` 且非 `source_*` | `✅FN-{源名称}` |
| 用户自添加源 | 以 `source_` 开头 | `{源名称}` |

### 7.8 数据持久化

- 使用飞牛系统注入的 `TRIM_PKGVAR` 环境变量作为数据根目录
- `sources.json`、`app.log` 等用户数据存储于持久化目录

### 7.9 模板拆分策略

| 类型 | 存放位置 | 说明 |
|------|---------|------|
| 全局基础样式 | `layout.html` | 所有页面共享 |
| 公共 JavaScript | `index.html` | Toast、应用列表、安装、WebSocket、图片代理等 |
| 页面专属 JS | 各自页面文件 | `home.html`、`developers.html`、`settings.html`、`sources.html` |

### 7.10 半自动更新策略

- 客户端不做自动安装（避免文件占用问题）
- 只负责检测和下载 FPK
- 用户通过飞牛应用中心手动完成安装

### 7.11 WebSocket 统一管理策略

- 由 `index.html` 维护唯一全局 `ws` 实例
- 动态协议生成（`ws:` / `wss:`）
- 指数退避重连（最大 10 次，1.5ⁿ 秒递增至 30 秒）
- 安装任务队列保证断线重连后请求不丢失
- v2.7.0 新增 30 分钟安装超时强制复位


## 八、版本对比表（v2.6.2 → v2.7.0）

| 功能/修复 | v2.6.2 | v2.7.0 |
|-----------|--------|--------|
| 后端语言 | Python | **Go** |
| Web 框架 | Flask | **Gin** |
| 模板引擎 | Jinja2 | **Go html/template** |
| 部署形态 | Python 运行时 + vendor | **单二进制** |
| 跨平台 | 依赖 Python | **amd64 / arm64 交叉编译** |
| 启动时间 | 1~2 秒 | **<100ms** |
| 常驻内存 | ~50MB | **~15MB** |
| 飞牛统一网关 | ✅ | ✅（双注册路由） |
| Unix Socket 监听 | ✅ | ✅ |
| HTTPS 图片代理 | ✅ | ✅ |
| 轮播图点击放大 | ✅ | ✅ |
| 端口模式可降级 | ✅ | ✅ |
| WebSocket 安装队列 | ✅ | ✅（+ 30 分钟超时） |
| **开发者星球 3D** | ❌ | **✅** |
| **独立安装进度弹窗** | ❌ | **✅** |
| **类型容错** | 天然支持 | **自定义 Unmarshal** |
| **向导会话自动清理** | 无 | **每 10 分钟扫描** |


## 九、部署与运维

### 9.1 编译与打包

```bash
# 1. 编译 Go 二进制
cd app/server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o fn-appstores-client .

# 交叉编译 ARM64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o fn-appstores-client-arm64 .

# 2. 清理运行时残留
cd ../..
find . -name "app.sock" -delete
find . -name "app.pid" -delete
find . -name "app.log" -delete
find . -name ".DS_Store" -delete

# 3. 打包
fnpack build
```

### 9.2 输出文件

```
fn-appstores-client.fpk
```

### 9.3 日志查看

```bash
cat /vol*/@appdata/fn-appstores-client/app.log
```

启动日志会打印：

```
✅ FN软仓客户端 v2.7.0
📂 数据目录: /vol*/@appdata/fn-appstores-client
🔗 启动模式: gateway
📡 已启用 N 个软件源:
   ● FN软仓官方源: http://rc.hhxs2026.top:5660
🔗 统一网关模式: /app/fn-appstores-client → /vol*/@appcenter/fn-appstores-client/target/app.sock
```

### 9.4 版本号维护（v2.7.0）

| 文件 | 位置 | 说明 |
|------|------|------|
| `manifest` | `version = 2.7.0` | 飞牛应用版本 |
| `config.go` | `DefaultVersion = "2.7.0"` | 兜底版本号 |

### 9.5 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TRIM_APPVER` | 应用版本号（飞牛系统注入） | 从 manifest 读取 |
| `TRIM_PKGVAR` | 数据持久化目录 | `/vol*/@appdata/fn-appstores-client/` |
| `TRIM_APPDEST` | 应用可执行文件目录 | `/vol*/@appcenter/fn-appstores-client/target/` |
| `START_MODE` | 启动模式（`gateway` / `port`） | `gateway` |
| `FN_SOFT_START_MODE` | 环境变量覆盖启动模式 | 空（用 `START_MODE`） |

### 9.6 网关注入的用户 Header

| Header | 说明 | 示例 |
|--------|------|------|
| `X-Trim-Userid` | 当前用户 UID | `1000` |
| `X-Trim-Isadmin` | 是否管理员 | `true` / `false` |
| `X-Trim-Username` | 用户名 | `admin` |

### 9.7 官方源需要配置的内容

为了让客户端自更新正常工作，官方源的 `fn-appstores.json` 中需要包含：

```json
{
  "id": "fn-appstores-client",
  "name": "FN软仓客户端",
  "version": "2.7.0",
  "download_url": "http://rc.hhxs2026.top:5660/apps/fn-appstores-client-2.7.0.fpk"
}
```


## 十、公告编辑器（独立工具）

`notice_generator1.5.py` 是用于生成公告数据的图形化工具，**非客户端内置组件**。

**v1.5 适配 v2.5.0+ 客户端**：
- 支持编辑 `records` 数组（日期 + 标题 + 内容）
- 支持管理轮播图列表
- `interval` 字段保留但客户端忽略


## 十一、常见问题排查指南（v2.7.0）

| 问题 | 可能原因 | 排查方法 |
|------|---------|---------|
| 应用已安装但显示"安装" | 大小写不匹配 / 目录名与 id 不一致 | 检查 `/vol*/@appcenter/` 目录名与 app.id 是否一致（忽略大小写） |
| 向导应用安装失败 | 环境变量未正确写入 | 查看日志中 `wizard.env` 内容；检查 `appcenter-cli` 输出 |
| 三方源来源标签显示官方源 | 客户端版本低于 v2.3.2 | 升级客户端至 v2.7.0 |
| 可更新卡片为空 | `loadInstalledVersions` 完成后未刷新卡片 | 升级至 v2.5.1+ |
| 新应用卡片排序失效 | 服务端自动补全 `updated_at` 为当前日期 | 移除服务端自动补全逻辑 |
| sources.json 更新后丢失 | `DATA_DIR` 未指向 `TRIM_PKGVAR` | 升级至 v2.5.1+ |
| 客户端自身出现在应用列表 | 未过滤 `fn-appstores-client` | 升级至 v2.5.1+ |
| 首页加载慢或需切换才显示 | `loadHome` 等待 `allAppsData` | 升级至 v2.5.1+ |
| WebSocket 连接失败 | 双定义冲突 / 协议不匹配 | 升级至 v2.6.1+ |
| 安装请求丢失 | WebSocket 断线重连时无队列 | 升级至 v2.6.1+ |
| 缓存数据不一致 | 多处读写缓存无统一入口 | 升级至 v2.6.1+ |
| 页面点击无反应或白屏 | DOM 元素缺失导致脚本中断 | 升级至 v2.6.1+ |
| 网络抖动时页面空白 | 无错误降级 | 升级至 v2.6.1+ |
| 升级后桌面无图标 | `ui/config` 顶层 key 写成 `url`（应为 `.url`） | 检查 `ui/config` 结构 |
| 网关模式下 WebSocket 连不上 | URL 未带网关前缀 | 检查 `API_BASE` 判断逻辑 |
| HTTPS 页面轮播图/图标不显示 | 未走图片代理 | DevTools 筛选 `proxy-image` 请求 |
| 打包报 `app.sock: no such device or address` | 源码目录残留 socket 文件 | 打包前 `find . -name "app.sock" -delete` |
| fnpack 可视化编辑器入口页空白 | 编辑器 schema 不认网关字段 | 手写 `ui/config`，命令行打包 |
| 系统版本低于 1.2.0401 装不上 | 网关需系统 ≥ 1.2.0401 | 降级 `FN_SOFT_START_MODE=port` |
| **开发者星球不显示** | 窗口宽度 < 900px | 展开窗口，或使用卡片列表 |
| **安装弹窗一直不关闭** | 安装超时未触发 | 30 分钟后自动复位；或手动关闭 |
| **安装失败但按钮仍为"安装中"** | WebSocket 断线未重连 | 刷新页面，v2.7.0 已加超时复位 |
| **Go 二进制无法执行** | 架构不匹配 | 确认 `GOARCH` 与设备架构一致 |


## 十二、v2.7.0 核心变更总结

| 变更类别 | 具体内容 | 影响范围 |
|---------|---------|---------|
| **后端重写** | Python → Go + Gin | 性能、并发、部署 |
| **模板引擎** | Jinja2 → Go html/template | 所有 .html 文件语法 |
| **开发者星球** | 3D 球形可视化开发者 | 新增页面 |
| **安装弹窗** | 独立进度弹窗 | 安装交互 |
| **超时复位** | 30 分钟安装超时 | WebSocket 稳定性 |
| **类型容错** | 自定义 UnmarshalJSON | JSON 解析健壮性 |
| **网关双注册** | 挂根 + 带前缀两套路由 | 网关兼容性 |
| **会话清理** | 每 10 分钟清理超 30 分钟向导 | 资源回收 |
| **版本比较** | 支持 v/V 前缀、多种分隔符、后缀 | 版本识别准确性 |

---

> **文档版本**：v3.0
> **对应客户端版本**：v2.7.0
> **更新日期**：2026-09-13

---