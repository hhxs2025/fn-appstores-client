package main

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type imageCacheEntry struct {
	contentType string
	body        []byte
	time        int64
}

var (
	imageCache   = map[string]imageCacheEntry{}
	imageCacheMu sync.RWMutex
)

var hostRe = regexp.MustCompile(`^https?://([^/:]+)`)

// ============================================================
// ★ 新增：图片磁盘持久缓存（icons / previews 目录）
//   此前图片只有内存缓存（TTL 600 秒），客户端每次打开都要把
//   全部应用图标重新从源站拉一遍，既慢又耗带宽。
//   现在按 URL 哈希落盘到 DataDir/icons 与 DataDir/previews，
//   重启、清内存缓存后依然命中，并下发浏览器长缓存头。
// ============================================================

var iconExtByCT = map[string]string{
	"image/png":     ".png",
	"image/jpeg":    ".jpg",
	"image/jpg":     ".jpg",
	"image/webp":    ".webp",
	"image/gif":     ".gif",
	"image/svg+xml": ".svg",
	"image/x-icon":  ".ico",
	"image/vnd.microsoft.icon": ".ico",
}

func diskCacheDir(kind string) string {
	if kind == "preview" {
		return "previews"
	}
	return "icons"
}

// ============================================================
// 图片尺寸识别（PNG / JPEG / GIF / WEBP，只读文件头，零依赖）
// 用途：
//   1. kind 参数缺失时（老版本前端或浏览器缓存了旧 JS），
//      按真实宽度自动归类：>=480px 视为截图/轮播图 → previews，
//      否则视为图标 → icons，避免截图全被塞进 icons。
//   2. 启动时把历史上错放到 icons 的大图迁移到 previews。
// ============================================================
const previewWidthThreshold = 480

func imageSizeFromHeader(b []byte) (int, int) {
	if len(b) < 24 {
		return 0, 0
	}
	// PNG: 8 字节签名 + IHDR
	if b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' {
		if len(b) >= 24 {
			w := int(b[16])<<24 | int(b[17])<<16 | int(b[18])<<8 | int(b[19])
			h := int(b[20])<<24 | int(b[21])<<16 | int(b[22])<<8 | int(b[23])
			return w, h
		}
		return 0, 0
	}
	// GIF: "GIF8" + 宽高(小端 2 字节)
	if b[0] == 'G' && b[1] == 'I' && b[2] == 'F' {
		w := int(b[6]) | int(b[7])<<8
		h := int(b[8]) | int(b[9])<<8
		return w, h
	}
	// WEBP (VP8X/VP8 /VP8L)
	if len(b) >= 30 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		switch string(b[12:16]) {
		case "VP8X":
			w := int(b[24]) | int(b[25])<<8 | int(b[26])<<16
			h := int(b[27]) | int(b[28])<<8 | int(b[29])<<16
			return w + 1, h + 1
		case "VP8 ":
			w := int(b[26]) | int(b[27])<<8
			h := int(b[28]) | int(b[29])<<8
			return w & 0x3fff, h & 0x3fff
		case "VP8L":
			if len(b) >= 25 {
				bits := int(b[21]) | int(b[22])<<8 | int(b[23])<<16 | int(b[24])<<24
				return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
			}
		}
		return 0, 0
	}
	// JPEG: 扫描 SOFn 段
	if b[0] == 0xFF && b[1] == 0xD8 {
		i := 2
		for i+9 < len(b) {
			if b[i] != 0xFF {
				i++
				continue
			}
			marker := b[i+1]
			// SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
			if marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC {
				h := int(b[i+5])<<8 | int(b[i+6])
				w := int(b[i+7])<<8 | int(b[i+8])
				return w, h
			}
			segLen := int(b[i+2])<<8 | int(b[i+3])
			if segLen <= 0 {
				break
			}
			i += 2 + segLen
		}
	}
	return 0, 0
}

// classifyImageKind 判定一张图属于「图标」还是「截图/轮播图」。
// 只看宽度会把 512x512、1024x1024 这类方形大图标误判成截图，
// 所以同时要求「横向」——截图的宽高比通常明显大于 1。
func classifyImageKind(body []byte) string {
	w, h := imageSizeFromHeader(body)
	if w <= 0 || h <= 0 {
		return "icon"
	}
	ratio := float64(w) / float64(h)
	// 横向图：截图/轮播图基本都是横的
	if w >= previewWidthThreshold && ratio >= 1.25 {
		return "preview"
	}
	// 超宽幅大图（如 2:1 横幅）
	if w >= 1000 && ratio >= 1.1 {
		return "preview"
	}
	// 竖长图：手机应用截图（如 1080x1920），别当成图标
	if w >= 400 && ratio <= 0.85 {
		return "preview"
	}
	// 其余按方图处理 —— 应用图标通常就是 512x512 / 1024x1024 的正方形
	return "icon"
}


func diskCacheRead(kind, rawURL string) (string, []byte, bool) {
	matches, err := filepath.Glob(filepath.Join(DataDir, diskCacheDir(kind), hexHashPrefix(rawURL)+"*"))
	if err != nil || len(matches) == 0 {
		return "", nil, false
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		return "", nil, false
	}
	ct := contentTypeByExt(filepath.Ext(matches[0]))
	return ct, data, true
}

func hexHashPrefix(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return hex.EncodeToString(sum[:16])
}

func contentTypeByExt(ext string) string {
	for ct, e := range iconExtByCT {
		if e == ext {
			return ct
		}
	}
	if ext == ".img" {
		return "image/png"
	}
	return "image/png"
}

func diskCacheWrite(kind, rawURL, contentType string, body []byte) {
	dir := filepath.Join(DataDir, diskCacheDir(kind))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	ext := iconExtByCT[strings.ToLower(strings.TrimSpace(contentType))]
	if ext == "" {
		ext = ".img"
	}
	// 先清掉同 URL 的旧扩展名文件，避免换格式后出现多份
	prefix := filepath.Join(dir, hexHashPrefix(rawURL))
	if matches, _ := filepath.Glob(prefix + "*"); len(matches) > 0 {
		for _, m := range matches {
			os.Remove(m)
		}
	}
	_ = os.WriteFile(prefix+ext, body, 0644)
}

// reclassifyIconCache 启动时校正历史缓存分类：把放错目录的图各自搬回去。
//   - icons 里的横向大图 → previews（截图/轮播图）
//   - previews 里的方图 → icons（应用图标常是 512/1024 的方图，早年只按宽度判断会误判）
func reclassifyIconCache() {
	iconsDir := filepath.Join(DataDir, "icons")
	previewsDir := filepath.Join(DataDir, "previews")
	os.MkdirAll(iconsDir, 0755)
	os.MkdirAll(previewsDir, 0755)

	moveBy := func(fromDir, toDir, want string) int {
		entries, err := os.ReadDir(fromDir)
		if err != nil {
			return 0
		}
		n := 0
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			src := filepath.Join(fromDir, e.Name())
			f, err := os.Open(src)
			if err != nil {
				continue
			}
			head := make([]byte, 64*1024)
			readN, _ := f.Read(head)
			f.Close()
			if readN < 24 {
				continue
			}
			if classifyImageKind(head[:readN]) != want {
				continue
			}
			if os.Rename(src, filepath.Join(toDir, e.Name())) == nil {
				n++
			}
		}
		return n
	}

	toPreview := moveBy(iconsDir, previewsDir, "preview")
	toIcon := moveBy(previewsDir, iconsDir, "icon")
	if toPreview > 0 || toIcon > 0 {
		log.Printf("[proxy] 🗂️ 缓存归类校正：icons→previews %d 张，previews→icons %d 张", toPreview, toIcon)
	}
}

// 定期清理 30 天未访问的磁盘缓存文件
func cleanDiskImageCache() {
	cutoff := time.Now().Add(-30 * 24 * time.Hour)
	for _, dir := range []string{"icons", "previews"} {
		entries, err := os.ReadDir(filepath.Join(DataDir, dir))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			if info, err := e.Info(); err == nil && info.ModTime().Before(cutoff) {
				os.Remove(filepath.Join(DataDir, dir, e.Name()))
			}
		}
	}
}

func init() {
	go func() {
		// 启动即整理一次历史缓存（把截图从 icons 挪到 previews）
		reclassifyIconCache()
		// 启动 1 小时后先清一次，之后每 6 小时清一次
		time.Sleep(time.Hour)
		cleanDiskImageCache()
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanDiskImageCache()
		}
	}()
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			now := time.Now().Unix()
			imageCacheMu.Lock()
			for k, v := range imageCache {
				// 清理 10 分钟（600秒）之前的图片缓存
				if now-v.time > 600 {
					delete(imageCache, k)
				}
			}
			imageCacheMu.Unlock()
		}
	}()
}

func extractHost(rawURL string) string {
	if m := hostRe.FindStringSubmatch(rawURL); len(m) > 1 {
		return m[1]
	}
	return ""
}

// 判断 URL 的 host 是否属于某个已配置的源
func isManagedHost(rawURL string) bool {
	h := extractHost(rawURL)
	if h == "" {
		return false
	}
	for _, s := range LoadSources() {
		if extractHost(s.URL) == h {
			return true
		}
	}
	return false
}

// http ↔ https 协议互换
func swapScheme(u string) string {
	if strings.HasPrefix(u, "https://") {
		return "http://" + strings.TrimPrefix(u, "https://")
	}
	if strings.HasPrefix(u, "http://") {
		return "https://" + strings.TrimPrefix(u, "http://")
	}
	return u
}

func APIProxyImage(c *gin.Context) {
	rawURL := c.Query("url")
	if rawURL == "" {
		c.String(400, "")
		return
	}
	imgURL, err := url.QueryUnescape(rawURL)
	if err != nil {
		c.String(400, "")
		return
	}
	// ★ kind=preview 时截图/轮播图落盘 previews，kind=icon 时图标落 icons。
	//   未传 kind（老前端 / 浏览器缓存了旧 JS）时进入 auto 模式：
	//   拉取后按图片真实宽度自动归类，防止截图全被塞进 icons。
	kindParam := strings.ToLower(strings.TrimSpace(c.Query("kind")))
	kind := "icon"
	autoClassify := kindParam != "preview" && kindParam != "icon"
	if kindParam == "preview" {
		kind = "preview"
	}

	// ★ 新增：允许浏览器长缓存图标/截图，客户端每次打开不再重复拉图
	c.Header("Cache-Control", "public, max-age=86400")

	// 缓存命中（内存）
	now := time.Now().Unix()
	imageCacheMu.RLock()
	if entry, ok := imageCache[imgURL]; ok && now-entry.time < ImageCacheTTL {
		imageCacheMu.RUnlock()
		c.Data(200, entry.contentType, entry.body)
		return
	}
	imageCacheMu.RUnlock()

	// ★ 新增：缓存命中（磁盘）—— 重启后依然有效
	if autoClassify {
		// auto 模式两个目录都查，命中哪个用哪个
		if ct, data, ok := diskCacheRead("preview", imgURL); ok {
			c.Data(200, ct, data)
			return
		}
	}
	if ct, data, ok := diskCacheRead(kind, imgURL); ok {
		imageCacheMu.Lock()
		imageCache[imgURL] = imageCacheEntry{ct, data, now}
		imageCacheMu.Unlock()
		c.Data(200, ct, data)
		return
	}

	// 带上通用的浏览器 UA，防止被服务端或图床拦截
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest("GET", imgURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	// ★ 携带设备标识：源站 2.11.0 起全局 BanMiddleware 会拦截
	//   未带 X-Client-ID 的 /api/* 请求（FNSOFT_BLOCK_LEGACY=1）
	req.Header.Set("X-Client-ID", ClientID)

	resp, err := client.Do(req)

	// 源托管资源在原协议失败时，自动换协议重试一次
	if err != nil && isManagedHost(imgURL) {
		altURL := swapScheme(imgURL)
		if altURL != imgURL {
			log.Printf("[proxy] 原协议失败(%v)，换协议重试: %s -> %s", err, imgURL, altURL)
			req2, _ := http.NewRequest("GET", altURL, nil)
			req2.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
			req2.Header.Set("X-Client-ID", ClientID)
			resp, err = client.Do(req2)
		}
	}
	if err != nil {
		log.Printf("[proxy] 拉取图片失败: %s, 错误: %v", imgURL, err)
		c.String(500, "")
		return
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 {
		log.Printf("[proxy] 拉取图片被拒绝: %s, HTTP %d", imgURL, resp.StatusCode)
		c.String(resp.StatusCode, "")
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/png"
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, ImageMaxSize+1))
	if err != nil || len(body) > ImageMaxSize {
		c.String(413, "")
		return
	}

	imageCacheMu.Lock()
	imageCache[imgURL] = imageCacheEntry{ct, body, now}
	imageCacheMu.Unlock()

	// ★ auto 模式：按真实宽度决定落盘目录（截图/轮播图 → previews）
	if autoClassify {
		kind = classifyImageKind(body)
	}

	// ★ 新增：同步落盘，供下次启动直接命中
	diskCacheWrite(kind, imgURL, ct, body)

	c.Data(200, ct, body)
}