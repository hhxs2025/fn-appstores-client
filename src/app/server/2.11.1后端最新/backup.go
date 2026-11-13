package main

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// 客户端：应用配置备份与恢复 (处理飞牛底层的 @appdata 数据)
// ============================================================

// getAppDataDir 获取飞牛系统中应用的真实数据目录（@appdata）
func getAppDataDir(appID string) string {
	for _, base := range getAppCenterBases() {
		// base 一般是 /vol1/@appcenter
		appdataBase := strings.Replace(base, "@appcenter", "@appdata", 1)
		dir := filepath.Join(appdataBase, appID)
		if _, err := os.Stat(dir); err == nil {
			return dir
		}
	}
	// 兜底尝试
	fallback := filepath.Join("/vol1/@appdata", appID)
	if _, err := os.Stat(fallback); err == nil {
		return fallback
	}
	return ""
}

// ============================================================
// 配置备份 (GET /api/app/:app_id/backup)
// ============================================================
func APIAppBackup(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.String(400, "缺少 app_id")
		return
	}

	appDataDir := getAppDataDir(appID)
	if appDataDir == "" {
		c.String(404, "未找到该应用的数据目录，可能尚未生成配置")
		return
	}

	filename := fmt.Sprintf("%s-backup-%s.zip", appID, time.Now().Format("20060102_150405"))
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("Content-Type", "application/zip")

	zw := zip.NewWriter(c.Writer)
	defer zw.Close()

	err := filepath.Walk(appDataDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		rel, err := filepath.Rel(appDataDir, path)
		if err != nil || rel == "." {
			return nil
		}

		// 排除可能存在的 socket 或 pid 临时文件
		if strings.HasSuffix(path, ".sock") || strings.HasSuffix(path, ".pid") {
			return nil
		}

		if info.IsDir() {
			_, err = zw.Create(rel + "/")
			return nil
		}

		w, err := zw.Create(rel)
		if err != nil {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()
		io.Copy(w, f)
		return nil
	})

	if err != nil {
		log.Printf("[backup] 打包失败: %v", err)
	}
}

// ============================================================
// 配置恢复 (POST /api/app/:app_id/restore)
// ============================================================
func APIAppRestore(c *gin.Context) {
	appID := strings.TrimSpace(c.Param("app_id"))
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "请提供备份文件"})
		return
	}

	appDataDir := getAppDataDir(appID)
	if appDataDir == "" {
		// 如果目录不存在，可能是新装的应用，尝试创建一个基础目录
		for _, base := range getAppCenterBases() {
			appdataBase := strings.Replace(base, "@appcenter", "@appdata", 1)
			dir := filepath.Join(appdataBase, appID)
			if _, err := os.Stat(filepath.Dir(dir)); err == nil {
				_ = os.MkdirAll(dir, 0755)
				appDataDir = dir
				break
			}
		}
		if appDataDir == "" {
			c.JSON(404, gin.H{"success": false, "message": "系统目录不存在，无法恢复"})
			return
		}
	}

	tmpFile := filepath.Join(os.TempDir(), fmt.Sprintf("restore-%d.zip", time.Now().UnixNano()))
	if err := c.SaveUploadedFile(file, tmpFile); err != nil {
		c.JSON(500, gin.H{"success": false, "message": "保存临时文件失败"})
		return
	}
	defer os.Remove(tmpFile)

	// 解压 zip
	r, err := zip.OpenReader(tmpFile)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "不是有效的 zip 文件"})
		return
	}
	defer r.Close()

	for _, f := range r.File {
		path := filepath.Join(appDataDir, f.Name)
		// 防止 zip slip 路径穿越攻击
		if !strings.HasPrefix(path, filepath.Clean(appDataDir)+string(os.PathSeparator)) {
			continue
		}

		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(path, os.ModePerm)
			continue
		}

		_ = os.MkdirAll(filepath.Dir(path), os.ModePerm)
		rc, err := f.Open()
		if err == nil {
			outFile, err := os.Create(path)
			if err == nil {
				_, _ = io.Copy(outFile, rc)
				outFile.Close()
			}
			rc.Close()
		}
	}

	log.Printf("[backup] 应用 %s 配置已恢复，准备重启", appID)
	
	// 恢复后自动重启应用，让它读取旧数据
	runAppCenterCLI("restart", appID)

	c.JSON(200, gin.H{
		"success": true,
		"message": "配置恢复成功，应用已自动重启",
	})
}