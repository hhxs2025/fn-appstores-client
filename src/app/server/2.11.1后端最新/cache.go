package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// 本地缓存管理（FPK 安装包 / 解压目录 / 图标截图缓存）
//
//   GET  /api/cache/stats          查看各类缓存占用
//   POST /api/cache/clean          清理（scope: fpk|extract|images|all）
//   GET  /api/cache/download?name= 导出某个 fpk 到浏览器
//
// 清理策略：
//   - FPK 安装包存 DataDir/apps，保留 24 小时后由定时任务清理；
//   - 解压结果存 appcenter-downloads/<appname>-<version>-tpk，48 小时清理；
//   - 图标/截图存 DataDir/icons 与 previews，30 天未访问清理。
// ============================================================

type cacheBucket struct {
	Count int   `json:"count"`
	Size  int64 `json:"size"`
}

func scanDir(dir, suffix string) (cacheBucket, []string) {
	b := cacheBucket{}
	names := []string{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return b, names
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if suffix != "" && !strings.HasSuffix(strings.ToLower(e.Name()), suffix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		b.Count++
		b.Size += info.Size()
		names = append(names, e.Name())
	}
	return b, names
}

func APICacheStats(c *gin.Context) {
	appsDir := filepath.Join(DataDir, "apps")
	fpk, fpkNames := scanDir(appsDir, ".fpk")

	latest := ""
	var latestT time.Time
	for _, n := range fpkNames {
		if info, err := os.Stat(filepath.Join(appsDir, n)); err == nil && info.ModTime().After(latestT) {
			latestT = info.ModTime()
			latest = n
		}
	}

	extractCount := 0
	var extractSize int64
	ownExtractCount := 0
	ownDirs := map[string]bool{}
	for _, d := range listOwnExtractDirs() {
		ownDirs[d] = true
	}
	// 统计全部 -tpk 目录（含飞牛官方应用中心自己解压的），否则会显示 0
	for _, d := range listAllExtractDirs() {
		extractCount++
		if ownDirs[d] {
			ownExtractCount++
		}
		extractSize += dirSize(d)
	}

	icons, _ := scanDir(filepath.Join(DataDir, "icons"), "")
	previews, _ := scanDir(filepath.Join(DataDir, "previews"), "")

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"fpk": gin.H{"count": fpk.Count, "size": fpk.Size, "latest": latest},
			"extract": gin.H{
				"count":     extractCount,
				"size":      extractSize,
				"dir":       AppCenterDownloadsDir(),
				"own_count": ownExtractCount,
			},
			"icons":    gin.H{"count": icons.Count, "size": icons.Size},
			"previews": gin.H{"count": previews.Count, "size": previews.Size},
			"apps_dir": appsDir,
		},
	})
}

func APICacheClean(c *gin.Context) {
	var req struct {
		Scope string `json:"scope"`
	}
	_ = c.ShouldBindJSON(&req)
	scope := strings.ToLower(strings.TrimSpace(req.Scope))
	if scope == "" {
		scope = "fpk"
	}

	removed := 0
	var freed int64

	if scope == "fpk" || scope == "all" {
		appsDir := filepath.Join(DataDir, "apps")
		entries, _ := os.ReadDir(appsDir)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".fpk") {
				continue
			}
			if info, err := e.Info(); err == nil {
				freed += info.Size()
				if os.Remove(filepath.Join(appsDir, e.Name())) == nil {
					removed++
				}
			}
		}
	}

	if scope == "extract" || scope == "all" {
		for _, d := range listOwnExtractDirs() {
			freed += dirSize(d)
			if os.RemoveAll(d) == nil {
				removed++
			}
		}
	}

	if scope == "images" || scope == "all" {
		for _, dir := range []string{"icons", "previews"} {
			full := filepath.Join(DataDir, dir)
			entries, _ := os.ReadDir(full)
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				path := filepath.Join(full, e.Name())
				if info, err := e.Info(); err == nil {
					freed += info.Size()
					if os.Remove(path) == nil {
						removed++
					}
				}
			}
		}
		imageCacheMu.Lock()
		imageCache = map[string]imageCacheEntry{}
		imageCacheMu.Unlock()
	}

	log.Printf("[cache] 🧹 清理缓存 scope=%s，删除 %d 项，释放 %s", scope, removed, humanSize(freed))
	c.JSON(200, gin.H{
		"success": true,
		"message": "已清理 " + humanSize(freed),
		"removed": removed,
		"freed":   freed,
	})
}

func APICacheDownload(c *gin.Context) {
	name := filepath.Base(strings.TrimSpace(c.Query("name")))
	if name == "" || name == "." || name == string(filepath.Separator) {
		c.JSON(400, gin.H{"success": false, "message": "缺少文件名"})
		return
	}
	if !strings.HasSuffix(strings.ToLower(name), ".fpk") {
		c.JSON(400, gin.H{"success": false, "message": "只支持导出 fpk 文件"})
		return
	}
	path := filepath.Join(DataDir, "apps", name)
	if _, err := os.Stat(path); err != nil {
		c.JSON(404, gin.H{"success": false, "message": "文件不存在"})
		return
	}
	c.Header("Content-Disposition", "attachment; filename=\""+name+"\"")
	c.File(path)
}

func dirSize(dir string) int64 {
	var total int64
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		full := filepath.Join(dir, e.Name())
		if e.IsDir() {
			total += dirSize(full)
			continue
		}
		if info, err := e.Info(); err == nil {
			total += info.Size()
		}
	}
	return total
}

func humanSize(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	units := []string{"KB", "MB", "GB", "TB"}
	f := float64(n)
	i := -1
	for f >= unit && i < len(units)-1 {
		f /= unit
		i++
	}
	return fmt.Sprintf("%.1f %s", f, units[i])
}

// startCacheJanitor 启动时整理历史目录，并每 6 小时清理一次
func startCacheJanitor() {
	appsDir := filepath.Join(DataDir, "apps")
	legacy := filepath.Join(appsDir, "fpk_extract")
	if _, err := os.Stat(legacy); err == nil {
		os.RemoveAll(legacy)
		log.Printf("[cache] 🧹 已移除历史遗留目录 apps/fpk_extract")
	}
	cleanOldFPKs(appsDir)
	cleanOldExtracts()

	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanOldFPKs(appsDir)
			cleanOldExtracts()
		}
	}()
}
