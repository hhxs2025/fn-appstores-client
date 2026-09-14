package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// 公告：从启用源中取第一个 enabled=true 的
// ============================================================
func APINotice(c *gin.Context) {
	for _, s := range GetEnabledSources() {
		url := trimSlash(s.URL)
		if url == "" {
			continue
		}
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get(url + "/api/notice")
		if err != nil {
			continue
		}
		body, _ := readAllClose(resp)
		if resp.StatusCode != 200 {
			continue
		}
		var data map[string]interface{}
		if json.Unmarshal(body, &data) == nil {
			if enabled, _ := data["enabled"].(bool); enabled {
				c.JSON(200, data)
				return
			}
		}
	}
	c.JSON(200, gin.H{"enabled": false})
}

// ============================================================
// 客户端自更新
// ============================================================
func APICheckUpdate(c *gin.Context) {
	current := Version
	officialURL := ""
	for _, s := range LoadSources() {
		if s.ID == "official" {
			officialURL = s.URL
			break
		}
	}
	if officialURL == "" {
		c.JSON(200, gin.H{"success": true, "has_update": false, "version": current})
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(trimSlash(officialURL) + "/api/apps")
	if err != nil {
		c.JSON(200, gin.H{"success": true, "has_update": false, "version": current})
		return
	}
	defer resp.Body.Close()
	body, _ := readAllClose(resp)

	var wrapper struct {
		Success bool  `json:"success"`
		Data    []App `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapper); err != nil || !wrapper.Success {
		c.JSON(200, gin.H{"success": true, "has_update": false, "version": current})
		return
	}

	for _, app := range wrapper.Data {
		if app.ID == "fn-appstores-client" {
			if CompareVersions(app.Version, current) > 0 && app.DownloadURL != "" {
				c.JSON(200, gin.H{
					"success":      true,
					"has_update":   true,
					"version":      app.Version,
					"download_url": app.DownloadURL,
					"release_notes": "更新到 v" + app.Version,
				})
				return
			}
			break
		}
	}
	c.JSON(200, gin.H{"success": true, "has_update": false, "version": current})
}

// ============================================================
// 日志
// ============================================================
func APILogs(c *gin.Context) {
	logs := getSanitizedLogs()
	if len(logs) > 500 {
		logs = logs[len(logs)-500:]
	}
	c.JSON(200, gin.H{"success": true, "data": logs})
}

func APILogsExport(c *gin.Context) {
	path := getLogFile()
	data, err := os.ReadFile(path)
	if err != nil {
		c.JSON(404, gin.H{"success": false, "message": "日志文件不存在"})
		return
	}
	filename := "fnsoft_log_" + time.Now().Format("20060102_150405") + ".txt"
	c.Header("Content-Disposition", "attachment; filename="+filename)
	c.Data(200, "text/plain; charset=utf-8", []byte(sanitizeLog(string(data))))
}

// ============================================================
// 工具
// ============================================================
func readAllClose(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if err != nil {
			break
		}
	}
	return buf, nil
}

// 保留 stub，供 FPK 初始化使用
func ensureDirs() {
	for _, d := range []string{"apps", "icons", "previews", "cache"} {
		os.MkdirAll(filepath.Join(DataDir, d), 0755)
	}
}