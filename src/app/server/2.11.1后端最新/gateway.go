package main

import (
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

func registerRoutes(rg *gin.RouterGroup) {
	rg.GET("/", IndexPage)
	rg.GET("/api/apps", APIApps)
	rg.HEAD("/api/apps", APIApps)
	rg.POST("/api/refresh", APIRefresh)
	rg.GET("/api/installed", APIInstalled)
	rg.GET("/api/app/:app_id", APIAppDetail)

	rg.GET("/api/sysinfo", APISysInfo)
	rg.GET("/api/diagnostics", APIDiagnostics)

	// ★ 首次启动引导
	rg.GET("/api/init/status", APIInitStatus)
	rg.POST("/api/init/setup", APIInitSetup)

	// ★ 下载及进度查询
	rg.POST("/api/download", APIDownloadFPK)
	rg.GET("/api/download/status", APIDownloadStatus)

	// ★ 依赖预检查
	rg.POST("/api/read-manifest", APIReadManifest)

	// ★ 修复：手动安装（上传本地 FPK 并安装）——此前漏注册导致前端 404
	rg.POST("/api/install-local", APIInstallLocal)

	// ★ 应用管理
	rg.GET("/api/app/:app_id/status", APIAppStatus)
	rg.POST("/api/app/:app_id/stop", APIStopApp)
	rg.POST("/api/app/:app_id/start", APIStartApp)
	rg.POST("/api/app/:app_id/restart", APIRestartApp)
	rg.POST("/api/app/:app_id/uninstall", APIUninstallApp)
	rg.POST("/api/app/:app_id/repair", APIRepairApp)

	// ★ 配置备份与恢复
	rg.GET("/api/app/:app_id/backup", APIAppBackup)
	rg.POST("/api/app/:app_id/restore", APIAppRestore)

	// ★ 加速池手动刷新
	rg.POST("/api/accel-pool/refresh", APIRefreshAccelPool)

	rg.GET("/api/sources", APISources)
	rg.POST("/api/sources/add", APIAddSource)
	rg.POST("/api/sources/remove", APIRemoveSource)
	rg.POST("/api/sources/toggle", APIToggleSource)
	rg.POST("/api/sources/test", APITestSource)
	rg.GET("/api/notice", APINotice)

	// ★ 新增：系统消息推送拉取
	rg.GET("/api/push/pending", APIPushPending)

	rg.GET("/api/check-update", APICheckUpdate)
	rg.GET("/api/proxy-image", APIProxyImage)
	rg.GET("/api/logs", APILogs)
	rg.GET("/api/logs/export", APILogsExport)
	rg.GET("/api/gateway-user", APIGatewayUser)
	rg.GET("/ws", HandleWS)

	rg.GET("/api/rating/:app_id", APIGetRating)
	rg.POST("/api/rating/:app_id", APISubmitRating)

	// ★ 本地缓存管理（安装包 / 解压目录 / 图标截图）
	rg.GET("/api/cache/stats", APICacheStats)
	rg.POST("/api/cache/clean", APICacheClean)
	rg.GET("/api/cache/download", APICacheDownload)
}

func noCacheAPI() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
		c.Next()
	}
}

func noCacheStatic(r *gin.Engine, urlPrefix, dir string) {
	fs := http.StripPrefix(urlPrefix, http.FileServer(http.Dir(dir)))
	handler := func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache, must-revalidate")
		fs.ServeHTTP(c.Writer, c.Request)
	}
	r.GET(urlPrefix+"/*filepath", handler)
	r.HEAD(urlPrefix+"/*filepath", handler)
}

// templatesReady 标记模板是否加载成功，供首页兜底判断
var templatesReady bool

// resolveAssetDir 资源目录解析：优先用二进制所在目录，避免依赖启动时的工作目录。
// 旧版直接用 "templates/*.html" 这类相对路径，一旦进程 CWD 不是应用目录，
// gin 的 LoadHTMLGlob 会直接 panic，进程秒退，表现为「应用离线 + 页面全白」。
func resolveAssetDir(name string) string {
	// 1) 二进制同级的 server 目录
	if BaseDir != "" {
		for _, p := range []string{
			filepath.Join(BaseDir, name),
			filepath.Join(BaseDir, "server", name),
		} {
			if st, err := os.Stat(p); err == nil && st.IsDir() {
				return p
			}
		}
	}
	// 2) 当前工作目录兜底
	if st, err := os.Stat("./" + name); err == nil && st.IsDir() {
		abs, _ := filepath.Abs("./" + name)
		return abs
	}
	return ""
}

func buildRouter(prefix string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(noCacheAPI())

	tplDir := resolveAssetDir("templates")
	if tplDir == "" {
		log.Printf("❌ 找不到 templates 目录（BaseDir=%s, CWD=%s）", BaseDir, mustGetwd())
		log.Printf("❌ 请确认 templates 与二进制位于同一目录，否则页面无法渲染")
	} else {
		tpl, err := template.ParseGlob(filepath.Join(tplDir, "*.html"))
		if err != nil {
			// 解析失败不 panic：让进程活下去并留下可查日志，接口仍可用
			log.Printf("❌ 模板解析失败(%s): %v", tplDir, err)
		} else {
			r.SetHTMLTemplate(tpl)
			templatesReady = true
			log.Printf("📄 模板已加载: %s", tplDir)
		}
	}

	staticDir := resolveAssetDir("static")
	if staticDir == "" {
		log.Printf("⚠️ 找不到 static 目录（BaseDir=%s, CWD=%s），前端样式将失效", BaseDir, mustGetwd())
		staticDir = "./static"
	} else {
		log.Printf("📦 静态资源: %s", staticDir)
	}

	if prefix == "" {
		noCacheStatic(r, "/static", staticDir)
		registerRoutes(r.Group(""))
	} else {
		noCacheStatic(r, "/static", staticDir)
		noCacheStatic(r, prefix+"/static", staticDir)
		registerRoutes(r.Group(""))
		registerRoutes(r.Group(prefix))
	}
	return r
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "?"
	}
	return wd
}

func startGatewayMode() {
	appdest := os.Getenv("TRIM_APPDEST")
	if appdest == "" {
		appdest = BaseDir
	}
	sockPath := filepath.Join(appdest, GatewaySocketName)

	if len(sockPath) > 100 {
		sockPath = fmt.Sprintf("/tmp/fn-soft-%d.sock", os.Getpid())
		log.Printf("⚠️ Socket 路径过长，改用 %s", sockPath)
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
	if err := http.Serve(ln, router); err != nil {
		log.Fatalf("网关服务启动失败: %v", err)
	}
}

func startPortMode() {
	router := buildRouter("")
	log.Printf("🔗 端口模式: 0.0.0.0:%d", Port)
	if err := router.Run(fmt.Sprintf("0.0.0.0:%d", Port)); err != nil {
		log.Fatalf("端口服务启动失败: %v", err)
	}
}
