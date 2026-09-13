package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type App struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Version     string          `json:"version"`
	Desc        string          `json:"desc,omitempty"`
	Author      string          `json:"author,omitempty"`
	Tags        string          `json:"tags,omitempty"`
	Repo        string          `json:"repo,omitempty"`
	UpdatedAt   string          `json:"updated_at,omitempty"`
	DownloadURL string          `json:"download_url,omitempty"`
	Icon        string          `json:"icon,omitempty"`
	Screenshots ScreenshotsFlex `json:"screenshots,omitempty"`
	Type        string          `json:"type,omitempty"`
	Arch        string          `json:"arch,omitempty"` // x86 / arm / all
	SortOrder   SortOrderFlex   `json:"sort_order"`
	Downloads   int64           `json:"downloads,omitempty"`

	// 客户端运行时字段
	Installed        bool   `json:"installed,omitempty"`
	InstalledVersion string `json:"installed_version,omitempty"`
	HasUpdate        bool   `json:"has_update,omitempty"`

	SourceName string `json:"_source_name,omitempty"`
	SourceURL  string `json:"_source_url,omitempty"`
	SourceID   string `json:"_source_id,omitempty"`
}

var (
	appCache     []App
	appCacheTime time.Time
	appCacheMu   sync.RWMutex
)

// ============================================================
// 从单个源拉取
// ============================================================
func FetchAppsFromSource(s Source) []App {
	url := trimSlash(s.URL)
	if url == "" {
		return []App{}
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url + "/api/apps")
	if err != nil {
		log.Printf("⚠️ 从 %s 拉取失败: %v", s.Name, err)
		return []App{}
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return []App{}
	}
	body, _ := io.ReadAll(resp.Body)
	var wrapper struct {
		Success bool  `json:"success"`
		Data    []App `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapper); err != nil || !wrapper.Success {
		return []App{}
	}
	for i := range wrapper.Data {
		a := &wrapper.Data[i]
		if a.SourceName == "" {
			a.SourceName = s.Name
		}
		if a.SourceID == "" {
			a.SourceID = s.ID
		}
		if a.SourceURL == "" {
			a.SourceURL = s.URL
		}
	}
	log.Printf("✅ 从 %s 拉取 %d 个应用", s.Name, len(wrapper.Data))
	return wrapper.Data
}

// ============================================================
// 合并多源（按 id + arch 去重）
// ============================================================
func MergeAppsFromSources() []App {
	sources := GetEnabledSources()
	if len(sources) == 0 {
		return []App{}
	}

	type fetchResult struct {
		src  Source
		apps []App
	}
	ch := make(chan fetchResult, len(sources))
	for _, s := range sources {
		go func(src Source) {
			ch <- fetchResult{src: src, apps: FetchAppsFromSource(src)}
		}(s)
	}

	appMap := map[string]*App{}
	for i := 0; i < len(sources); i++ {
		r := <-ch
		for j := range r.apps {
			a := r.apps[j]
			key := a.ID
			if a.Arch != "" {
				key = a.ID + "@" + a.Arch
			}
			existing, ok := appMap[key]
			if !ok {
				appMap[key] = &a
				continue
			}
			if CompareVersions(a.Version, existing.Version) > 0 {
				appMap[key] = &a
			}
		}
	}

	result := []App{}
	for _, a := range appMap {
		result = append(result, *a)
	}
	log.Printf("✅ 合并后共 %d 个应用", len(result))
	return result
}

// ============================================================
// 已安装检测
// ============================================================
type InstalledApp struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Dir     string `json:"dir"`
}

func getAppCenterBases() []string {
	bases := []string{}
	if appdest := os.Getenv("TRIM_APPDEST"); appdest != "" {
		parent := filepath.Dir(filepath.Dir(appdest))
		if _, err := os.Stat(parent); err == nil {
			bases = append(bases, parent)
		}
	}
	if appdestVol := os.Getenv("TRIM_APPDEST_VOL"); appdestVol != "" {
		cand := filepath.Join(appdestVol, "@appcenter")
		if _, err := os.Stat(cand); err == nil && !contains(bases, cand) {
			bases = append(bases, cand)
		}
	}
	if len(bases) == 0 {
		matches, _ := filepath.Glob("/vol*/@appcenter")
		for _, m := range matches {
			if _, err := os.Stat(m); err == nil {
				bases = append(bases, m)
			}
		}
	}
	if len(bases) == 0 {
		bases = append(bases, "/vol1/@appcenter")
	}
	return bases
}

func GetInstalledApps() []string {
	installed := []string{}
	for _, base := range getAppCenterBases() {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				installed = append(installed, e.Name())
			}
		}
	}
	sysDir := "/usr/local/apps/@appcenter/"
	if entries, err := os.ReadDir(sysDir); err == nil {
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") && !contains(installed, e.Name()) {
				installed = append(installed, e.Name())
			}
		}
	}
	return installed
}

var manifestVerRe = regexp.MustCompile(`(?im)version\s*[=:]\s*(v?[\d.]+)`)
var manifestIDRe = regexp.MustCompile(`(?im)(appId|appname)\s*[=:]\s*(\S+)`)

func GetInstalledAppsWithVersions() []InstalledApp {
	result := []InstalledApp{}
	for _, base := range getAppCenterBases() {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			appID := e.Name()
			version := ""
			candidates := []string{
				filepath.Join(base, e.Name(), "manifest"),
				filepath.Join(base, e.Name(), "target", "manifest"),
				filepath.Join("/var/apps", e.Name(), "manifest"),
			}
			for _, cand := range candidates {
				data, err := os.ReadFile(cand)
				if err != nil {
					continue
				}
				content := string(data)
				if m := manifestVerRe.FindStringSubmatch(content); len(m) > 1 {
					version = m[1]
				}
				if m := manifestIDRe.FindStringSubmatch(content); len(m) > 2 {
					appID = m[2]
				}
				break
			}
			result = append(result, InstalledApp{ID: appID, Version: version, Dir: e.Name()})
		}
	}
	return result
}

// ============================================================
// 汇总
// ============================================================
func GetAllApps(force bool) []App {
	appCacheMu.RLock()
	if !force && appCache != nil && time.Since(appCacheTime) < AppCacheTTL*time.Second {
		cached := appCache
		appCacheMu.RUnlock()
		return cached
	}
	appCacheMu.RUnlock()

	apps := MergeAppsFromSources()

	installed := GetInstalledApps()
	installedVersions := map[string]string{}
	for _, a := range GetInstalledAppsWithVersions() {
		if a.Version != "" {
			installedVersions[a.ID] = a.Version
		}
	}

	for i := range apps {
		a := &apps[i]
		if contains(installed, a.ID) || installedVersions[a.ID] != "" {
			a.Installed = true
			if v, ok := installedVersions[a.ID]; ok {
				a.InstalledVersion = v
				a.HasUpdate = CompareVersions(a.Version, v) > 0
			}
		}
		// 补全 download_url / icon
		if a.DownloadURL == "" {
			srcURL := trimSlash(a.SourceURL)
			if srcURL != "" {
				a.DownloadURL = fmt.Sprintf("%s/apps/%s-%s.fpk", srcURL, a.ID, a.Version)
			}
		}
		if a.Icon == "" {
			srcURL := trimSlash(a.SourceURL)
			if srcURL != "" {
				a.Icon = fmt.Sprintf("%s/icons/%s.PNG", srcURL, a.ID)
			}
		}
	}

	sort.SliceStable(apps, func(i, j int) bool {
		if apps[i].SortOrder != apps[j].SortOrder {
			return apps[i].SortOrder > apps[j].SortOrder
		}
		return apps[i].UpdatedAt > apps[j].UpdatedAt
	})

	appCacheMu.Lock()
	appCache = apps
	appCacheTime = time.Now()
	appCacheMu.Unlock()
	return apps
}

func InvalidateAppCache() {
	appCacheMu.Lock()
	appCache = nil
	appCacheTime = time.Time{}
	appCacheMu.Unlock()
}

// ============================================================
// API
// ============================================================
func APIApps(c *gin.Context) {
	force := c.Query("force") == "true"
	apps := GetAllApps(force)
	// 客户端自身不显示
	filtered := []App{}
	for _, a := range apps {
		if a.ID == "fn-appstores-client" {
			continue
		}
		filtered = append(filtered, a)
	}
	c.JSON(200, gin.H{"success": true, "data": filtered})
}

func APIRefresh(c *gin.Context) {
	apps := GetAllApps(true)
	c.JSON(200, gin.H{
		"success": true,
		"message": fmt.Sprintf("刷新成功，共 %d 个应用", len(apps)),
		"data":    apps,
	})
}

func APIInstalled(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "apps": GetInstalledAppsWithVersions()})
}

func APIAppDetail(c *gin.Context) {
	id := c.Param("app_id")
	for _, a := range GetAllApps(false) {
		if a.ID == id {
			c.JSON(200, gin.H{"success": true, "data": a})
			return
		}
	}
	c.JSON(404, gin.H{"success": false, "message": "应用不存在"})
}

func APIGatewayUser(c *gin.Context) {
	uid := c.GetHeader("X-Trim-Userid")
	if uid == "" {
		c.JSON(200, gin.H{"success": false, "message": "未通过统一网关访问"})
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"uid":      uid,
			"is_admin": strings.EqualFold(c.GetHeader("X-Trim-Isadmin"), "true"),
			"username": c.GetHeader("X-Trim-Username"),
		},
	})
}