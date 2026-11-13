package main

import (
	"bytes"
	"encoding/json"
	"fmt"
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

func getGatewayUID(c *gin.Context) string { return strings.TrimSpace(c.GetHeader("X-Trim-Userid")) }
func getGatewayIsAdmin(c *gin.Context) bool { return strings.EqualFold(c.GetHeader("X-Trim-Isadmin"), "true") }
func getGatewayUsername(c *gin.Context) string { return strings.TrimSpace(c.GetHeader("X-Trim-Username")) }

// ============================================================
// ★ 新增：公告 5 分钟服务端缓存
//   每次打开客户端首页都会请求一次公告，逐个源去查；
//   加一层短缓存，TTL 内直接返回，减少对源站的请求。
// ============================================================

var (
	noticeCacheMu   sync.Mutex
	noticeCacheData map[string]interface{}
	noticeCacheAt   time.Time
)

func APINotice(c *gin.Context) {
	noticeCacheMu.Lock()
	if noticeCacheData != nil && time.Since(noticeCacheAt) < 5*time.Minute {
		data := noticeCacheData
		noticeCacheMu.Unlock()
		c.JSON(200, data)
		return
	}
	noticeCacheMu.Unlock()

	for _, s := range GetEnabledSources() {
		url := trimSlash(s.URL)
		if url == "" { continue }
		client := &http.Client{Timeout: 3 * time.Second}
		req, err := http.NewRequest("GET", url+"/api/notice", nil)
		if err != nil { continue }
		req.Header.Set("X-Client-ID", ClientID)
		req.Header.Set("X-Device-Type", "fnos")
		req.Header.Set("X-App-Version", Version)

		resp, err := client.Do(req)
		if err != nil { continue }
		body, _ := readAllClose(resp)
		if resp.StatusCode != 200 { continue }
		var data map[string]interface{}
		if json.Unmarshal(body, &data) == nil {
			if enabled, _ := data["enabled"].(bool); enabled {
				noticeCacheMu.Lock()
				noticeCacheData = data
				noticeCacheAt = time.Now()
				noticeCacheMu.Unlock()
				c.JSON(200, data)
				return
			}
		}
	}
	c.JSON(200, gin.H{"enabled": false})
}

// ============================================================
// ★ 新增：推送消息「已送达」持久化去重
//   此前去重只存在浏览器 localStorage（fnsoft_shown_pushes），
//   且右上角「刷新」会调用 clearAppsCache() 把它清掉，导致
//   每次打开客户端同一条推送反复弹窗。现在服务端落盘记录
//   DataDir/cache/push_seen.json，同一条消息只投递一次。
// ============================================================

func pushSeenPath() string {
	return filepath.Join(DataDir, "cache", "push_seen.json")
}

func loadPushSeen() map[string]int64 {
	seen := map[string]int64{}
	data, err := os.ReadFile(pushSeenPath())
	if err == nil {
		_ = json.Unmarshal(data, &seen)
	}
	return seen
}

func savePushSeen(seen map[string]int64) {
	// 超过 2000 条时按时间淘汰最旧的，防止无限膨胀
	if len(seen) > 2000 {
		type kv struct {
			k string
			t int64
		}
		list := make([]kv, 0, len(seen))
		for k, t := range seen {
			list = append(list, kv{k, t})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].t < list[j].t })
		for _, e := range list[:len(seen)-2000] {
			delete(seen, e.k)
		}
	}
	data, err := json.Marshal(seen)
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(pushSeenPath()), 0755)
	_ = os.WriteFile(pushSeenPath(), data, 0644)
}

func APIPushPending(c *gin.Context) {
	clientID := c.GetHeader("X-Client-ID")
	if clientID == "" { clientID = ClientID }
	version := c.GetHeader("X-App-Version")
	if version == "" { version = Version }
	deviceType := c.GetHeader("X-Device-Type")
	if deviceType == "" { deviceType = "fnos" }

	var allMessages []map[string]interface{}

	for _, s := range GetEnabledSources() {
		url := trimSlash(s.URL)
		if url == "" { continue }
		client := &http.Client{Timeout: 3 * time.Second}
		req, err := http.NewRequest("GET", url+"/api/push/pending", nil)
		if err != nil { continue }
		req.Header.Set("X-Client-ID", clientID)
		req.Header.Set("X-Device-Type", deviceType)
		req.Header.Set("X-App-Version", version)

		resp, err := client.Do(req)
		if err != nil { continue }
		body, _ := readAllClose(resp)
		if resp.StatusCode != 200 { continue }

		var wrapper struct {
			Success bool                     `json:"success"`
			Data    []map[string]interface{} `json:"data"`
		}
		if json.Unmarshal(body, &wrapper) == nil && wrapper.Success {
			allMessages = append(allMessages, wrapper.Data...)
		}
	}

	// ★ 已送达的消息不再重复下发（强更消息除外——必须每次都提醒）
	seen := loadPushSeen()
	now := time.Now().Unix()
	pending := make([]map[string]interface{}, 0, len(allMessages))
	dirty := false
	for _, msg := range allMessages {
		id, _ := msg["id"].(string)
		if id == "" {
			if v, ok := msg["id"].(float64); ok {
				id = fmt.Sprintf("%v", v)
				msg["id"] = id
			}
		}
		if id == "" {
			pending = append(pending, msg)
			continue
		}
		if msgType, _ := msg["msg_type"].(string); msgType == "force_update" {
			pending = append(pending, msg)
			continue
		}
		key := clientID + "|" + id
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = now
		dirty = true
		pending = append(pending, msg)
	}
	if dirty {
		savePushSeen(seen)
	}

	c.JSON(200, gin.H{"success": true, "data": pending})
}

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
	req, err := http.NewRequest("GET", trimSlash(officialURL)+"/api/apps", nil)
	if err != nil {
		c.JSON(200, gin.H{"success": true, "has_update": false, "version": current})
		return
	}
	req.Header.Set("X-Client-ID", ClientID)
	req.Header.Set("X-Device-Type", "fnos")
	req.Header.Set("X-App-Version", Version)

	resp, err := client.Do(req)
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
					"success": true, "has_update": true, "version": app.Version,
					"download_url": app.DownloadURL, "release_notes": "更新到 v" + app.Version,
				})
				return
			}
			break
		}
	}
	c.JSON(200, gin.H{"success": true, "has_update": false, "version": current})
}

func APILogs(c *gin.Context) {
	logs := getSanitizedLogs()
	if len(logs) > 500 { logs = logs[len(logs)-500:] }
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

type DownloadTask struct {
	Progress   int
	Status     string
	Path       string
	Msg        string
	UrlHost    string
	SpeedStr   string
	Downloaded int64
	Total      int64
}

var (
	downloadTasks   = make(map[string]*DownloadTask)
	downloadTasksMu sync.Mutex
)

func APIDownloadFPK(c *gin.Context) {
	var req struct {
		AppID    string   `json:"app_id"`
		Platform string   `json:"platform"` // ★ 接收前端传过来的架构
		URLs     []string `json:"urls"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.AppID == "" || len(req.URLs) == 0 {
		c.JSON(400, gin.H{"success": false, "message": "参数错误"})
		return
	}

	taskID := fmt.Sprintf("%s_%d", req.AppID, time.Now().UnixNano())
	downloadTasksMu.Lock()
	downloadTasks[taskID] = &DownloadTask{Progress: 0, Status: "downloading", Msg: "连接中..."}
	downloadTasksMu.Unlock()

	go func() {
		// ★ 修改：FPK 落盘到 DataDir/apps（复用既有目录），替代随机的 /tmp 目录
		appDir := filepath.Join(DataDir, "apps")
		os.MkdirAll(appDir, 0755)
		cleanOldFPKs(appDir)
		fpkPath := filepath.Join(appDir, fmt.Sprintf("%s_%d.fpk", req.AppID, time.Now().UnixNano()))
		candidates := buildAllCandidates(req.AppID, req.URLs)

		if len(candidates) == 0 {
			updateDownloadTask(taskID, 0, "error", "", "没有可用的下载地址", "", "", 0, 0)
			return
		}

		// ★ 修改：不记录任何"加速线路历史"，不做本地跳过，也不上报失败。
		// 服务端给什么顺序就从头试到尾；只保留整轮时间预算，
		// 避免所有线路都不可用时让用户干等一两分钟。
		const roundBudget = 25 * time.Second
		roundStart := time.Now()
		deadline := roundStart.Add(roundBudget)
		tried := 0
		var lastErr error

		success := false

		log.Printf("[download-api] 收到 %d 条候选线路，按服务端顺序依次尝试（无历史跳过、无重试）", len(candidates))

		for _, cand := range candidates {
			if time.Now().After(deadline) {
				log.Printf("[download-api] ⏱️ 整轮已用 %.1fs，超出预算 %s，停止尝试（已试 %d/%d）",
					time.Since(roundStart).Seconds(), roundBudget, tried, len(candidates))
				break
			}

			tried++
			log.Printf("[download-api] 尝试线路 %d/%d: %s", tried, len(candidates), cand)
			sender := &DownloadProgressSender{TaskID: taskID}

			err := downloadOnce(cand, fpkPath, req.AppID, sender)

			if err == nil {
				if verr := validateDownloadedFPK(fpkPath); verr == nil {
					success = true
					break // 成功直接跳出循环
				} else {
					// 文件不完整/被替换：删掉再换下一条，避免下一条在坏文件上续传
					lastErr = verr
					log.Printf("[download-api] 文件校验失败(%s)，继续下一条线路", classifyFileErr(verr))
					os.Remove(fpkPath)
					continue
				}
			}

			lastErr = err
			log.Printf("[download-api] 线路失败: %v", err)
		}

		if !success {
			// 所有尝试过的候选线路都失败了
			os.Remove(fpkPath)
			if lastErr != nil {
				log.Printf("[download-api] 全部失败，最后错误: %v", lastErr)
			}
			updateDownloadTask(taskID, 0, "error", "", "所有线路均不可用，请稍后重试", "", "", 0, 0)
			return
		}
		// ★ 下载并校验成功，通知服务端计数
		go reportDownloadSuccess(req.AppID, req.Platform, taskID)
		updateDownloadTask(taskID, 100, "done", fpkPath, "下载完成", "", "", 0, 0)
	}()

	c.JSON(200, gin.H{"success": true, "task_id": taskID})
}

// 新增：成功上报接口
func reportDownloadSuccess(appID, platform, taskID string) {
	var srcURL string
	for _, a := range GetAllApps(false) {
		if a.ID == appID && a.SourceURL != "" { srcURL = trimSlash(a.SourceURL); break }
	}
	if srcURL == "" { return }

	body, _ := json.Marshal(map[string]string{
		"app_id":   appID,
		"platform": platform,
		"task_id":  taskID,
	})
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("POST", srcURL+"/api/download/report", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Client-ID", ClientID) // 必须带设备 ID
	if resp, err := client.Do(req); err == nil {
		resp.Body.Close()
		log.Printf("[install] 已上报下载成功: app=%s platform=%s", appID, platform)
	}
}


type DownloadProgressSender struct{ TaskID string }

func (s *DownloadProgressSender) Send(event string, data interface{}) error {
	if event == "progress" {
		if d, ok := data.(map[string]interface{}); ok {
			var prog int
			if p, ok := d["progress"].(int); ok {
				prog = p
			} else if p, ok := d["progress"].(float64); ok {
				prog = int(p)
			}
			msg, _ := d["msg"].(string)
			urlHost, _ := d["url_host"].(string)
			speedStr, _ := d["speed_str"].(string)

			var downloaded, total int64
			if dl, ok := d["downloaded"].(int64); ok { downloaded = dl } else if dl, ok := d["downloaded"].(float64); ok { downloaded = int64(dl) }
			if t, ok := d["total"].(int64); ok { total = t } else if t, ok := d["total"].(float64); ok { total = int64(t) }

			downloadTasksMu.Lock()
			if t, exists := downloadTasks[s.TaskID]; exists {
				t.Progress = prog
				t.Msg = msg
				if urlHost != "" { t.UrlHost = urlHost }
				if speedStr != "" { t.SpeedStr = speedStr }
				t.Downloaded = downloaded
				t.Total = total
			}
			downloadTasksMu.Unlock()
		}
	}
	return nil
}

func updateDownloadTask(taskID string, progress int, status, path, msg, urlHost, speedStr string, downloaded, total int64) {
	downloadTasksMu.Lock()
	if t, exists := downloadTasks[taskID]; exists {
		t.Progress = progress
		t.Status = status
		t.Path = path
		t.Msg = msg
		if urlHost != "" { t.UrlHost = urlHost }
		if speedStr != "" { t.SpeedStr = speedStr }
		t.Downloaded = downloaded
		t.Total = total
	}
	downloadTasksMu.Unlock()
}

func APIDownloadStatus(c *gin.Context) {
	taskID := c.Query("task_id")
	downloadTasksMu.Lock()
	task, exists := downloadTasks[taskID]
	downloadTasksMu.Unlock()

	if !exists {
		c.JSON(404, gin.H{"success": false, "message": "任务不存在"})
		return
	}
	c.JSON(200, gin.H{
		"success": true, "progress": task.Progress, "status": task.Status,
		"path": task.Path, "msg": task.Msg, "url_host": task.UrlHost,
		"speed_str": task.SpeedStr, "downloaded": task.Downloaded, "total": task.Total,
	})
}

func APIInstallLocal(c *gin.Context) {
	file, err := c.FormFile("fpk")
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "缺少 fpk 文件"})
		return
	}
	tmpDir, err := os.MkdirTemp("", "fnsoft_upload_")
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "创建临时目录失败"})
		return
	}
	defer os.RemoveAll(tmpDir)

	fpkPath := filepath.Join(tmpDir, filepath.Base(file.Filename))
	if err := c.SaveUploadedFile(file, fpkPath); err != nil {
		c.JSON(500, gin.H{"success": false, "message": "保存文件失败: " + err.Error()})
		return
	}
	if !isGzipFile(fpkPath) {
		c.JSON(400, gin.H{"success": false, "message": "不是有效的 FPK"})
		return
	}
	log.Printf("📤 手动上传接收成功: %s", fpkPath)

	// ★ 修复：此前只保存文件就返回成功，前端却提示「安装成功」。
	//   现在真正调用 appcenter-cli 执行覆盖安装，并回传安装日志供前端展示。
	stdout, stderr, installErr := installFPKExhaustive([]string{}, fpkPath)
	// appcenter-cli 偶尔在安装完成时仍带非零退出码，以输出为准
	installed := installErr == nil || strings.Contains(stdout, "Installation complete") || strings.Contains(stdout+stderr, "already installed")
	if !installed {
		log.Printf("📤 手动安装失败: %v", installErr)
		c.JSON(200, gin.H{
			"success": false,
			"message": "安装失败: " + installErr.Error(),
			"data":    gin.H{"stdout": stdout, "stderr": stderr},
		})
		return
	}
	log.Printf("📤 手动安装完成: %s", file.Filename)
	c.JSON(200, gin.H{
		"success": true,
		"path":    fpkPath,
		"message": "安装成功",
		"data":    gin.H{"stdout": stdout, "stderr": stderr},
	})
}

func APIReadManifest(c *gin.Context) {
	var req struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
		c.JSON(400, gin.H{"success": false, "message": "参数错误"})
		return
	}

	// ★ 解压目录规范：先解到临时目录读清单，再按飞牛约定搬到
	//   <appcenter-downloads>/<appname>-<version>-tpk；
	//   .fpk 本体继续留在 DataDir/apps，apps 下不再产生 fpk_extract。
	cleanOldExtracts()
	tmpDir, err := ExtractFPK(req.Path)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "解压失败: " + err.Error()})
		return
	}
	defer os.RemoveAll(tmpDir)

	manifestPath := filepath.Join(tmpDir, "manifest")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		c.JSON(404, gin.H{"success": false, "message": "未找到 manifest 文件"})
		return
	}
	text := string(data)

	// 计算 appname / version，把解压结果安置到官方暂存目录
	appName := ""
	if m := manifestIDRe.FindStringSubmatch(text); len(m) > 2 {
		appName = strings.TrimSpace(m[2])
	}
	versionHeld := ""
	if m := manifestVerRe.FindStringSubmatch(text); len(m) > 1 {
		versionHeld = strings.TrimSpace(m[1])
	}
	extractDest := ""
	if dest, ok := ExtractDirForApp(appName, versionHeld); ok {
		if err := copyDir(tmpDir, dest); err == nil {
			markExtractDir(dest)
			extractDest = dest
			log.Printf("[install] 📦 已解压到 %s", dest)
		} else {
			log.Printf("[install] ⚠️ 解压结果安置失败: %v", err)
		}
	}

	deps := []string{}
	re := regexp.MustCompile(`(?im)^\s*install_dep_apps\s*[=:]\s*(.+)$`)
	if m := re.FindStringSubmatch(text); len(m) > 1 {
		depStr := strings.TrimSpace(m[1])
		parts := strings.Split(depStr, ":")
		for _, p := range parts {
			name := strings.Split(p, ">")[0]
			name = strings.TrimSpace(name)
			if name != "" { deps = append(deps, name) }
		}
	}

	c.JSON(200, gin.H{"success": true, "dependencies": deps, "extract_dir": extractDest})
}

func readAllClose(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(tmp)
		if n > 0 { buf = append(buf, tmp[:n]...) }
		if err != nil { break }
	}
	return buf, nil
}

// ★ 新增：清理 2 小时前的旧 FPK 安装包，防止 apps 目录无限膨胀
func cleanOldFPKs(dir string) {
	// 保留 24 小时，给用户留出导出/排查的时间
	cutoff := time.Now().Add(-24 * time.Hour)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".fpk") {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().Before(cutoff) {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

func ensureDirs() {
	for _, d := range []string{"apps", "icons", "previews", "cache"} {
		os.MkdirAll(filepath.Join(DataDir, d), 0755)
	}
}