package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// APIDiagnostics 生成应用诊断日志
func APIDiagnostics(c *gin.Context) {
	appID := strings.TrimSpace(c.Query("app_id"))
	if appID == "" {
		c.String(400, "缺少 app_id")
		return
	}

	var sb strings.Builder
	sb.WriteString("========== FN软仓诊断报告 ==========\n")
	sb.WriteString(fmt.Sprintf("生成时间: %s\n", time.Now().Format("2006-01-02 15:04:05")))
	sb.WriteString(fmt.Sprintf("客户端版本: %s\n", Version))
	sb.WriteString(fmt.Sprintf("系统架构: %s / %s\n", os.Getenv("TRIM_SYS_ARCH"), localArch))
	sb.WriteString(fmt.Sprintf("飞牛系统版本: %s\n", os.Getenv("TRIM_SYS_VERSION")))
	sb.WriteString(fmt.Sprintf("目标应用 ID: %s\n", appID))
	
	// 1. 获取 appcenter-cli 状态
	stdout, stderr, err := runAppCenterCLI("status", appID)
	sb.WriteString("\n========== 应用运行状态 ==========\n")
	if err != nil {
		sb.WriteString(fmt.Sprintf("状态命令执行失败: %v\n", err))
	}
	if stdout != "" {
		sb.WriteString(fmt.Sprintf("stdout:\n%s\n", stdout))
	}
	if stderr != "" {
		sb.WriteString(fmt.Sprintf("stderr:\n%s\n", stderr))
	}

	// 2. 去各个卷的 @appdata 目录找日志文件
	sb.WriteString("\n========== 应用日志 (最后 500 行) ==========\n")
	logFound := false
	
	for _, base := range getAppCenterBases() {
		// 例如 /vol1/@appcenter 替换为 /vol1/@appdata
		appdataBase := strings.Replace(base, "@appcenter", "@appdata", 1)
		logDir := filepath.Join(appdataBase, appID)
		
		if _, err := os.Stat(logDir); os.IsNotExist(err) {
			continue
		}
		
		// 遍历该目录下所有 .log 文件
		entries, _ := os.ReadDir(logDir)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".log") {
				continue
			}
			logPath := filepath.Join(logDir, e.Name())
			sb.WriteString(fmt.Sprintf("\n--- 日志文件: %s ---\n", logPath))
			
			// 读取日志（为了防止文件过大，只读末尾）
			content, err := os.ReadFile(logPath)
			if err == nil {
				lines := strings.Split(string(content), "\n")
				if len(lines) > 500 {
					lines = lines[len(lines)-500:]
				}
				sb.WriteString(strings.Join(lines, "\n"))
				sb.WriteString("\n")
			}
			logFound = true
		}
	}

	if !logFound {
		sb.WriteString("未在 @appdata 目录下找到该应用的 .log 日志文件。\n")
		sb.WriteString("请确认应用是否正常运行，或者该应用是否输出了日志。\n")
	}

	sb.WriteString("\n========== 报告结束 ==========\n")

	// 触发浏览器下载
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="diagnose_%s.txt"`, appID))
	c.String(http.StatusOK, sb.String())
}