package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// 首次启动引导：用户模式 / 极客模式
// ============================================================

type InitMode struct {
	Mode      string `json:"mode"`      // "user" | "geek"
	Timestamp string `json:"timestamp"`
}

func getInitModePath() string {
	return filepath.Join(DataDir, ".init_mode")
}

func LoadInitMode() (string, bool) {
	data, err := os.ReadFile(getInitModePath())
	if err != nil {
		return "", false
	}
	var m InitMode
	if err := json.Unmarshal(data, &m); err != nil {
		return "", false
	}
	if m.Mode != "user" && m.Mode != "geek" {
		return "", false
	}
	return m.Mode, true
}

func SaveInitMode(mode string) error {
	if mode != "user" && mode != "geek" {
		return fmt.Errorf("invalid mode: %s", mode)
	}
	m := InitMode{
		Mode:      mode,
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
	}
	data, _ := json.MarshalIndent(m, "", "  ")
	return os.WriteFile(getInitModePath(), data, 0644)
}

// ★ 核心修复：强校验 sources.json 内容，防止空文件或 [] 被误判为老用户
func isSourcesFileValid() bool {
	_, err := os.Stat(getSourcesPath())
	if err != nil {
		return false
	}
	data, err := os.ReadFile(getSourcesPath())
	// 如果内容为空，或者长度太短（比如只有 "[]"），视为无效老数据
	if err != nil || len(strings.TrimSpace(string(data))) < 10 {
		return false
	}
	return true
}

func APIInitStatus(c *gin.Context) {
	mode, initialized := LoadInitMode()

	// 升级兼容：有有效 sources.json 但没 .init_mode → 视为 user 已初始化
	if !initialized && isSourcesFileValid() {
		_ = SaveInitMode("user")
		mode = "user"
		initialized = true
	}

	c.JSON(200, gin.H{
		"success":     true,
		"initialized": initialized,
		"mode":        mode,
	})
}

func APIInitSetup(c *gin.Context) {
	var req struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Mode != "user" && req.Mode != "geek" {
		c.JSON(400, gin.H{"success": false, "message": "无效模式"})
		return
	}

	// 防重复初始化
	if _, initialized := LoadInitMode(); initialized {
		c.JSON(400, gin.H{"success": false, "message": "系统已初始化，无法重复设置"})
		return
	}

	// 先写源（业务负载更重），成功后再写 .init_mode 作为完成标志
	var writeErr error
	switch req.Mode {
	case "user":
		writeErr = SaveSources(append([]Source{}, defaultSources...))
	case "geek":
		// ★ 修复：极客模式不预置官方源，写入空数组
		writeErr = SaveSources([]Source{})
	}
	if writeErr != nil {
		c.JSON(500, gin.H{"success": false, "message": "初始化源失败: " + writeErr.Error()})
		return
	}

	if err := SaveInitMode(req.Mode); err != nil {
		c.JSON(500, gin.H{"success": false, "message": "保存模式失败: " + err.Error()})
		return
	}

	InvalidateAppCache()

	c.JSON(200, gin.H{
		"success": true,
		"mode":    req.Mode,
		"message": "初始化完成",
	})
}