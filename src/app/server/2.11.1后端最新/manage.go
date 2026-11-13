package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// 应用管理：状态 / 启动 / 停止 / 重启 / 卸载 / 强力修复
// ============================================================

func isAppRunning(appID string) bool {
	if appID == "" {
		return false
	}
	stdout, stderr, err := runAppCenterCLI("status", appID)
	if err != nil {
		return false
	}
	lowered := strings.ToLower(stdout + " " + stderr)
	return strings.Contains(lowered, "running") && !strings.Contains(lowered, "not running")
}

func respondAppOp(c *gin.Context, appID, action, stdout, stderr string, err error) {
	payload := gin.H{
		"app_id": appID,
		"action": action,
		"stdout": stdout,
		"stderr": stderr,
	}
	if err != nil {
		payload["error"] = err.Error()
		log.Printf("[manage] %s %s 失败: %v", action, appID, err)
		c.JSON(500, gin.H{
			"success": false,
			"message": action + "失败: " + err.Error(),
			"data":    payload,
		})
		return
	}
	log.Printf("[manage] %s %s 成功", action, appID)
	c.JSON(200, gin.H{
		"success": true,
		"message": action + "成功",
		"data":    payload,
	})
}

// APIAppStatus 获取应用当前运行状态（绿灯/红灯）
func APIAppStatus(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}
	running := isAppRunning(appID)
	c.JSON(200, gin.H{
		"success": true,
		"running": running,
	})
}

func APIStopApp(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}
	if !isAppRunning(appID) {
		c.JSON(200, gin.H{"success": true, "message": "应用已处于停止状态"})
		return
	}
	stdout, stderr, err := runAppCenterCLI("stop", appID)
	respondAppOp(c, appID, "停止", stdout, stderr, err)
}

func APIStartApp(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}
	if isAppRunning(appID) {
		c.JSON(200, gin.H{"success": true, "message": "应用已在运行中"})
		return
	}
	stdout, stderr, err := runAppCenterCLI("start", appID)
	respondAppOp(c, appID, "启动", stdout, stderr, err)
}

func APIRestartApp(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}

	log.Printf("[manage] 重启 %s: stop → 等待 → start", appID)

	stopOut, stopErr, _ := runAppCenterCLI("stop", appID)
	log.Printf("[manage] restart stop stdout=%s stderr=%s", stopOut, stopErr)

	for i := 0; i < 10; i++ {
		if isAppStopped(appID) {
			log.Printf("[manage] restart: 已停止（等待 %d 秒）", i)
			break
		}
		time.Sleep(1 * time.Second)
	}

	stdout, stderr, err := runAppCenterCLI("start", appID)
	respondAppOp(c, appID, "重启", stdout, stderr, err)
}

// APIUninstallApp 兜底卸载接口（优先尝试结束进程，再调用系统卸载，彻底放弃物理删除）
func APIUninstallApp(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}

	log.Printf("[manage] 开始执行兜底卸载流程: %s", appID)

	// 1. 如果它处于“停用”状态，尝试唤醒它，以便随后彻底停止（规避飞牛底层某些卡状态）
	runAppCenterCLI("start", appID)
	time.Sleep(500 * time.Millisecond)

	// 2. 正常停止
	runAppCenterCLI("stop", appID)
	time.Sleep(1 * time.Second)

	// 3. 暴力杀死可能卡住的残留进程
	exec.Command("pkill", "-9", "-f", appID).Run()
	time.Sleep(500 * time.Millisecond)

	// 4. 强制拆除该应用关联的 Docker 容器（如果有）
	out, _ := exec.Command("docker", "ps", "-a", "--filter", "label=com.docker.compose.project="+appID, "-q").Output()
	ids := filterEmpty(strings.Split(strings.TrimSpace(string(out)), "\n"))
	if len(ids) > 0 {
		log.Printf("[manage] 清理 %d 个关联的 Docker 容器", len(ids))
		args := append([]string{"rm", "-f"}, ids...)
		exec.Command("docker", args...).Run()
	}
	time.Sleep(500 * time.Millisecond)

	// 5. 执行底层卸载命令
	stdout, stderr, err := runAppCenterCLI("uninstall", appID)
	fullLog := stdout + "\n" + stderr
	log.Printf("[manage] uninstall 执行结果:\n%s", fullLog)

	// 6. 给系统一点反应时间，强制刷新底层缓存
	time.Sleep(1 * time.Second)
	runAppCenterCLI("list", "--refresh")
	invalidateInstalledCLICache()

	// 7. 清理本地残留的 FPK 回滚备份文件
	if files, _ := listRollbackFiles(appID); len(files) > 0 {
		for _, f := range files {
			_ = removeFileIfExists(f)
		}
	}

	// ⚠️ 注意：此处绝不能用 os.RemoveAll() 物理删除应用目录！
	// 因为如果只删文件不删系统数据库，会导致飞牛产生“幽灵应用”（永远卡在启用状态）。
	// 官方 uninstall 命令执行后，飞牛底层会自动清理干净。

	respondAppOp(c, appID, "卸载", stdout, stderr, err)
}

// ============================================================
// 强力修复：解决无图标、幽灵应用残留、注册失败
// ============================================================
func APIRepairApp(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}

	log.Printf("[manage] 开始极限修复: %s", appID)

	var targetApp *App
	for _, a := range GetAllApps(false) {
		if a.ID == appID {
			targetApp = &a
			break
		}
	}
	if targetApp == nil || len(targetApp.DownloadURLs) == 0 {
		c.JSON(404, gin.H{"success": false, "message": "找不到该应用的下载地址，无法修复"})
		return
	}

	// 1. 停止（如果它在运行）
	runAppCenterCLI("stop", appID)
	for i := 0; i < 10; i++ {
		if isAppStopped(appID) {
			break
		}
		time.Sleep(1 * time.Second)
	}

	// 2. 尝试标准卸载
	runAppCenterCLI("uninstall", appID)
	time.Sleep(1 * time.Second)

	// 3. 极限清理：修复功能里可以物理删除，因为下一步我们要立刻重装，不会有幽灵记录残留
	log.Printf("[manage] 强行清理残留文件...")
	os.RemoveAll(filepath.Join("/var/apps", appID))
	for _, base := range getAppCenterBases() {
		os.RemoveAll(filepath.Join(base, appID))
		appconfBase := strings.Replace(base, "@appcenter", "@appconf", 1)
		os.RemoveAll(filepath.Join(appconfBase, appID))
	}
	exec.Command("pkill", "-9", "-f", appID).Run()
	
	time.Sleep(1 * time.Second)
	runAppCenterCLI("list", "--refresh")

	// 4. 重新下载最新的 FPK 包
	tmpDir, err := os.MkdirTemp("", "fnsoft_repair_"+appID)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "创建临时目录失败"})
		return
	}
	defer os.RemoveAll(tmpDir)

	fpkPath := filepath.Join(tmpDir, appID+".fpk")
	downloadErr := fmt.Errorf("未尝试下载")
	for _, url := range targetApp.DownloadURLs {
		downloadErr = downloadOnce(url, fpkPath, appID, nil)
		if downloadErr == nil {
			break
		}
	}
	if downloadErr != nil {
		c.JSON(500, gin.H{"success": false, "message": "下载 FPK 失败: " + downloadErr.Error()})
		return
	}

	// 5. 重新安装并抓取底层所有输出
	stdout, stderr, err := installFPKExhaustive(nil, fpkPath)
	fullLog := stdout + "\n" + stderr
	log.Printf("[manage] 修复-重装 stdout=%s stderr=%s err=%v", stdout, stderr, err)

	// 6. 检查是否真的安装成功（核心鉴别点）
	statusOut, _, _ := runAppCenterCLI("status", appID)
	if strings.Contains(strings.ToLower(statusOut), "noinstall") {
		c.JSON(500, gin.H{
			"success": false,
			"message": "安装包已解压，但飞牛系统拒绝注册！可能是因为端口被占用，或系统底层状态卡死。",
			"detail":  "状态查询结果: " + statusOut + "\n\n安装底层日志:\n" + fullLog,
		})
		return
	}

	// 7. 启动并强制刷新
	runAppCenterCLI("start", appID)
	runAppCenterCLI("list", "--refresh")
	invalidateInstalledCLICache()

	c.JSON(200, gin.H{
		"success": true,
		"message": "极限清理并重装成功，请刷新飞牛桌面查看图标",
	})
}