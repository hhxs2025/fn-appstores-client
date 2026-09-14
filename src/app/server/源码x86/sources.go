package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type Source struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Enabled   bool   `json:"enabled"`
	AddedAt   string `json:"added_at,omitempty"`
	Status    string `json:"status,omitempty"`
	StatusMsg string `json:"status_msg,omitempty"`
}

var defaultSources = []Source{
	{
		ID:      "official",
		Name:    "FN软仓官方源",
		URL:     DefaultOfficialURL,
		Enabled: true,
	},
}

var (
	sourceStatusCache = map[string]sourceStatusEntry{}
	sourceCacheTime   time.Time
	sourceCacheMu     sync.RWMutex
)

type sourceStatusEntry struct {
	Status string
	Msg    string
}

func getSourcesPath() string {
	return filepath.Join(DataDir, "sources.json")
}

func LoadSources() []Source {
	data, err := os.ReadFile(getSourcesPath())
	if err != nil {
		SaveSources(defaultSources)
		return append([]Source{}, defaultSources...)
	}
	var sources []Source
	if err := json.Unmarshal(data, &sources); err != nil {
		return append([]Source{}, defaultSources...)
	}
	return sources
}

func SaveSources(sources []Source) error {
	out, _ := json.MarshalIndent(sources, "", "  ")
	return os.WriteFile(getSourcesPath(), out, 0644)
}

func GetEnabledSources() []Source {
	result := []Source{}
	for _, s := range LoadSources() {
		if s.Enabled {
			result = append(result, s)
		}
	}
	return result
}

func TestSourceConnectivity(url string) (bool, string) {
	url = trimSlash(url)
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return false, "地址必须以 http:// 或 https:// 开头"
	}
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("HEAD", url+"/api/apps", nil)
	if err != nil {
		return false, err.Error()
	}
	resp, err := client.Do(req)
	if err != nil {
		if strings.Contains(err.Error(), "timeout") {
			return false, "连接超时"
		}
		return false, "无法连接"
	}
	defer resp.Body.Close()
	if resp.StatusCode < 400 {
		return true, "连接成功"
	}
	return false, fmt.Sprintf("HTTP %d", resp.StatusCode)
}

// ============================================================
// API
// ============================================================
func APISources(c *gin.Context) {
	force := c.Query("force") == "true"
	sources := LoadSources()

	now := time.Now()
	needRefresh := force

	sourceCacheMu.RLock()
	if now.Sub(sourceCacheTime) > SourceCacheTTL*time.Second || len(sourceStatusCache) == 0 {
		needRefresh = true
	}
	sourceCacheMu.RUnlock()

	if needRefresh {
		statusMap := map[string]sourceStatusEntry{}
		for _, s := range sources {
			if s.URL == "" {
				continue
			}
			ok, msg := TestSourceConnectivity(s.URL)
			status := "offline"
			if ok {
				status = "online"
			}
			statusMap[s.URL] = sourceStatusEntry{Status: status, Msg: msg}
		}
		sourceCacheMu.Lock()
		sourceStatusCache = statusMap
		sourceCacheTime = now
		sourceCacheMu.Unlock()
	}

	for i := range sources {
		url := sources[i].URL
		if !sources[i].Enabled {
			sources[i].Status = "disabled"
			sources[i].StatusMsg = "已禁用"
			continue
		}
		sourceCacheMu.RLock()
		entry, ok := sourceStatusCache[url]
		sourceCacheMu.RUnlock()
		if ok {
			sources[i].Status = entry.Status
			sources[i].StatusMsg = entry.Msg
		} else {
			sources[i].Status = "unknown"
			sources[i].StatusMsg = "未检测"
		}
	}

	c.JSON(200, gin.H{"success": true, "data": sources})
}

func APIAddSource(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "无效数据"})
		return
	}
	name := strings.TrimSpace(req.Name)
	url := trimSlash(strings.TrimSpace(req.URL))
	if name == "" || url == "" {
		c.JSON(400, gin.H{"success": false, "message": "名称和地址不能为空"})
		return
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		c.JSON(400, gin.H{"success": false, "message": "地址必须以 http:// 或 https:// 开头"})
		return
	}

	sources := LoadSources()
	for _, s := range sources {
		if s.URL == url {
			c.JSON(400, gin.H{"success": false, "message": "该地址已存在"})
			return
		}
	}

	ok, msg := TestSourceConnectivity(url)
	if !ok {
		c.JSON(400, gin.H{"success": false, "message": "无法连接到该源: " + msg})
		return
	}

	newSrc := Source{
		ID:      fmt.Sprintf("source_%d", time.Now().Unix()),
		Name:    name,
		URL:     url,
		Enabled: true,
		AddedAt: time.Now().Format(time.RFC3339),
	}
	sources = append(sources, newSrc)
	if err := SaveSources(sources); err != nil {
		c.JSON(500, gin.H{"success": false, "message": "保存配置失败"})
		return
	}
	logOperation("添加源", name+" ("+url+")")
	c.JSON(200, gin.H{"success": true, "data": newSrc, "message": "添加成功"})
}

func APIRemoveSource(c *gin.Context) {
	var req struct {
		ID string `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少源 ID"})
		return
	}
	if req.ID == "official" || req.ID == "official_backup" {
		c.JSON(400, gin.H{"success": false, "message": "不能删除官方源"})
		return
	}
	sources := LoadSources()
	newSources := []Source{}
	found := false
	for _, s := range sources {
		if s.ID == req.ID {
			found = true
			continue
		}
		newSources = append(newSources, s)
	}
	if !found {
		c.JSON(404, gin.H{"success": false, "message": "源不存在"})
		return
	}
	SaveSources(newSources)
	logOperation("删除源", req.ID)
	c.JSON(200, gin.H{"success": true, "message": "删除成功"})
}

func APIToggleSource(c *gin.Context) {
	var req struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少源 ID"})
		return
	}
	sources := LoadSources()
	found := false
	for i := range sources {
		if sources[i].ID == req.ID {
			sources[i].Enabled = req.Enabled
			found = true
			break
		}
	}
	if !found {
		c.JSON(404, gin.H{"success": false, "message": "源不存在"})
		return
	}
	SaveSources(sources)
	status := "启用"
	if !req.Enabled {
		status = "禁用"
	}
	logOperation("切换源状态", req.ID+" -> "+status)
	c.JSON(200, gin.H{"success": true, "message": "已" + status})
}

func APITestSource(c *gin.Context) {
	var req struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.URL == "" {
		c.JSON(400, gin.H{"success": false, "message": "地址不能为空"})
		return
	}
	ok, msg := TestSourceConnectivity(req.URL)
	c.JSON(200, gin.H{"success": ok, "message": msg, "url": req.URL})
}