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
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// 本机架构检测（启动时执行一次）
// ============================================================
var localArch = detectLocalArch()

func detectLocalArch() string {
	switch runtime.GOARCH {
	case "arm64", "arm":
		return "arm"
	case "amd64", "386":
		return "x86"
	default:
		return "x86"
	}
}

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
	Platform    string          `json:"platform,omitempty"`
	SortOrder   SortOrderFlex   `json:"sort_order"`
	Downloads   int64           `json:"downloads,omitempty"`

	RatingAvg   float64 `json:"rating_avg,omitempty"`
	RatingCount int64   `json:"rating_count,omitempty"`

	Installed        bool   `json:"installed,omitempty"`
	InstalledVersion string `json:"installed_version,omitempty"`
	HasUpdate        bool   `json:"has_update,omitempty"`

	SourceName string `json:"_source_name,omitempty"`
	SourceURL  string `json:"_source_url,omitempty"`
	SourceID   string `json:"_source_id,omitempty"`

	DownloadURLs []string `json:"download_urls,omitempty"`
	OriginalDownloadURL string `json:"_original_download_url,omitempty"`
}

var (
	appCache     []App
	appCacheTime time.Time
	appCacheMu   sync.RWMutex
)

// fetchAppsFromSourceOnce 单次拉取（不涉及 fallback）
func fetchAppsFromSourceOnce(s Source) []App {
	url := trimSlash(s.URL)
	if url == "" {
		return []App{}
	}
	client := &http.Client{Timeout: 15 * time.Second}
	
	// ★ 注入设备身份 Header
	req, err := http.NewRequest("GET", url+"/api/apps", nil)
	if err != nil {
		log.Printf("⚠️ 从 %s 构造请求失败: %v", s.Name, err)
		return []App{}
	}
	req.Header.Set("X-Client-ID", ClientID)
	req.Header.Set("X-Device-Type", "fnos-"+runtime.GOARCH)
	req.Header.Set("X-App-Version", Version)
	
	resp, err := client.Do(req)
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

func FetchAppsFromSource(s Source) []App {
	apps := fetchAppsFromSourceOnce(s)

	// ★ 新增：官方源备用地址 fallback
	if len(apps) == 0 && s.ID == "official" && DefaultOfficialURLBackup != "" {
		log.Printf("⚠️ 官方源主地址 %s 拉取失败或返回空，尝试备用地址 %s", s.URL, DefaultOfficialURLBackup)
		backupSrc := s
		backupSrc.URL = DefaultOfficialURLBackup
		apps = fetchAppsFromSourceOnce(backupSrc)
		if len(apps) > 0 {
			log.Printf("✅ 官方源备用地址拉取成功，共 %d 个应用", len(apps))
		} else {
			log.Printf("❌ 官方源备用地址也拉取失败")
		}
	}

	return apps
}

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
			if a.Platform != "" {
				key = a.ID + "@" + a.Platform
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

type InstalledApp struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Dir     string `json:"dir"`
}

func getAppCenterBases() []string {
	bases := []string{}
	if paths := os.Getenv("TRIM_DATA_ACCESSIBLE_PATHS"); paths != "" {
		for _, p := range strings.Split(paths, ":") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if !strings.HasSuffix(p, "@appcenter") {
				continue
			}
			if _, err := os.Stat(p); err == nil && !contains(bases, p) {
				bases = append(bases, p)
				log.Printf("📁 从 TRIM_DATA_ACCESSIBLE_PATHS 获取: %s", p)
			}
		}
	}

	patterns := []string{
		"/vol*/@appcenter",
		"/vol*/@appcenter/",
		"/volume*/@appcenter",
	}
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		for _, m := range matches {
			m = strings.TrimSuffix(m, "/")
			if _, err := os.Stat(m); err == nil && !contains(bases, m) {
				bases = append(bases, m)
			}
		}
	}

	if appdestVol := os.Getenv("TRIM_APPDEST_VOL"); appdestVol != "" {
		cand := filepath.Join(appdestVol, "@appcenter")
		if _, err := os.Stat(cand); err == nil && !contains(bases, cand) {
			bases = append(bases, cand)
		}
	}

	if len(bases) == 0 {
		bases = append(bases, "/vol1/@appcenter")
	}

	return bases
}

func getAllAppCenterBases() []string {
	bases := getAppCenterBases()
	sysDir := "/usr/local/apps/@appcenter"
	if _, err := os.Stat(sysDir); err == nil && !contains(bases, sysDir) {
		bases = append(bases, sysDir)
	}
	return bases
}

func GetInstalledApps() []string {
	installed := []string{}
	for _, base := range getAllAppCenterBases() {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				if !contains(installed, e.Name()) {
					installed = append(installed, e.Name())
				}
			}
		}
	}
	return installed
}

var manifestVerRe = regexp.MustCompile(`(?im)version\s*[=:]\s*(v?[\d.]+)`)
var manifestIDRe = regexp.MustCompile(`(?im)(appId|appname)\s*[=:]\s*(\S+)`)

var (
	installedCLICache     map[string]string
	installedCLICacheTime time.Time
	installedCLICacheMu   sync.Mutex
)

const installedCLICacheTTL = 5 * time.Second

func invalidateInstalledCLICache() {
	installedCLICacheMu.Lock()
	installedCLICache = nil
	installedCLICacheTime = time.Time{}
	installedCLICacheMu.Unlock()
}

var cliVerRe = regexp.MustCompile(`^v?[\d.]+$`)

func getInstalledVersionsFromCLI(forceRefresh ...bool) map[string]string {
	force := len(forceRefresh) > 0 && forceRefresh[0]

	installedCLICacheMu.Lock()
	defer installedCLICacheMu.Unlock()

	if !force && installedCLICache != nil && time.Since(installedCLICacheTime) < installedCLICacheTTL {
		return installedCLICache
	}

	result := map[string]string{}
	stdout, _, err := runAppCenterCLI("list", "--refresh")
	if err != nil {
		log.Printf("⚠️ appcenter-cli list 失败: %v，回退到 manifest", err)
		return result
	}
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 3 {
			continue
		}
		id := strings.TrimSpace(parts[0])
		ver := strings.TrimSpace(parts[2])
		if id == "" || !cliVerRe.MatchString(ver) {
			continue
		}
		result[id] = ver
	}

	installedCLICache = result
	installedCLICacheTime = time.Now()
	return result
}

func readManifestVersion(appID, dir string) string {
	for _, base := range getAllAppCenterBases() {
		for _, cand := range []string{
			filepath.Join(base, dir, "manifest"),
			filepath.Join(base, dir, "target", "manifest"),
			filepath.Join("/var/apps", appID, "manifest"),
			filepath.Join("/var/apps", appID, "target", "manifest"),
		} {
			if data, err := os.ReadFile(cand); err == nil {
				if m := manifestVerRe.FindStringSubmatch(string(data)); len(m) > 1 {
					return strings.TrimSpace(m[1])
				}
			}
		}
	}
	return ""
}

func GetInstalledAppsWithVersions(forceRefresh ...bool) []InstalledApp {
	cliVersions := getInstalledVersionsFromCLI(forceRefresh...)

	installedDirs := map[string]string{}
	for _, base := range getAllAppCenterBases() {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if _, ok := installedDirs[e.Name()]; !ok {
				installedDirs[e.Name()] = e.Name()
			}
		}
	}

	result := []InstalledApp{}
	seen := map[string]bool{}
	for id, dir := range installedDirs {
		version := cliVersions[id]
		if version == "" {
			version = readManifestVersion(id, dir)
		}
		result = append(result, InstalledApp{ID: id, Version: version, Dir: dir})
		seen[id] = true
	}

	for id, ver := range cliVersions {
		if seen[id] || ver == "" {
			continue
		}
		result = append(result, InstalledApp{ID: id, Version: ver, Dir: id})
	}
	return result
}

func platformMatches(appPlatform string) bool {
	p := strings.ToLower(strings.TrimSpace(appPlatform))

	if p == "" {
		p = "x86"
	}
	if p == "all" || p == "通用" || p == "universal" {
		return true
	}
	switch p {
	case "aarch64", "arm64":
		p = "arm"
	case "amd64", "x86_64":
		p = "x86"
	}

	return p == localArch
}

func GetAllApps(force bool) []App {
	appCacheMu.RLock()
	if !force && appCache != nil && time.Since(appCacheTime) < AppCacheTTL*time.Second {
		cached := appCache
		appCacheMu.RUnlock()
		return cached
	}
	appCacheMu.RUnlock()

	apps := MergeAppsFromSources()

	filtered := make([]App, 0, len(apps))
	for _, a := range apps {
		if platformMatches(a.Platform) {
			filtered = append(filtered, a)
		} else {
			log.Printf("⏭️ 跳过不兼容应用: %s v%s (platform=%s, 本机=%s)",
				a.ID, a.Version, a.Platform, localArch)
		}
	}
	apps = filtered

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

func APIApps(c *gin.Context) {
	force := c.Query("force") == "true"
	apps := GetAllApps(force)
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
	// ?refresh=1 跳过 5 秒 CLI 缓存：安装/更新后回查版本用它，
	// 否则可能读到任务提交前缓存的旧版本号，把"没装上"误判成"装上了"。
	force := c.Query("refresh") == "1"
	c.JSON(200, gin.H{"success": true, "apps": GetInstalledAppsWithVersions(force)})
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

// ============================================================
// APISysInfo 返回真实系统信息（用于设置页架构显示）
// ============================================================
func APISysInfo(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"arch":    runtime.GOARCH,
		"os":      runtime.GOOS,
	})
}