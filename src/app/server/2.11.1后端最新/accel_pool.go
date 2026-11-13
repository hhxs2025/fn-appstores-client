package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type accelPoolData struct {
	Version   string   `json:"version"`
	UpdatedAt string   `json:"updated_at"`
	Prefixes  []string `json:"prefixes"`
}

var (
	accelPoolCache     []string
	accelPoolCacheTime time.Time
	accelPoolMu        sync.Mutex
	accelPoolRefreshMu sync.Mutex
)

const accelPoolTTL = 24 * time.Hour

func getAccelPoolPath() string {
	return filepath.Join(DataDir, "accelerators_pool.json")
}

var builtinGitHubAccelerators = []string{
	"https://gh-proxy.com/",
	"https://ghfast.top/",
	"https://ghproxy.net/",
	"https://ghproxy.cc/",
	"https://gh.llkk.cc/",
	"https://github.moeyy.xyz/",
	"https://ghps.cc/",
	"https://gh-proxy.net/",
	"https://ghproxy.homeboyc.cn/",
	"https://ghproxy.cfd/",
	"https://gh.jasonzeng.dev/",
	"https://github.store/",
}

func getAccelPrefixes() []string {
	accelPoolMu.Lock()
	defer accelPoolMu.Unlock()

	if accelPoolCache != nil && time.Since(accelPoolCacheTime) < accelPoolTTL {
		return accelPoolCache
	}

	if data, err := os.ReadFile(getAccelPoolPath()); err == nil {
		var p accelPoolData
		if json.Unmarshal(data, &p) == nil && len(p.Prefixes) > 0 {
			accelPoolCache = p.Prefixes
			accelPoolCacheTime = time.Now()
			return accelPoolCache
		}
	}

	accelPoolCache = builtinGitHubAccelerators
	accelPoolCacheTime = time.Now()
	return accelPoolCache
}

func refreshAccelPool() {
	accelPoolRefreshMu.Lock()
	defer accelPoolRefreshMu.Unlock()

	if data, err := os.ReadFile(getAccelPoolPath()); err == nil {
		var p accelPoolData
		if json.Unmarshal(data, &p) == nil {
			if t, err := time.Parse("2006-01-02 15:04:05", p.UpdatedAt); err == nil {
				if time.Since(t) < accelPoolTTL {
					log.Printf("[accel-pool] 本地缓存 %.1fh 前更新，跳过刷新",
						time.Since(t).Hours())
					return
				}
			}
		}
	}

	doFetchAccelPool()
}

// forceRefreshAccelPool 手动强制刷新（忽略 TTL）
func forceRefreshAccelPool() {
	accelPoolRefreshMu.Lock()
	defer accelPoolRefreshMu.Unlock()

	log.Printf("[accel-pool] 手动强制刷新：删除本地缓存 + 清内存")
	_ = os.Remove(getAccelPoolPath())

	accelPoolMu.Lock()
	accelPoolCache = nil
	accelPoolCacheTime = time.Time{}
	accelPoolMu.Unlock()

	doFetchAccelPool()
}

// doFetchAccelPool 实际拉取（调用方需持有 accelPoolRefreshMu）
func doFetchAccelPool() {
	srcURL := ""
	for _, a := range GetAllApps(false) {
		if a.SourceID == "official" && a.SourceURL != "" {
			srcURL = trimSlash(a.SourceURL)
			break
		}
	}
	if srcURL == "" {
		for _, s := range GetEnabledSources() {
			if s.ID == "official" && s.URL != "" {
				srcURL = trimSlash(s.URL)
				break
			}
		}
	}
	if srcURL == "" {
		log.Printf("[accel-pool] 找不到官方源地址，跳过刷新")
		return
	}

	presetURL := srcURL + "/api/accelerator/presets"
	log.Printf("[accel-pool] 从 %s 拉取加速器池...", presetURL)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(presetURL)
	
	// ★ 新增：主地址请求失败时，尝试备用地址
	if err != nil && DefaultOfficialURLBackup != "" {
		log.Printf("[accel-pool] 主地址失败: %v，尝试备用地址: %s", err, DefaultOfficialURLBackup)
		backupURL := trimSlash(DefaultOfficialURLBackup) + "/api/accelerator/presets"
		resp, err = client.Get(backupURL)
		if err == nil {
			log.Printf("[accel-pool] 备用地址拉取成功")
		} else {
			log.Printf("[accel-pool] 备用地址也失败: %v", err)
		}
	}

	if err != nil {
		log.Printf("[accel-pool] 拉取失败: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		log.Printf("[accel-pool] HTTP %d", resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[accel-pool] 读取响应失败: %v", err)
		return
	}

	var raw struct {
		Version  string `json:"version"`
		Sites    []struct {
			Prefix string `json:"prefix"`
		} `json:"sites"`
		Prefixes []string `json:"prefixes"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		log.Printf("[accel-pool] 解析失败: %v", err)
		return
	}

	prefixes := []string{}
	for _, s := range raw.Sites {
		if s.Prefix != "" && !contains(prefixes, s.Prefix) {
			prefixes = append(prefixes, s.Prefix)
		}
	}
	if len(prefixes) == 0 && len(raw.Prefixes) > 0 {
		prefixes = raw.Prefixes
	}
	if len(prefixes) == 0 {
		log.Printf("[accel-pool] 服务端返回的池子为空，跳过")
		return
	}

	out := accelPoolData{
		Version:   raw.Version,
		UpdatedAt: time.Now().Format("2006-01-02 15:04:05"),
		Prefixes:  prefixes,
	}
	data, _ := json.MarshalIndent(out, "", "  ")
	if err := os.WriteFile(getAccelPoolPath(), data, 0644); err != nil {
		log.Printf("[accel-pool] 写入失败: %v", err)
		return
	}

	accelPoolMu.Lock()
	accelPoolCache = prefixes
	accelPoolCacheTime = time.Now()
	accelPoolMu.Unlock()

	log.Printf("[accel-pool] ✅ 刷新成功: version=%s prefixes=%d", raw.Version, len(prefixes))
}

// APIRefreshAccelPool 手动触发刷新
// POST /api/accel-pool/refresh
func APIRefreshAccelPool(c *gin.Context) {
	log.Printf("[accel-pool] 收到手动刷新请求")

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[accel-pool] 刷新 panic: %v", r)
			}
		}()
		forceRefreshAccelPool()
	}()

	c.JSON(200, gin.H{
		"success": true,
		"message": "已触发刷新，稍后查看日志确认结果",
	})
}