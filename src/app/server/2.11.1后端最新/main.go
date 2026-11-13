package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

func calcStaticVersion() string {
	var latest int64
	dirs := []string{"./static/js", "./static/css"}
	if BaseDir != "" {
		dirs = []string{
			filepath.Join(BaseDir, "static", "js"),
			filepath.Join(BaseDir, "static", "css"),
			filepath.Join(BaseDir, "server", "static", "js"),
			filepath.Join(BaseDir, "server", "static", "css"),
		}
	}
	for _, dir := range dirs {
		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if t := info.ModTime().Unix(); t > latest {
				latest = t
			}
			return nil
		})
	}
	if latest == 0 {
		return "0"
	}
	return fmt.Sprintf("%d", latest)
}

func IndexPage(c *gin.Context) {
	staticBase := ""
	if StartMode == "gateway" {
		staticBase = GatewayPrefix
	}
	// 兜底：模板没加载成功时，别给浏览器一个空白页，直接说明原因
	if !templatesReady {
		c.Data(500, "text/html; charset=utf-8", []byte(fallbackPage()))
		return
	}
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("❌ 首页渲染失败: %v", rec)
			c.Data(500, "text/html; charset=utf-8", []byte(fallbackPage()))
		}
	}()
	c.HTML(200, "layout", gin.H{
		"Version":    Version,
		"StaticBase": staticBase,
		"StaticVer":  calcStaticVersion(),
	})
}

func fallbackPage() string {
	wd, _ := os.Getwd()
	return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>FN软仓 - 启动异常</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#333;padding:48px 24px;line-height:1.9}
.box{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 36px;box-shadow:0 2px 16px rgba(0,0,0,.06)}
h1{font-size:20px;margin-bottom:8px}p{color:#555;margin:8px 0}
code{background:#f0f1f3;padding:2px 6px;border-radius:4px;font-size:13px}
ul{margin:12px 0 0 20px;color:#555}li{margin:6px 0}</style></head><body><div class="box">
<h1>后端已启动，但页面模板没能加载</h1>
<p>进程是活的，接口也能访问，只是 <code>templates</code> 目录没找到，所以页面渲染不出来。</p>
<ul>
<li>确认 <code>templates</code> 和 <code>static</code> 与二进制放在同一目录</li>
<li>当前二进制目录：<code>` + BaseDir + `</code></li>
<li>当前工作目录：<code>` + wd + `</code></li>
<li>详细原因见数据目录下的 <code>app.log</code></li>
</ul></div></body></html>`
}

func main() {
	initConfig()
	ensureDirs()
	InitDeviceInfo()

	log.Printf("✅ FN软仓客户端 v%s", Version)
	log.Printf("📂 数据目录: %s", DataDir)
	log.Printf("📦 程序目录: %s", BaseDir)
	log.Printf("📁 工作目录: %s", mustGetwd())
	log.Printf("🔗 启动模式: %s", StartMode)

	checkAppCenterCLI()

	// ★ 本地缓存整理：清理历史 apps/fpk_extract，启动一次 + 每 6 小时清理
	startCacheJanitor()

	sources := LoadSources()
	log.Printf("📡 已启用 %d 个软件源:", len(sources))
	for _, s := range sources {
		if s.Enabled {
			log.Printf("   ● %s: %s", s.Name, s.URL)
		}
	}

	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanupOldSessions()
		}
	}()

	go func() {
		refreshAccelPool()
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			log.Printf("[accel-pool] 定时刷新加速器池")
			refreshAccelPool()
		}
	}()

	if StartMode == "gateway" {
		startGatewayMode()
	} else {
		startPortMode()
	}
}

func randHex(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", n)
	}
	return hex.EncodeToString(b)[:n]
}

func jsonUnmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}
