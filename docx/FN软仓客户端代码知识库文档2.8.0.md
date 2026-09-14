# FN软仓客户端 代码知识库文档

> 本文档用于记录 FN软仓客户端 v2.8.0 的代码结构、核心逻辑和版本演进，便于后续开发和维护。


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
| **v2.7.0** | 后端 Go 重写（Gin） + 开发者星球 3D 可视化 + 独立安装进度弹窗 + 安装超时强制复位 + 类型容错 | 已发布 |
| **v2.8.0** | **应用评分系统** + **架构自动适配** + **评分徽章** + **字段 `arch` → `platform`** + **骨架屏** + **搜索防抖** + **卡片图标懒加载** + **一次性下载 + gzip 校验重试** + **进度显示自适应** | **当前版本** |

> **架构说明**：v2.3.2+ 配合服务端 v2.4.0+ 使用，服务端采用**树状聚合架构**，官方源可聚合三方源应用，客户端无需额外配置即可发现更多应用。
> **网关说明**：v2.6.2+ 接入飞牛统一网关，应用改走 Unix Socket，通过 `/app/fn-appstores-client` 路径访问，自动获得 HTTPS 适配与登录态复用。
> **重写说明**：v2.7.0 后端从 Python 迁移到 Go，性能与部署体验提升。
> **v2.8.0 说明**：新增应用评分系统（转发到源服务端），按本机架构自动过滤应用，并集中做了一批体验优化（骨架屏、搜索防抖、图标懒加载）。**下载策略为一次性下载 + gzip 校验 + 自动重试**，适配 Gitee 外链托管场景。


## 二、整体架构

### 2.1 角色定位

客户端是运行在飞牛 NAS 上的 Web 应用，作为用户界面，聚合多个软件源的应用列表，提供应用浏览、安装、更新、评分、源管理等功能。

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

### 2.3 项目结构（v2.8.0）

```
fn-appstores-client/
├── app/
│   ├── manifest                  # 飞牛应用清单（无 service_port）
│   ├── cmd/
│   │   └── main                  # 生命周期脚本（网关模式启动）
│   ├── config/
│   │   ├── privilege
│   │   └── resource
│   ├── server/                   # Go 后端
│   │   ├── main.go               # 入口
│   │   ├── config.go             # 配置与环境变量
│   │   ├── gateway.go            # 路由注册 + 网关/端口模式
│   │   ├── apps.go               # 应用列表 + 多源聚合 + 架构过滤 + 已安装检测
│   │   ├── sources.go            # 源管理
│   │   ├── install.go            # 安装 + 进度推送（v2.8.0：一次性下载 + gzip 校验）
│   │   ├── wizard.go             # 向导会话
│   │   ├── proxy.go              # 图片代理
│   │   ├── rating.go             # ★ v2.8.0 新增：应用评分转发
│   │   ├── handlers.go           # 公告 + 自更新 + 日志
│   │   ├── websocket.go          # WebSocket 处理
│   │   ├── utils.go              # 版本比较 + 类型容错 + 日志
│   │   ├── go.mod
│   │   └── templates/
│   │       ├── layout.html       # 主布局
│   │       ├── index.html        # 入口 + 评分逻辑 + 骨架屏 + 搜索防抖 + 进度自适应
│   │       ├── home.html         # 首页（图标走 wrapImageUrl）
│   │       ├── apps.html         # 应用列表（评分徽章 + 骨架屏样式）
│   │       ├── developers.html   # 开发者星球 3D 可视化
│   │       ├── sources.html      # 源管理
│   │       ├── settings.html     # 设置页
│   │       └── modals.html       # 弹窗合集（含评分 UI + 安装进度弹窗）
│   └── ui/
│       ├── config                # 应用入口（.url + gatewayPrefix + gatewaySocket）
│       └── images/
│           ├── icon_64.png
│           └── icon_256.png
├── ICON.PNG
└── ICON_256.PNG
```

**v2.8.0 改动文件清单**：

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/rating.go` | 新增 | 应用评分转发接口 |
| `server/apps.go` | 修改 | 新增 `Platform` / `RatingAvg` / `RatingCount` 字段；架构检测与过滤 |
| `server/gateway.go` | 修改 | 注册评分路由 |
| `server/install.go` | 修改 | `downloadWithProgress` 改为**一次性下载 + gzip 校验 + 重试**；分片下载代码保留为可选分支 |
| `templates/index.html` | 修改 | 评分逻辑、骨架屏、搜索防抖、卡片图标懒加载、移除卡片平台徽章、**安装进度显示自适应** |
| `templates/apps.html` | 修改 | 评分徽章、骨架屏样式、搜索框 `oninput` 改为防抖 |
| `templates/home.html` | 修改 | `renderQuickList` 图标走 `wrapImageUrl` + `loading="lazy"` |
| `templates/modals.html` | 修改 | 评分 UI、样式 |


## 三、核心模块与函数（Go 后端）

### 3.1 配置模块（`config.go`）

```go
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
    DefaultVersion     = "2.8.0"
    DefaultOfficialURL = "http://rc.hhxs2026.top:5660"
    SourceCacheTTL     = 300
    AppCacheTTL        = 86400
    ImageCacheTTL      = 600
    ImageMaxSize       = 10 * 1024 * 1024
)

func initConfig() {
    // BaseDir 从可执行文件目录推导
    // DataDir 从 TRIM_PKGVAR 读取，回退到 BaseDir/data
    // StartMode 从 START_MODE 读取，默认 gateway
    // Version 优先 TRIM_APPVER，其次读 manifest，最后兜底 DefaultVersion
}
```

### 3.2 架构检测与过滤（`apps.go`）

```go
// ============================================================
// 本机架构检测（启动时执行一次）
// ============================================================
var localArch = detectLocalArch()

func detectLocalArch() string {
    switch runtime.GOARCH {
    case "arm64", "arm":
        return "arm"
    case "amd64", "386":
        return "x86"
    default:
        return "x86"
    }
}

// 架构匹配判断
func platformMatches(appPlatform string) bool {
    p := strings.ToLower(strings.TrimSpace(appPlatform))

    // 空 = 老应用，默认按 x86 处理
    if p == "" {
        p = "x86"
    }
    // all / 通用 兼容所有架构
    if p == "all" || p == "通用" || p == "universal" {
        return true
    }
    // 归一化
    switch p {
    case "aarch64", "arm64":
        p = "arm"
    case "amd64", "x86_64":
        p = "x86"
    }

    return p == localArch
}
```

**设计要点**：

- 客户端启动时用 `runtime.GOARCH` 检测本机架构
- 应用列表按 `platform` 字段过滤，不兼容的应用不显示
- 老应用（`platform` 为空）默认按 x86 处理
- `all` / `通用` / `universal` 兼容所有架构

### 3.3 App 结构体（`apps.go`）

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
    Platform    string          `json:"platform,omitempty"`      // ★ v2.8.0：替代 Arch
    SortOrder   SortOrderFlex   `json:"sort_order"`
    Downloads   int64           `json:"downloads,omitempty"`

    RatingAvg   float64 `json:"rating_avg,omitempty"`      // ★ v2.8.0 新增
    RatingCount int64   `json:"rating_count,omitempty"`    // ★ v2.8.0 新增

    Installed        bool   `json:"installed,omitempty"`
    InstalledVersion string `json:"installed_version,omitempty"`
    HasUpdate        bool   `json:"has_update,omitempty"`

    SourceName string `json:"_source_name,omitempty"`
    SourceURL  string `json:"_source_url,omitempty"`
    SourceID   string `json:"_source_id,omitempty"`
}
```

### 3.4 应用聚合（`apps.go`）

```go
// 多源并发拉取，按 id + platform 去重
func MergeAppsFromSources() []App {
    sources := GetEnabledSources()
    // goroutine + channel 并发拉取
    appMap := map[string]*App{}
    for i := 0; i < len(sources); i++ {
        r := <-ch
        for j := range r.apps {
            a := r.apps[j]
            key := a.ID
            if a.Platform != "" {
                key = a.ID + "@" + a.Platform
            }
            existing, ok := appMap[key]
            if !ok {
                appMap[key] = &a
                continue
            }
            if CompareVersions(a.Version, existing.Version) > 0 {
                appMap[key] = &a
            }
        }
    }
    return result
}

// 汇总 + 按本机架构过滤 + 缓存
func GetAllApps(force bool) []App {
    // 24 小时内存缓存检查
    apps := MergeAppsFromSources()

    // ★ v2.8.0：按本机架构过滤
    filtered := make([]App, 0, len(apps))
    for _, a := range apps {
        if platformMatches(a.Platform) {
            filtered = append(filtered, a)
        } else {
            log.Printf("⏭️ 跳过不兼容应用: %s v%s (platform=%s, 本机=%s)",
                a.ID, a.Version, a.Platform, localArch)
        }
    }
    apps = filtered

    // 标记 installed / has_update
    // 补全 download_url / icon
    // 按 sort_order 降序，再按 updated_at 降序
    return apps
}
```

### 3.5 应用评分（`rating.go`）★ v2.8.0 新增

```go
// findAppSource 根据 app_id 找到应用来源的源地址
func findAppSource(appID string) string {
    for _, a := range GetAllApps(false) {
        if a.ID == appID {
            return trimSlash(a.SourceURL)
        }
    }
    return ""
}

// APIGetRating 查询评分（转发到对应源）
func APIGetRating(c *gin.Context) {
    appID := c.Param("app_id")
    if appID == "" {
        c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
        return
    }

    srcURL := findAppSource(appID)
    if srcURL == "" {
        c.JSON(404, gin.H{"success": false, "message": "应用不存在"})
        return
    }

    client := &http.Client{Timeout: 5 * time.Second}
    resp, err := client.Get(srcURL + "/api/rating/" + appID)
    if err != nil {
        c.JSON(502, gin.H{"success": false, "message": "源服务不可达"})
        return
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
}

// APISubmitRating 提交评分（转发到对应源）
func APISubmitRating(c *gin.Context) {
    appID := c.Param("app_id")
    srcURL := findAppSource(appID)
    // ...

    // 校验 client_id 非空、rating 在 1~5
    var req struct {
        ClientID string `json:"client_id"`
        Rating   int    `json:"rating"`
    }
    // ...

    // 转发 POST 到源服务端
    httpReq, _ := http.NewRequest("POST", srcURL+"/api/rating/"+appID, bytes.NewReader(bodyBytes))
    httpReq.Header.Set("Content-Type", "application/json")
    // ...
}
```

**设计要点**：

- 客户端**不存储**评分数据，只做代理转发
- 评分归属由应用所属的源服务端决定
- 提交时校验 `client_id` 非空、`rating` 在 1~5

### 3.6 网关模式（`gateway.go`）

```go
func registerRoutes(rg *gin.RouterGroup) {
    // ... 已有路由
    rg.GET("/ws", HandleWS)

    // ★ v2.8.0 新增：应用评分（转发到应用来源的源）
    rg.GET("/api/rating/:app_id", APIGetRating)
    rg.POST("/api/rating/:app_id", APISubmitRating)
}

// 网关模式下同时注册"挂根"和"带前缀"两套路由
func buildRouter(prefix string) *gin.Engine {
    // 端口模式：只挂根
    // 网关模式：两套路由同时注册
}

// 统一网关模式：直接 net.Listen("unix", sockPath)
func startGatewayMode() {
    // ...
}
```

### 3.7 图片代理（`proxy.go`）

```go
// 白名单：已配置源 host + 应用列表里所有 icon/screenshots host + 本地
// 60 秒白名单缓存
// 10 分钟图片缓存
// 单张 10MB 限制
func APIProxyImage(c *gin.Context) {
    // ...
}
```

### 3.8 类型容错（`utils.go`）

```go
// sort_order 可能是 int 也可能是 string
type SortOrderFlex int
func (s *SortOrderFlex) UnmarshalJSON(data []byte) error { /* ... */ }

// screenshots 可能是 []string 也可能是 string
type ScreenshotsFlex []string
func (s *ScreenshotsFlex) UnmarshalJSON(data []byte) error { /* ... */ }
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

// 每 10 分钟清理超 30 分钟的过期会话
func cleanupOldSessions() { /* ... */ }
```

### 3.10 安装执行（`install.go`）★ v2.8.0 重写

**下载策略开关**：

```go
// ============================================================
// 下载策略开关
//
// useChunkedDownload = false（默认）：
//   - 一次性 GET 完整下载，不依赖 HEAD / Content-Length / Range
//   - 适合外链托管（Gitee 等），Gitee CDN 冷启动时不会踩坑
//   - 缺点：断线无法续传
//
// useChunkedDownload = true：
//   - 分片 256KB 下载 + 断点续传
//   - 适合本地托管 + frp 穿透场景（避开 frp 长连接截断）
//   - 缺点：依赖 HEAD / Content-Length / Accept-Ranges，Gitee 冷启动易踩坑
// ============================================================
const useChunkedDownload = false

func downloadWithProgress(url, dst, appID string, sender ProgressSender) error {
    if useChunkedDownload {
        return downloadChunked(url, dst, appID, sender)
    }
    return downloadOnce(url, dst, appID, sender)
}
```

**`downloadOnce`（默认路径）核心设计**：

1. 单次 `GET`，**不发送 HEAD**
2. **不依赖** `Content-Length` / `Accept-Ranges`
3. 流式读取，节流推送进度
4. `totalSize` 未知时显示"已下载 X MB"，不做百分比
5. 关键常量：`Timeout = 30 分钟`

**`downloadChunked`（可选路径）核心设计**：

1. HEAD 探测文件大小 + `Accept-Ranges`
2. 分片请求：每次 256KB，带 `Range: bytes=downloaded-end`
3. 断线自动重试：最多 30 次尝试，指数退避
4. 不支持 Range 时回退到一次性下载
5. 关键常量：`chunkSize = 256 * 1024`、`maxAttempts = 30`、`Timeout = 120s`（单片）

**`isGzipFile` 校验函数**：

```go
// isGzipFile 检查文件是否为有效的 gzip（FPK 外层必须是 gzip）
func isGzipFile(path string) bool {
    f, err := os.Open(path)
    if err != nil {
        return false
    }
    defer f.Close()
    magic := make([]byte, 2)
    if _, err := io.ReadFull(f, magic); err != nil {
        return false
    }
    return magic[0] == 0x1f && magic[1] == 0x8b
}
```

**`InstallAppWithProgress` 的下载重试逻辑**：

```go
const maxDownloadRetries = 3
for retry := 0; retry < maxDownloadRetries; retry++ {
    os.Remove(fpkPath)

    downloadErr = downloadWithProgress(downloadURL, fpkPath, appID, sender)
    if downloadErr == nil && isGzipFile(fpkPath) {
        downloadErr = nil
        break
    }
    downloadErr = fmt.Errorf("文件格式无效")

    if retry < maxDownloadRetries-1 {
        time.Sleep(2 * time.Second)
        sendProgress(sender, "progress", map[string]interface{}{
            "app_id": appID, "status": "downloading",
            "msg": fmt.Sprintf("文件无效，重试中... (%d/%d)", retry+1, maxDownloadRetries),
            "progress": 0, "stage": "download",
        })
    }
}
```

**设计动机**：

- **为什么从分片改为一次性**：v2.7.0 分片下载是为了解决 frp 长连接截断。但外链托管模式下（FPK 在 Gitee，服务端仅做 302），客户端不经过 frp，frp 截断问题不会发生。分片引入的 HEAD / Content-Length / Accept-Ranges 依赖反而让 Gitee CDN 冷启动时踩坑（`-0.0 MB`、`解压失败`）。
- **gzip 校验 + 重试**：Gitee CDN 冷启动时首次 GET 可能返回错误页（几十到几百字节的非 gzip 内容）。`isGzipFile` 检测前 2 字节 `1f 8b`，不是就等 2 秒重试，第二次 CDN 已预热，能拿到完整 FPK。
- **进度显示自适应**：`Content-Length` 未知时显示"已下载 X MB"，不再显示 `-0.0 MB`。
- **分片代码保留**：切回本地托管 + frp 时把 `useChunkedDownload` 改为 `true` 即可。

**两套策略对比**：

| 维度 | 一次性下载（默认） | 分片下载（可选） |
|------|------------------|----------------|
| HEAD 请求 | 不需要 | 必须 |
| 依赖 Content-Length | 否 | 是 |
| 依赖 Accept-Ranges | 否 | 是 |
| 断点续传（同进程） | 无 | 支持 |
| 断点续传（跨会话） | 无 | 无 |
| 代码复杂度 | 低 | 高 |
| Gitee CDN 冷启动 | 校验+重试自动跨过 | 各种异常 |
| 适用场景 | **外链托管（当前）** | 本地托管 + frp 穿透 |


## 四、前端核心模块（v2.8.0）

### 4.1 布局结构（`layout.html`）

**左侧导航**：首页、应用、开发者、源管理、设置（5项）

- 桌面端：140px 宽，文字加粗（600），字号 14px
- 窄屏（≤1100px）：仅显示单字（首/应/开/源/设）
- 移动端（≤768px）：汉堡菜单展开，宽度 100px

### 4.2 应用评分交互（`index.html`）★ v2.8.0 新增

**本地存储 Key**：

| Key | 说明 |
|-----|------|
| `fnsoft_my_ratings` | JSON 对象，记录 `{ appId: rating }` |
| `fnsoft_client_id` | 客户端唯一 ID，用于防刷 |

**核心函数**：

```javascript
// 读取/写入我的评分
function getMyRatings() { /* ... */ }
function getMyRating(appId) { /* ... */ }
function setMyRating(appId, rating) { /* ... */ }

// 客户端 ID 生成与持久化
function getClientId() {
    var id = localStorage.getItem('fnsoft_client_id');
    if (!id) {
        id = (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
            ('cid_' + Date.now() + '_' + Math.random().toString(36).slice(2));
        localStorage.setItem('fnsoft_client_id', id);
    }
    return id;
}

// 加载评分：优先显示我的评分，否则显示平均分
async function loadRating(appId) {
    // 1. 从 localStorage 读我的评分
    // 2. GET API_BASE + /api/rating/{appId}
    // 3. 有我的评分 → 高亮我的星级 + 显示"你已评分"
    // 4. 无我的评分 → 按平均分四舍五入高亮
}

// 提交评分
async function submitRating(appId, rating) {
    // POST API_BASE + /api/rating/{appId}
    // body: { client_id, rating }
    // 成功后：
    //   - 更新星星状态
    //   - 更新 info 显示平均分和人数
    //   - setMyRating(appId, rating)
    //   - 更新 allAppsData 里的 rating_avg / rating_count
    //   - 写入缓存
    //   - ★ 若当前在应用列表页，立即重绘卡片徽章
}

// 绑定星星 hover / click 事件
function initRatingWidget() { /* ... */ }
```

### 4.3 评分 UI（`modals.html`）★ v2.8.0 新增

**详情弹窗内新增评分区**：

```html
<div class="modal-rating" id="modalRating">
    <span class="rating-label">评分</span>
    <span class="rating-stars" id="ratingStars">
        <span class="star" data-value="1">★</span>
        <span class="star" data-value="2">★</span>
        <span class="star" data-value="3">★</span>
        <span class="star" data-value="4">★</span>
        <span class="star" data-value="5">★</span>
    </span>
    <span class="rating-info" id="ratingInfo">加载中...</span>
</div>
<div class="my-rating-hint" id="myRatingHint"></div>
```

**样式**：

```css
.rating-stars .star {
    font-size: 22px;
    color: #d0d0d0;
    transition: color 0.15s, transform 0.15s;
}
.rating-stars .star.active,
.rating-stars .star.hover {
    color: #f5b301;   /* 金黄 */
    transform: scale(1.05);
}
.my-rating-hint {
    color: #f5b301;
    font-size: 11px;
    display: none;
}
.my-rating-hint.show { display: block; }
```

**深色模式适配**：

```css
body.dark-mode .rating-stars .star { color: #3a4a6a; }
body.dark-mode .rating-stars .star.active,
body.dark-mode .rating-stars .star.hover { color: #ffd76a; }
body.dark-mode .my-rating-hint { color: #ffd76a; }
```

### 4.4 卡片评分徽章（`index.html` + `apps.html`）★ v2.8.0 新增

动作区结构：

```
[安装/更新按钮]  [★ 4.5]  [📥 123]
                ↑ 评分徽章     ↑ 下载量
```

**有评分**：

```html
<span class="rating-count-badge scored" title="4.5 分 · 12 人评分">
    <span class="star">★</span>4.5
</span>
```

**无评分**：

```html
<span class="rating-count-badge unscored" title="暂无评分">
    <span class="star">☆</span>暂无
</span>
```

**样式**：

```css
.rating-count-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
    margin-left: auto;
    cursor: help;
}
.rating-count-badge.scored {
    background: #fff8e1;
    color: #b8860b;
    border: 1px solid #f0d890;
}
.rating-count-badge.scored .star { color: #f5b301; }
.rating-count-badge.unscored {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    font-weight: 400;
}
.rating-count-badge + .download-count { margin-left: 6px; }
```

**深色模式**：

```css
body.dark-mode .rating-count-badge.scored {
    background: #3a2f1a;
    color: #ffd76a;
    border-color: #5a4a2a;
}
body.dark-mode .rating-count-badge.unscored {
    color: #6a7a9a;
    border-color: #2a3a5a;
}
```

### 4.5 平台信息展示（v2.8.0 变更）

**卡片**：**不再显示平台徽章**（v2.8.0 后期调整）。客户端已按架构过滤，卡片上出现 x86 / 通用 无对比意义，属于噪音。

**详情弹窗**：来源行保留平台信息。

```javascript
// index.html 的 openDetail 里
var srcText = app._source_name || '未知源';
if (app.platform === 'arm') srcText += ' · ARM';
else if (app.platform === 'x86') srcText += ' · x86';
else if (app.platform === 'all') srcText += ' · 通用';
sourceEl.textContent = srcText;
```

### 4.6 应用卡片渲染（`index.html`）

```javascript
function renderApps(apps) {
    // ...
    apps.map(function (app) {
        // 1. 版本和更新标识
        // 2. 平台徽章：卡片上不显示（v2.8.0 后期移除）
        var platformHtml = '';

        // 3. 来源标签（含 FN 认证标识）
        // 4. ★ 评分徽章 + 下载量
        var ratingBadgeHtml = '';
        if (app.rating_count > 0) {
            ratingBadgeHtml = '<span class="rating-count-badge scored" title="' +
                (app.rating_avg || 0).toFixed(1) + ' 分 · ' + app.rating_count + ' 人评分">' +
                '<span class="star">★</span>' + (app.rating_avg || 0).toFixed(1) +
                '</span>';
        } else {
            ratingBadgeHtml = '<span class="rating-count-badge unscored" title="暂无评分">' +
                '<span class="star">☆</span>暂无</span>';
        }
        var countHtml = ratingBadgeHtml +
            '<span class="download-count">📥 ' + (app.downloads || 0) + '</span>';

        // 5. 图标：加 loading="lazy"
        return '<div class="app-card" id="card-' + app.id + '" onclick="openDetail(\'' + app.id + '\')">' +
            '<div class="top">' +
            '<div class="icon">' + (app.icon ? '<img src="' + wrapImageUrl(app.icon) + '" alt="' + app.name + '" loading="lazy">' : '·') + '</div>' +
            // ...
    });
}
```

### 4.7 骨架屏（`index.html` + `apps.html`）★ v2.8.0 新增

**样式**（写在 `apps.html` 的 `<style>` 中）：

```css
.skeleton-card {
    pointer-events: none;
    cursor: default;
}
.skeleton-card:hover {
    box-shadow: none !important;
    transform: none !important;
    border-color: var(--border) !important;
    background: var(--card-bg) !important;
}
.skeleton {
    background: linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%);
    background-size: 200% 100%;
    animation: skeletonShine 1.5s ease-in-out infinite;
    border-radius: 4px;
    display: block;
}
@keyframes skeletonShine {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
.skeleton-icon {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    flex-shrink: 0;
}
.skeleton-line {
    height: 12px;
    margin: 6px 0;
}
.skeleton-line.h-8 { height: 8px; }
.skeleton-line.h-14 { height: 14px; }
.skeleton-line.w-40 { width: 40%; }
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-80 { width: 80%; }
.skeleton-line.w-90 { width: 90%; }
.skeleton-btn {
    width: 60px;
    height: 22px;
    border-radius: 4px;
}
body.dark-mode .skeleton {
    background: linear-gradient(90deg, #2a3a5a 25%, #3a4a6a 50%, #2a3a5a 75%);
    background-size: 200% 100%;
}
```

**渲染函数**（`index.html`）：

```javascript
function renderSkeletonCards(count) {
    var grid = document.getElementById('appGrid');
    if (!grid) return;
    var html = '';
    for (var i = 0; i < count; i++) {
        html += '<div class="app-card skeleton-card">' +
            '<div class="top">' +
            '<div class="skeleton skeleton-icon"></div>' +
            '<div class="info" style="flex:1;margin-left:10px;">' +
                '<div class="skeleton skeleton-line h-14 w-60"></div>' +
                '<div class="skeleton skeleton-line h-8 w-40" style="margin-top:4px;"></div>' +
            '</div>' +
            '</div>' +
            '<div class="skeleton skeleton-line h-8 w-90" style="margin-top:8px;"></div>' +
            '<div class="skeleton skeleton-line h-8 w-80"></div>' +
            '<div style="display:flex;gap:8px;margin-top:auto;align-items:center;">' +
                '<div class="skeleton skeleton-btn"></div>' +
                '<div class="skeleton skeleton-line h-8 w-30" style="margin:0;"></div>' +
            '</div>' +
            '</div>';
    }
    grid.innerHTML = html;
}
```

**调用点**（`loadAppsFromServer`）：

```javascript
async function loadAppsFromServer(silent) {
    // ★ 骨架屏：仅在非静默、无数据时显示
    if (!silent && (!allAppsData || allAppsData.length === 0)) {
        renderSkeletonCards(pageSize);
    }
    try {
        // fetch ...
    }
}
```

### 4.8 搜索防抖（`index.html` + `apps.html`）★ v2.8.0 新增

**搜索框**（`apps.html`）：

```html
<input type="text" id="searchInput" placeholder="搜索应用名称、描述、作者..." oninput="searchAppsDebounced()">
```

**防抖函数**（`index.html`）：

```javascript
var _searchDebounceTimer = null;

function searchAppsDebounced() {
    if (_searchDebounceTimer) {
        clearTimeout(_searchDebounceTimer);
    }
    _searchDebounceTimer = setTimeout(function () {
        _searchDebounceTimer = null;
        searchApps();
    }, 200);
}
```

**要点**：输入停止 200ms 后才触发全量过滤，避免逐字触发重绘。

### 4.9 卡片图标懒加载（`index.html` + `home.html`）★ v2.8.0 新增

**应用卡片**（`index.html` 的 `renderApps`）：

```javascript
'<div class="icon">' + (app.icon ? '<img src="' + wrapImageUrl(app.icon) + '" alt="' + app.name + '" loading="lazy">' : '·') + '</div>' +
```

**首页快捷卡片**（`home.html` 的 `renderQuickList`）：

```javascript
// ★ v2.8.0 修复：走 wrapImageUrl（HTTPS 下走代理），并加 lazy
var iconHtml = app.icon ? '<img src="' + wrapImageUrl(app.icon) + '" alt="" loading="lazy">' : '·';
```

**同时修复的 bug**：`home.html` 以前直接用 `app.icon`，HTTPS 下图标不显示；现在统一走 `wrapImageUrl`。

### 4.10 独立安装进度弹窗（`modals.html`）

与 v2.7.0 一致：

- 大图标 + 应用名 + 当前阶段
- 大百分比数字（20px）
- 进度条（渐变蓝 / 绿 / 红）
- 速度 + 已下载/总大小详情
- 成功后自动关闭（3 秒）

### 4.11 安装进度显示自适应（`index.html`）★ v2.8.0 新增

**`updateInstallModalProgress` 函数**：

```javascript
function updateInstallModalProgress(data) {
    // ...
    var detailEl = document.getElementById('installModalDetail');
    if (detailEl) {
        // total > 0：显示 "已下载 X MB / 总大小 Y MB"
        if (data.speed_str && data.downloaded && data.total && data.total > 0) {
            var dlMB  = (data.downloaded / 1024 / 1024).toFixed(1);
            var totMB = (data.total / 1024 / 1024).toFixed(1);
            detailEl.textContent = data.speed_str + ' · ' + dlMB + ' MB / ' + totMB + ' MB';
        }
        // total 未知（-1 或 0）：只显示 "已下载 X MB"
        else if (data.speed_str && data.downloaded) {
            var dlMB2 = (data.downloaded / 1024 / 1024).toFixed(1);
            detailEl.textContent = data.speed_str + ' · 已下载 ' + dlMB2 + ' MB';
        }
        else if (data.speed_str) {
            detailEl.textContent = data.speed_str;
        }
        else {
            detailEl.textContent = '';
        }
    }
}
```

**要解决的问题**：Gitee CDN 冷启动时 `Content-Length` 缺失，后端 `totalSize = -1`，前端 `(-1 / 1024 / 1024).toFixed(1)` 会显示 `-0.0 MB`。加 `total > 0` 判断后，改为显示"已下载 X MB"，避免负数。

### 4.12 开发者星球（`developers.html`）

与 v2.7.0 一致：

- 斐波那契球面均匀分布
- 每颗星独立呼吸相位和速度（5~9 秒周期）
- 三种配色区分开发者类型
- 拖动旋转 + 滚轮缩放 + 悬停查看 + 点击详情
- 窄屏（<900px）降级为卡片列表

### 4.13 WebSocket 管理（`index.html`）

与 v2.7.0 一致：

- 统一全局 `ws` 实例
- 动态协议生成（`ws:` / `wss:`）
- 指数退避重连（最大 10 次）
- 安装任务队列
- 30 分钟安装超时强制复位


## 五、v2.8.0 核心改动详解

### 5.1 应用评分系统（P0）★ 新增

**问题**：
- 应用列表只能看下载量，无法体现用户评价
- 缺少"我的评分"记录
- 评分数据需要归口到应用所属源服务端

**修复**：

- 后端新增 `rating.go`，把评分请求转发到应用所属的源服务端
- 前端 `modals.html` 新增评分 UI（5 颗星）
- 前端 `index.html` 新增评分逻辑：
  - `loadRating()` 加载评分
  - `submitRating()` 提交评分
  - `getMyRating()` / `setMyRating()` 本地记录
  - `getClientId()` 生成客户端 ID 防刷
- 卡片动作区新增评分徽章（平均分 + 评分人数）

**涉及文件**：`server/rating.go`（新增）、`server/gateway.go`、`templates/index.html`、`templates/apps.html`、`templates/modals.html`

### 5.2 架构自动适配（P0）★ 新增

**问题**：
- v2.7.0 及之前，客户端不区分架构，ARM 设备会看到 x86 应用，装不上
- 字段 `arch` 命名不够直观

**修复**：

- 字段 `arch` → `platform`
- 启动时 `detectLocalArch()` 检测本机架构（x86 / arm）
- `GetAllApps()` 里按 `platformMatches()` 过滤不兼容应用
- 应用去重 key 改为 `id@platform`

**涉及文件**：`server/apps.go`

### 5.3 评分徽章（P1）★ 新增

**问题**：评分系统上线后，列表页看不到评分概览

**修复**：

- 卡片动作区新增评分徽章
- 有评分显示金色星 + 平均分
- 无评分显示空心星 + "暂无"
- hover 显示"X.X 分 · N 人评分"

**涉及文件**：`templates/apps.html`、`templates/index.html`

### 5.4 评分后即时刷新（P1）★ 新增

**问题**：用户提交评分后，若停留在应用列表页，卡片徽章不更新

**修复**：`submitRating()` 成功后检测当前 Tab：

```javascript
var appsTab = document.getElementById('tabApps');
if (appsTab && appsTab.classList.contains('active')) {
    renderFilteredApps();
}
```

**涉及文件**：`templates/index.html`

### 5.5 骨架屏加载（P0）★ 新增

**问题**：应用列表首次加载时只显示一行"加载中..."，用户看不到即将呈现的页面结构

**修复**：

- `apps.html` 新增 `.skeleton-card` / `.skeleton` / `.skeleton-icon` / `.skeleton-line` / `.skeleton-btn` 样式与微光动画
- `index.html` 新增 `renderSkeletonCards(count)` 函数
- `loadAppsFromServer` 在 fetch 之前调用 `renderSkeletonCards(pageSize)`
- 数据回来后正常渲染覆盖骨架

**涉及文件**：`templates/apps.html`、`templates/index.html`

### 5.6 搜索防抖（P1）★ 新增

**问题**：搜索框 `oninput="searchApps()"` 每敲一个字都触发全量过滤 + 重绘 + 分页重算，应用多时打字卡顿

**修复**：

- 新增 `_searchDebounceTimer` 全局变量
- 新增 `searchAppsDebounced()` 函数：输入停止 200ms 后才调用 `searchApps()`
- `apps.html` 的搜索框 `oninput` 改为 `searchAppsDebounced()`

**涉及文件**：`templates/apps.html`、`templates/index.html`

### 5.7 卡片图标懒加载（P1）★ 新增

**问题**：应用列表页、首页快捷卡片的图标全部同步加载，首屏可能有几十个并发请求

**修复**：

- `renderApps` 里卡片图标 `<img>` 加 `loading="lazy"`
- `renderQuickList` 里图标加 `loading="lazy"`
- 顺带修复 `home.html` 里图标直接用 `app.icon` 未走 `wrapImageUrl` 的 bug（HTTPS 下图标不显示）

**涉及文件**：`templates/index.html`、`templates/home.html`

### 5.8 下载策略改为一次性下载 + gzip 校验（P0）★ v2.8.0 后期调整

**问题**：

- v2.7.0 引入分片下载是为了解决 **frp 长连接截断**
- 但 v2.8.0 场景变为**外链托管**（FPK 在 Gitee，服务端仅做 302 跳转），客户端不经过 frp，frp 截断问题不会发生
- 分片下载依赖 HEAD / Content-Length / Accept-Ranges，Gitee CDN 冷启动时这三个条件都不稳定：
  - HEAD 首次不给 `Content-Length` → 前端显示 `-0.0 MB` 和 0%
  - GET 首次可能返回错误页（几十字节非 gzip）→ `解压失败`
  - 用户关掉重开 → CDN 已预热 → 再次安装就正常

**修复**：

- `downloadWithProgress` 拆为两个实现：
  - `downloadOnce`（默认）：单次 GET 完整下载，不依赖 HEAD / Content-Length / Range
  - `downloadChunked`（可选）：保留原分片实现，通过 `useChunkedDownload` 常量切换
- `InstallAppWithProgress` 加下载后校验：
  - `isGzipFile(fpkPath)` 检查前 2 字节是否 `1f 8b`
  - 不是就等 2 秒重试，最多 3 次
  - 第二次 CDN 已预热，能拿到完整 FPK
- `index.html` 的 `updateInstallModalProgress` 加 `total > 0` 判断，避免显示 `-0.0 MB`

**涉及文件**：`server/install.go`、`templates/index.html`

### 5.9 移除卡片平台徽章（P2）★ 后期调整

**问题**：
- 客户端已按架构过滤，卡片上只能出现 `x86` / `通用`（x86 设备）或 `arm` / `通用`（ARM 设备），无对比意义
- 用户看到 `[x86]` / `[通用]` 徽章是噪音

**修复**：

- `index.html` 的 `renderApps` 中，`platformHtml` 恒为空串
- 详情弹窗来源行仍保留" · x86 / · ARM / · 通用"

**涉及文件**：`templates/index.html`


## 六、数据流

### 6.1 应用列表加载（v2.8.0）

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
    └─ 失效 → loadAppsFromServer()
                │
                ├─ ★ 显示骨架屏（非静默且无数据时）
                │
                ▼
            GET API_BASE + /api/apps
                │
                ▼
            Go 后端 GetAllApps()
                ├─ 检查内存缓存（24小时）
                ├─ 若失效，goroutine 并发拉取所有启用源
                ├─ 按 id@platform 去重，保留高版本
                ├─ ★ 按本机架构过滤不兼容应用
                ├─ 补全 download_url / icon
                ├─ 标记 installed、installed_version、has_update
                └─ 返回应用列表
                │
                ▼
            前端渲染（图标走 wrapImageUrl + lazy，显示评分徽章）
```

### 6.2 搜索交互（v2.8.0 新增）

```
用户在搜索框输入
    │
    ▼
oninput → searchAppsDebounced()
    │
    ├─ 清除上一个 timer
    └─ 设置新的 200ms timer
         │
         ▼
    200ms 内无新输入 → searchApps()
         │
         ▼
    currentPage = 1
    renderFilteredApps()
```

### 6.3 评分流程（v2.8.0 新增）

```
用户点开应用详情
    │
    ▼
loadRating(appId)
    ├─ 读 localStorage 里我的评分
    ├─ GET API_BASE + /api/rating/{appId}
    │       │
    │       ▼
    │   后端 findAppSource() 找到源的 URL
    │       │
    │       ▼
    │   转发 GET {源URL}/api/rating/{appId}
    │       │
    │       ▼
    │   返回 { rating_avg, rating_count }
    │
    ▼
高亮星级 + 显示平均分

用户点击星星
    │
    ▼
submitRating(appId, rating)
    ├─ 读 localStorage 里的 client_id
    ├─ POST API_BASE + /api/rating/{appId} { client_id, rating }
    │       │
    │       ▼
    │   后端校验后转发到源
    │
    ▼
更新 allAppsData 里的 rating_avg / rating_count
    │
    ▼
写缓存 + 立即重绘列表卡片徽章
    │
    ▼
写 localStorage 记录我的评分
```

### 6.4 安装流程（v2.8.0 一次性下载版）

```
用户点击「安装」
    │
    ▼
installApp(appId)
    ├─ 获取 download_url → API_BASE + /api/app/{appId}
    ├─ showInstallModal()  弹出独立进度弹窗
    └─ addInstallTask(appId, downloadUrl)
                │
                ▼
            processInstallQueue()
                ├─ 设置 30 分钟超时定时器
                └─ 发送 install 事件到 WebSocket
                │
                ▼
            Go 后端 InstallAppWithProgress
                ├─ ★ downloadWithProgress()
                │      └─ downloadOnce()：单次 GET 完整下载
                │
                ├─ ★ isGzipFile() 校验
                │      ├─ 是 gzip → 继续
                │      └─ 非 gzip → 等 2 秒，重试（最多 3 次）
                │
                ├─ ExtractFPK() 解压
                ├─ 检查 wizard/install
                ├─ 有向导 → 推送 wizard.show
                └─ 无向导 → appcenter-cli install-fpk
                │
                ▼
            前端 handleWsMessage
                ├─ updateInstallModalProgress() 更新弹窗
                │      └─ total > 0 → "X MB / Y MB"
                │      └─ total 未知 → "已下载 X MB"
                ├─ 安装成功后：即时刷新卡片 + 首页快捷卡片 + 缓存
                └─ 安装失败后：显示错误信息
```

### 6.5 开发者星球渲染

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

### 7.1 应用评分转发策略（v2.8.0 新增）

- 客户端**不存储**评分数据
- 评分请求由客户端转发到应用所属的源服务端
- 评分归属由源服务端决定，避免客户端与多源之间的数据一致性
- 客户端 ID 由浏览器生成并持久化，用于源服务端防刷

### 7.2 架构自动适配策略（v2.8.0 新增）

- 客户端启动时用 `runtime.GOARCH` 检测本机架构
- 应用按 `platform` 字段过滤，不兼容的应用不显示
- 老应用（`platform` 为空）默认按 x86 处理
- `all` / `通用` / `universal` 兼容所有架构

### 7.3 前端体验优化策略（v2.8.0 新增）

| 优化项 | 手段 | 效果 |
|-------|------|------|
| 骨架屏 | 加载时渲染灰色占位卡片 | 首屏视觉反馈更明确 |
| 搜索防抖 | 输入停止 200ms 后过滤 | 打字不卡顿 |
| 图标懒加载 | `loading="lazy"` | 首屏请求更少 |
| 移除卡片平台徽章 | `platformHtml` 恒为空 | 卡片更清爽 |
| 进度显示自适应 | `total > 0` 判断 | 避免显示 `-0.0 MB` |

### 7.4 下载策略：一次性 GET + gzip 校验（v2.8.0 后期调整）

- **触发场景**：外链托管（Gitee）下 CDN 冷启动时 HEAD / GET 均不稳定
- **核心手段**：
  - 单次 GET 完整下载，不发送 HEAD，不依赖 Content-Length / Accept-Ranges
  - `isGzipFile` 校验前 2 字节是否 `1f 8b`
  - 非 gzip → 等 2 秒重试，最多 3 次
  - 重试时 CDN 已预热，第二次能成功
- **为何不继续用分片**：
  - 分片的原始动机是解决 frp 长连接截断
  - 外链托管模式下客户端不经过 frp，动机消失
  - 分片引入的 HEAD / Content-Length / Accept-Ranges 依赖反成负担
- **兼容**：保留 `CheckRedirect` 补 Referer / UA 逻辑，兼容 Gitee 302
- **分片代码保留**：`useChunkedDownload = true` 可切回

### 7.5 后端 Go 化（v2.7.0 新增）

- 使用 Gin 作为 Web 框架
- 使用 gorilla/websocket 处理实时推送
- 单二进制产物，无运行时依赖
- 支持 amd64 / arm64 交叉编译

### 7.6 网关双注册策略（v2.7.0 新增）

- 不依赖中间件剥前缀，直接注册两套路由
- 兼容网关"保留前缀"和"剥掉前缀"两种行为
- 静态资源也双路径注册

### 7.7 开发者星球可视化（v2.7.0 新增）

- 纯 Canvas 2D 手写 3D 投影（无第三方库）
- 斐波那契球面均匀分布
- 每颗星独立呼吸相位和速度
- 三种配色区分开发者类型
- 窄屏自动降级为卡片列表

### 7.8 树状聚合架构（v2.4.0，服务端主导）

- 客户端保留多源拉取能力，但推荐用户仅使用官方源
- 官方源服务端通过树状聚合自动包含三方源应用
- 客户端通过 `_source_id` 和 `_source_name` 字段识别应用来源

### 7.9 FN 认证标识（v2.4.0，前端展示）

| 来源类型 | `_source_id` | 显示效果 |
|---------|-------------|---------|
| 官方源 | `official` | `FN软仓官方源` |
| 认证三方源 | 非 `official` 且非 `source_*` | `✅FN-{源名称}` |
| 用户自添加源 | 以 `source_` 开头 | `{源名称}` |

### 7.10 数据持久化

- 使用飞牛系统注入的 `TRIM_PKGVAR` 环境变量作为数据根目录
- `sources.json`、`app.log` 等用户数据存储于持久化目录
- **评分数据不落地客户端**，由源服务端存储

### 7.11 模板拆分策略

| 类型 | 存放位置 | 说明 |
|------|---------|------|
| 全局基础样式 | `layout.html` | 所有页面共享 |
| 公共 JavaScript | `index.html` | Toast、应用列表、安装、评分、WebSocket、图片代理、骨架屏、搜索防抖等 |
| 页面专属 JS | 各自页面文件 | `home.html`、`developers.html`、`settings.html`、`sources.html` |

### 7.12 半自动更新策略

- 客户端不做自动安装（避免文件占用问题）
- 只负责检测和下载 FPK
- 用户通过飞牛应用中心手动完成安装

### 7.13 WebSocket 统一管理策略

- 由 `index.html` 维护唯一全局 `ws` 实例
- 动态协议生成（`ws:` / `wss:`）
- 指数退避重连（最大 10 次，1.5ⁿ 秒递增至 30 秒）
- 安装任务队列保证断线重连后请求不丢失
- v2.7.0 新增 30 分钟安装超时强制复位

### 7.14 为什么不做"跨会话断点续传"

**"跨会话续传"** 指用户关闭客户端再打开后能继续上次的下载。

- **v2.7.0 分片下载时期**：`os.MkdirTemp` 每次生成随机目录，续传仅限"同一次安装过程内的片间重试"，**关闭客户端照样从 0 开始**
- **v2.8.0 一次性下载时期**：无续传

**为何不做**：

- FPK 一般几 MB 到几十 MB，从 CDN 下载一次几十秒
- 中断概率低，重下成本可接受
- 真要做需固定临时目录 + 文件大小检测 + 过期清理，收益不成正比

**将来要做**的改动方向：

1. 固定临时目录 `{DataDir}/install_cache/{appID}.fpk.part`
2. 下载前检查该文件大小 → 用 `Range: bytes={size}-` 续传
3. 完成后重命名为 `.fpk` → 解压安装
4. 写"过期清理"（超 7 天的 `.part` 文件删掉）


## 八、版本对比表（v2.7.0 → v2.8.0）

| 功能/修复 | v2.7.0 | v2.8.0 |
|-----------|--------|--------|
| 后端语言 | Go | Go（不变） |
| 统一网关 | ✅ | ✅ |
| 图片代理 | ✅ | ✅ |
| 开发者星球 | ✅ | ✅ |
| 独立安装进度弹窗 | ✅ | ✅ |
| 安装超时复位 | ✅ | ✅ |
| **应用评分（5 星）** | ❌ | **✅** |
| **我的评分本地记录** | ❌ | **✅** |
| **客户端 ID 防刷** | ❌ | **✅** |
| **架构自动适配** | ❌ | **✅** |
| **字段 `arch` → `platform`** | ❌ | **✅** |
| **不兼容应用自动过滤** | ❌ | **✅** |
| **评分徽章（卡片）** | ❌ | **✅** |
| **评分后即时刷新** | ❌ | **✅** |
| **骨架屏** | ❌ | **✅** |
| **搜索防抖** | ❌ | **✅** |
| **卡片图标懒加载** | ❌ | **✅** |
| **FPK 下载策略** | 分片下载 | **一次性下载（默认）+ gzip 校验 + 重试** |
| **进度显示** | 依赖 Content-Length | **自适应（未知时显示"已下载 X MB"）** |
| **详情弹窗平台信息** | ❌ | **✅** |
| **卡片平台徽章** | ❌ | 移除（详情保留） |


## 九、部署与运维

### 9.1 编译与打包

```bash
# 1. 编译 Go 二进制
cd app/server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o fn-appstores-client .

# 交叉编译 ARM64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o fn-appstores-client .

# 2. 清理运行时残留
cd ../..
find . -name "app.sock" -delete
find . -name "app.pid" -delete
find . -name "app.log" -delete
find . -name ".DS_Store" -delete

# 3. 打包
fnpack build
```

### 9.2 只改 HTML 时（不用重新编译 Go）

因为 `gateway.go` 用的是 `r.LoadHTMLGlob("templates/*.html")`，**运行时加载**而非 Go embed。改 HTML 时：

**方式 A：直接改安装目录**

```bash
cd /vol1/@appcenter/fn-appstores-client/server/templates
# 改 index.html / apps.html / home.html / modals.html
/usr/local/bin/appcenter-cli restart fn-appstores-client
```

浏览器强制刷新（Ctrl+Shift+R）。

**方式 B：改源码重新打包**

```bash
cd /vol1/@appshare/fnpackup-docker/projects/fn-appstores-client
fnpack build
# 应用中心卸载重装
```

**但都不要 `go build`。**

### 9.3 输出文件

```
fn-appstores-client.fpk
```

### 9.4 日志查看

```bash
cat /vol*/@appdata/fn-appstores-client/app.log
```

启动日志会打印：

```
✅ FN软仓客户端 v2.8.0
📂 数据目录: /vol*/@appdata/fn-appstores-client
🔗 启动模式: gateway
📡 已启用 N 个软件源:
   ● FN软仓官方源: http://rc.hhxs2026.top:5660
🔗 统一网关模式: /app/fn-appstores-client → /vol*/@appcenter/fn-appstores-client/target/app.sock
```

安装日志会打印：

```
   ⬇️ 一次性下载: totalSize=2237001
   ✅ 文件校验通过
```

或（冷启动时）：

```
   ⬇️ 一次性下载: totalSize=-1
   ⚠️ 下载的文件不是有效 gzip（47 字节），可能是 CDN 冷启动，重试 1/3
   ⬇️ 一次性下载: totalSize=2237001
   ✅ 文件校验通过
```

### 9.5 版本号维护（v2.8.0）

| 文件 | 位置 | 说明 |
|------|------|------|
| `manifest` | `version = 2.8.0` | 飞牛应用版本 |
| `config.go` | `DefaultVersion = "2.8.0"` | 兜底版本号 |

### 9.6 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TRIM_APPVER` | 应用版本号（飞牛系统注入） | 从 manifest 读取 |
| `TRIM_PKGVAR` | 数据持久化目录 | `/vol*/@appdata/fn-appstores-client/` |
| `TRIM_APPDEST` | 应用可执行文件目录 | `/vol*/@appcenter/fn-appstores-client/target/` |
| `START_MODE` | 启动模式（`gateway` / `port`） | `gateway` |
| `FN_SOFT_START_MODE` | 环境变量覆盖启动模式 | 空（用 `START_MODE`） |

### 9.7 网关注入的用户 Header

| Header | 说明 | 示例 |
|--------|------|------|
| `X-Trim-Userid` | 当前用户 UID | `1000` |
| `X-Trim-Isadmin` | 是否管理员 | `true` / `false` |
| `X-Trim-Username` | 用户名 | `admin` |

### 9.8 官方源需要配置的内容

为了让客户端自更新正常工作，官方源的 `fn-appstores.json` 中需要包含：

```json
{
  "id": "fn-appstores-client",
  "name": "FN软仓客户端",
  "version": "2.8.0",
  "download_url": "http://rc.hhxs2026.top:5660/apps/fn-appstores-client-2.8.0.fpk"
}
```

## 十、常见问题排查指南（v2.8.0）

| 问题 | 可能原因 | 排查方法 |
|------|---------|---------|
| 应用已安装但显示"安装" | 大小写不匹配 / 目录名与 id 不一致 | 检查 `/vol*/@appcenter/` 目录名与 app.id 是否一致（忽略大小写） |
| 向导应用安装失败 | 环境变量未正确写入 | 查看日志中 `wizard.env` 内容；检查 `appcenter-cli` 输出 |
| 三方源来源标签显示官方源 | 客户端版本低于 v2.3.2 | 升级客户端至 v2.8.0 |
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
| 开发者星球不显示 | 窗口宽度 < 900px | 展开窗口，或使用卡片列表 |
| 评分加载失败 | 源服务端不支持 `/api/rating/` 接口 | 确认源服务端为 v2.5.5+ 并已实现评分接口 |
| 评分提交失败 | `client_id` 未生成 / 源服务端拒绝 | 检查 localStorage 里 `fnsoft_client_id` |
| 评分后卡片徽章不更新 | 未触发重绘 | v2.8.0 已修，升级客户端 |
| ARM 应用看不到 | 源服务端 `platform` 字段缺失或值不正确 | 检查服务端返回的 `platform` 字段 |
| x86 应用在 ARM 设备上仍显示 | 客户端版本低于 v2.8.0 | 升级客户端至 v2.8.0 |
| **`解压失败`（首次安装）** | Gitee CDN 冷启动，GET 拿到错误页（几十字节非 gzip） | v2.8.0 已加 gzip 校验+重试，升级客户端 |
| **进度条显示 `-0.0 MB`** | `total = -1`，前端未判断 | v2.8.0 已加 `total > 0` 判断，升级客户端 |
| **进度条永远 0%** | CDN 冷启动，Content-Length 未知 | v2.8.0 已改为显示"已下载 X MB"，升级客户端 |
| **卡片上仍显示 `[x86]` / `[通用]` 徽章** | 客户端版本低于 v2.8.0 后期调整 | 替换 `index.html`，移除 `platformHtml` 逻辑 |
| **首页快捷卡片图标在 HTTPS 下空白** | `renderQuickList` 未走 `wrapImageUrl` | v2.8.0 已修，升级客户端 |
| **搜索框打字卡顿** | 无防抖，逐字触发重绘 | v2.8.0 已加 200ms 防抖 |
| **同一次安装，网络抖动断流** | 一次性下载无片间重试 | v2.8.0 无续传；如需可把 `useChunkedDownload` 改 `true` |
| **关闭客户端后重开，要从头下** | 临时目录随机，无跨会话续传 | v2.8.0 未做；如需参见 7.14 |
| Go 二进制无法执行 | 架构不匹配 | 确认 `GOARCH` 与设备架构一致 |

