package main

import (
	"fmt"
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

func buildRouter(prefix string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.LoadHTMLGlob("templates/*.html")

	if prefix == "" {
		// 端口模式：只挂根
		r.Static("/static", "./static")
		registerRoutes(r.Group(""))
	} else {
		// 网关模式：同时注册"挂根"和"带前缀"两套路由
		// 兼容网关保留前缀 / 剥掉前缀两种转发方式

		// 静态资源，两种路径都注册
		r.Static("/static", "./static")
		r.Static(prefix+"/static", "./static")

		// 挂根注册（网关剥前缀时命中）
		registerRoutes(r.Group(""))

		// 带前缀注册（网关保留前缀时命中）
		registerRoutes(r.Group(prefix))
	}
	return r
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