package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

func IndexPage(c *gin.Context) {
	staticBase := ""
	if StartMode == "gateway" {
		staticBase = GatewayPrefix
	}
	c.HTML(200, "layout", gin.H{
		"Version":    Version,
		"StaticBase": staticBase,
	})
}

func main() {
	initConfig()
	ensureDirs()

	log.Printf("✅ FN软仓客户端 v%s", Version)
	log.Printf("📂 数据目录: %s", DataDir)
	log.Printf("🔗 启动模式: %s", StartMode)

	// 打印已启用源
	sources := LoadSources()
	log.Printf("📡 已启用 %d 个软件源:", len(sources))
	for _, s := range sources {
		if s.Enabled {
			log.Printf("   ● %s: %s", s.Name, s.URL)
		}
	}

	// 每 10 分钟清理过期向导会话
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanupOldSessions()
		}
	}()

	if StartMode == "gateway" {
		startGatewayMode()
	} else {
		startPortMode()
	}
}

// randHex 生成随机 hex 串（用于向导 session id）
func randHex(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", n)
	}
	return hex.EncodeToString(b)[:n]
}

// jsonUnmarshal 简化的 JSON 解析（供 wizard 使用）
func jsonUnmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}