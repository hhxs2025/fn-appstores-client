package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type WizardSession struct {
	AppID      string
	FPKPath    string
	TmpDir     string
	ExtractDir string
	Config     interface{}
	CreatedAt  time.Time
}

var (
	wizardSessions = map[string]*WizardSession{}
	wizardMu       sync.Mutex
)

func saveWizardSession(id string, s *WizardSession) {
	s.CreatedAt = time.Now()
	wizardMu.Lock()
	wizardSessions[id] = s
	wizardMu.Unlock()
}

func getWizardSession(id string) *WizardSession {
	wizardMu.Lock()
	defer wizardMu.Unlock()
	return wizardSessions[id]
}

func deleteWizardSession(id string) {
	wizardMu.Lock()
	delete(wizardSessions, id)
	wizardMu.Unlock()
}

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

// APIWizardInstall 接收用户填写的向导参数，执行安装
func APIWizardInstall(c *gin.Context) {
	var req struct {
		SessionID string            `json:"session_id"`
		Inputs    map[string]string `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.SessionID == "" {
		c.JSON(400, gin.H{"success": false, "message": "无效数据"})
		return
	}

	sess := getWizardSession(req.SessionID)
	if sess == nil {
		c.JSON(400, gin.H{"success": false, "message": "会话已过期，请重新安装"})
		return
	}

	// 写 wizard.env
	envFile := filepath.Join(sess.ExtractDir, "wizard.env")
	var sb strings.Builder
	for k, v := range req.Inputs {
		sb.WriteString(k + "=" + v + "\n")
		if !strings.HasPrefix(k, "wizard_") {
			sb.WriteString("wizard_" + k + "=" + v + "\n")
		}
	}
	if err := os.WriteFile(envFile, []byte(sb.String()), 0644); err != nil {
		os.RemoveAll(sess.TmpDir)
		deleteWizardSession(req.SessionID)
		c.JSON(500, gin.H{"success": false, "message": "写入环境文件失败"})
		return
	}

	// 清理旧目录
	appID := sess.AppID
	for _, base := range getAppCenterBases() {
		cand := filepath.Join(base, appID)
		if _, err := os.Stat(cand); err == nil {
			os.RemoveAll(cand)
		}
	}
	time.Sleep(1 * time.Second)

	stdout, stderr, err := runAppCenterCLI("install-fpk", sess.FPKPath, "--env", envFile)
	full := stdout + "\n" + stderr

	time.Sleep(3 * time.Second)
	runAppCenterCLI("list", "--refresh")
	time.Sleep(2 * time.Second)
	listOut, _, _ := runAppCenterCLI("list")
	systemOK := strings.Contains(strings.ToLower(listOut), strings.ToLower(appID))
	dirOK := contains(GetInstalledApps(), appID)

	if err != nil && !systemOK && !dirOK {
		msg := parseInstallError(full)
		os.RemoveAll(sess.TmpDir)
		deleteWizardSession(req.SessionID)
		c.JSON(400, gin.H{"success": false, "message": msg})
		return
	}

	// 占位符替换
	targetDir := ""
	for _, base := range getAppCenterBases() {
		cand := filepath.Join(base, appID)
		if _, err := os.Stat(cand); err == nil {
			targetDir = cand
			break
		}
	}
	if targetDir != "" {
		configPath := filepath.Join(targetDir, "app", "ui", "config")
		if data, err := os.ReadFile(configPath); err == nil {
			content := string(data)
			for k, v := range req.Inputs {
				content = strings.ReplaceAll(content, "${"+k+"}", v)
			}
			os.WriteFile(configPath, []byte(content), 0644)
		}
	}

	refreshAppStatus(appID)
	os.RemoveAll(sess.TmpDir)
	deleteWizardSession(req.SessionID)
	logOperation("安装完成", appID+" 带向导安装")
	c.JSON(200, gin.H{"success": true, "message": "安装成功"})
}

func APIWizardCancel(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.SessionID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少会话 ID"})
		return
	}
	sess := getWizardSession(req.SessionID)
	if sess != nil {
		os.RemoveAll(sess.TmpDir)
		deleteWizardSession(req.SessionID)
	}
	c.JSON(200, gin.H{"success": true, "message": "已取消"})
}