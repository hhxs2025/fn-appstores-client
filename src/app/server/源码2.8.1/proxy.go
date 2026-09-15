package main

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
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
	imageCache        = map[string]imageCacheEntry{}
	imageCacheMu      sync.RWMutex
	allowedHosts      = map[string]bool{}
	allowedHostsMu    sync.RWMutex
	allowedHostsExp   int64
)

var hostRe = regexp.MustCompile(`^https?://([^/:]+)`)

func extractHost(rawURL string) string {
	if m := hostRe.FindStringSubmatch(rawURL); len(m) > 1 {
		return m[1]
	}
	return ""
}

func isAllowedHost(host string) bool {
	allowedHostsMu.RLock()
	now := time.Now().Unix()
	if now-allowedHostsExp < 60 && len(allowedHosts) > 0 {
		ok := allowedHosts[host]
		allowedHostsMu.RUnlock()
		return ok
	}
	allowedHostsMu.RUnlock()

	hosts := map[string]bool{"127.0.0.1": true, "localhost": true}
	for _, s := range LoadSources() {
		if h := extractHost(s.URL); h != "" {
			hosts[h] = true
		}
	}
	for _, app := range GetAllApps(false) {
		if h := extractHost(app.Icon); h != "" {
			hosts[h] = true
		}
		for _, sc := range app.Screenshots {
			if h := extractHost(sc); h != "" {
				hosts[h] = true
			}
		}
	}

	allowedHostsMu.Lock()
	allowedHosts = hosts
	allowedHostsExp = now
	allowedHostsMu.Unlock()
	return hosts[host]
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

	if !isAllowedHost(extractHost(imgURL)) {
		c.String(403, "")
		return
	}

	// 缓存命中
	now := time.Now().Unix()
	imageCacheMu.RLock()
	if entry, ok := imageCache[imgURL]; ok && now-entry.time < ImageCacheTTL {
		imageCacheMu.RUnlock()
		c.Data(200, entry.contentType, entry.body)
		return
	}
	imageCacheMu.RUnlock()

	resp, err := http.Get(imgURL)
	if err != nil {
		c.String(500, "")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
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

	c.Data(200, ct, body)
}