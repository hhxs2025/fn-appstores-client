package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ============================================================
// 版本比较（直接复用服务端 apps.go）
// ============================================================
var versionSegRe = regexp.MustCompile(`[.\-_\s]+`)
var digitsRe = regexp.MustCompile(`\d+`)

func CompareVersions(v1, v2 string) int {
	if v1 == "" || v2 == "" {
		return 0
	}
	p1 := parseVersionParts(v1)
	p2 := parseVersionParts(v2)
	n := len(p1)
	if len(p2) > n {
		n = len(p2)
	}
	for i := 0; i < n; i++ {
		var a, b int
		if i < len(p1) {
			a = p1[i]
		}
		if i < len(p2) {
			b = p2[i]
		}
		if a > b {
			return 1
		}
		if a < b {
			return -1
		}
	}
	return 0
}

func parseVersionParts(s string) []int {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "v")
	s = strings.TrimPrefix(s, "V")
	segs := versionSegRe.Split(s, -1)
	parts := make([]int, 0, len(segs))
	for _, seg := range segs {
		nums := digitsRe.FindString(seg)
		if nums != "" {
			n, _ := strconv.Atoi(nums)
			parts = append(parts, n)
		} else {
			parts = append(parts, 0)
		}
	}
	if len(parts) == 0 {
		parts = []int{0}
	}
	return parts
}

// ============================================================
// 类型容错
// ============================================================
type SortOrderFlex int

func (s *SortOrderFlex) UnmarshalJSON(data []byte) error {
	var n int
	if err := json.Unmarshal(data, &n); err == nil {
		*s = SortOrderFlex(n)
		return nil
	}
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		if v, err2 := strconv.Atoi(str); err2 == nil {
			*s = SortOrderFlex(v)
			return nil
		}
	}
	*s = 0
	return nil
}

type ScreenshotsFlex []string

func (s *ScreenshotsFlex) UnmarshalJSON(data []byte) error {
	var arr []string
	if err := json.Unmarshal(data, &arr); err == nil {
		*s = arr
		return nil
	}
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		if str != "" {
			*s = []string{str}
		} else {
			*s = []string{}
		}
		return nil
	}
	*s = []string{}
	return nil
}

// ============================================================
// 日志（含 URL 脱敏）
// ============================================================
var urlRe = regexp.MustCompile(`https?://[^\s]+`)

func sanitizeLog(text string) string {
	return urlRe.ReplaceAllString(text, "[*****]")
}

func getLogFile() string {
	return filepath.Join(DataDir, "app.log")
}

func logOperation(action, detail string) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	line := "[" + timestamp + "] system - " + action + ": " + sanitizeLog(detail)

	path := getLogFile()
	// 超过 500 行，保留最后 400 行
	if info, err := os.Stat(path); err == nil && info.Size() > 200*1024 {
		data, _ := os.ReadFile(path)
		lines := strings.Split(string(data), "\n")
		if len(lines) > 500 {
			lines = lines[len(lines)-400:]
			os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0644)
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(line + "\n")
}

func getSanitizedLogs() []string {
	data, err := os.ReadFile(getLogFile())
	if err != nil {
		return []string{}
	}
	lines := strings.Split(string(data), "\n")
	result := []string{}
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			result = append(result, sanitizeLog(l))
		}
	}
	return result
}

// ============================================================
// 通用工具
// ============================================================
func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}