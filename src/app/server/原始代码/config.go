package main

import (
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var (
	BaseDir   string
	DataDir   string
	StartMode string
	Port      int
	Version   string
)

const (
	GatewayPrefix      = "/app/fn-appstores-client"
	GatewaySocketName  = "app.sock"
	DefaultPort        = 5660
	DefaultVersion     = "2.7.0"
	DefaultOfficialURL = "http://rc.hhxs2026.top:5660"
	SourceCacheTTL     = 300
	AppCacheTTL        = 86400
	ImageCacheTTL      = 600
	ImageMaxSize       = 10 * 1024 * 1024
)

func initConfig() {
	exe, err := os.Executable()
	if err != nil {
		exe, _ = os.Getwd()
	}
	BaseDir = filepath.Dir(exe)

	DataDir = os.Getenv("TRIM_PKGVAR")
	if DataDir == "" {
		DataDir = filepath.Join(BaseDir, "data")
	}
	if err := os.MkdirAll(DataDir, 0755); err != nil {
		log.Printf("⚠️ 无法创建数据目录: %v", err)
	}

	StartMode = strings.ToLower(getEnv("START_MODE", "gateway"))
	Port = getEnvInt("PORT", DefaultPort)
	Version = detectVersion()
}

// detectVersion 优先 TRIM_APPVER，其次读 manifest
func detectVersion() string {
	if v := os.Getenv("TRIM_APPVER"); v != "" {
		return v
	}
	candidates := []string{
		"/var/apps/fn-appstores-client/manifest",
		filepath.Join(BaseDir, "manifest"),
	}
	verRe := regexp.MustCompile(`(?im)^\s*version\s*[=:]\s*(\S+)`)
	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if m := verRe.FindStringSubmatch(string(data)); len(m) > 1 {
			return strings.TrimSpace(m[1])
		}
	}
	return DefaultVersion
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getEnvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func contains(list []string, item string) bool {
	for _, s := range list {
		if s == item {
			return true
		}
	}
	return false
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}