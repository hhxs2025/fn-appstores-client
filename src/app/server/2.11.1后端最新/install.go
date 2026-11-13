package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

// ============================================================
// 进度推送接口
// ============================================================
type ProgressSender interface {
	Send(event string, data interface{}) error
}

func sendProgress(sender ProgressSender, event string, data interface{}) {
	if sender == nil {
		return
	}
	if err := sender.Send(event, data); err != nil {
		log.Printf("⚠️ 推送 %s 失败: %v", event, err)
	}
}

func extractURLHost(rawURL string) string {
	if idx := strings.Index(rawURL, "://"); idx != -1 {
		rest := rawURL[idx+3:]
		if slash := strings.Index(rest, "/"); slash != -1 {
			return rest[:slash]
		}
		return rest
	}
	return rawURL
}

// ============================================================
// FPK 解压目录规范
// ★ 此前解压到 DataDir/apps/fpk_extract，和待安装的 .fpk 混在一起。
//   现在按飞牛约定解压到 appcenter-downloads/<appname>-<version>-tpk，
//   .fpk 本体仍留在 DataDir/apps。
// ============================================================

// AppCenterDownloadsDir 返回飞牛系统的应用下载暂存目录（存在才返回）
func AppCenterDownloadsDir() string {
	if v := strings.TrimSpace(os.Getenv("FNSOFT_APPCENTER_DOWNLOADS")); v != "" {
		if st, err := os.Stat(v); err == nil && st.IsDir() {
			return v
		}
		return ""
	}
	patterns := []string{
		"/vol*/@appcenter-downloads",
		"/vol*/appcenter-downloads",
		"/usr/trim/var/appcenter-downloads",
		"/usr/trim/var/appcenter/downloads",
		"/vol*/@appcenter/downloads",
		"/vol*/appcenter/downloads",
		"/var/apps/@appcenter-downloads",
	}
	for _, p := range patterns {
		if matches, _ := filepath.Glob(p); len(matches) > 0 {
			for _, m := range matches {
				if st, err := os.Stat(m); err == nil && st.IsDir() {
					return m
				}
			}
		}
	}
	return ""
}

// ExtractDirForApp 计算 <appcenter-downloads>/<appname>-<version>-tpk
func ExtractDirForApp(appName, version string) (string, bool) {
	base := AppCenterDownloadsDir()
	if base == "" || strings.TrimSpace(appName) == "" {
		return "", false
	}
	name := sanitizeDirName(appName)
	if v := strings.TrimSpace(version); v != "" {
		name += "-" + sanitizeDirName(v)
	}
	name += "-tpk"
	return filepath.Join(base, name), true
}

func sanitizeDirName(s string) string {
	s = strings.TrimSpace(s)
	repl := regexp.MustCompile(`[\\/:*?"<>|\s]+`)
	s = repl.ReplaceAllString(s, "_")
	if s == "" {
		s = "unknown"
	}
	return s
}

// ExtractFPK 解压到系统临时目录（不再污染 DataDir/apps）
func ExtractFPK(fpkPath string) (string, error) {
	dest, err := os.MkdirTemp("", "fnsoft_fpk_")
	if err != nil {
		return "", err
	}
	return ExtractFPKTo(fpkPath, dest)
}

// ExtractFPKTo 把 fpk 解压到指定目录（该目录会先被清空）
func ExtractFPKTo(fpkPath, extractDir string) (string, error) {
	os.RemoveAll(extractDir)
	if err := os.MkdirAll(extractDir, 0755); err != nil {
		return "", err
	}

	f, err := os.Open(fpkPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("解压失败: %v", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		clean := filepath.Clean(hdr.Name)
		if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			continue
		}
		target := filepath.Join(extractDir, clean)

		switch hdr.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(target, 0755)
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(target), 0755)
			out, err := os.Create(target)
			if err != nil {
				continue
			}
			io.Copy(out, tr)
			out.Close()
		}
	}
	return extractDir, nil
}

const useChunkedDownload = false

func downloadWithProgress(url, dst, appID string, sender ProgressSender) error {
	if useChunkedDownload {
		return downloadChunked(url, dst, appID, sender)
	}
	return downloadOnce(url, dst, appID, sender)
}

func validateDownloadedFPK(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("无法读取文件: %v", err)
	}
	if info.Size() < 1024 {
		return fmt.Errorf("文件过小 (%d 字节)，可能是错误页", info.Size())
	}

	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("打开文件失败: %v", err)
	}
	defer f.Close()

	magic := make([]byte, 2)
	if _, err := io.ReadFull(f, magic); err != nil {
		return fmt.Errorf("读取文件头失败: %v", err)
	}
	if magic[0] != 0x1f || magic[1] != 0x8b {
		f.Seek(0, 0)
		head := make([]byte, 512)
		n, _ := f.Read(head)
		head = head[:n]
		headLower := bytes.ToLower(head)
		if bytes.Contains(headLower, []byte("<html")) ||
			bytes.Contains(headLower, []byte("<!doctype")) {
			return fmt.Errorf("下载到的是 HTML 错误页")
		}
		return fmt.Errorf("不是有效的 gzip 文件 (魔数: %02x %02x)", magic[0], magic[1])
	}

	f.Seek(0, 0)
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip 头解析失败: %v", err)
	}
	defer gz.Close()
	tmp := make([]byte, 64)
	gz.Read(tmp)

	return nil
}

func logFileFingerprint(path string) {
	info, err := os.Stat(path)
	if err != nil {
		return
	}
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	h := sha256.New()
	io.Copy(h, f)
	sum := h.Sum(nil)
	log.Printf("[install] 文件指纹: size=%d sha256=%x", info.Size(), sum[:8])
}

// buildAllCandidates 构造尝试顺序 —— 保持 2.11.0 原样：
// 本站 /apps/*.fpk 优先，其余严格按服务端下发的顺序，不做任何重排。
// ★ 加速线路的顺序由服务端后台配置决定（哪些线路、什么顺序），
//   客户端不要自作聪明去分组或调序，否则会打乱用户精心配好的加速池。
func buildAllCandidates(appID string, serverURLs []string) []string {
	var directCandidates []string
	var localCandidates []string
	seen := map[string]bool{}

	for _, u := range serverURLs {
		u = strings.TrimSpace(u)
		if u == "" || seen[u] {
			continue
		}
		seen[u] = true
		if strings.Contains(u, "/apps/") && strings.HasSuffix(u, ".fpk") {
			localCandidates = append(localCandidates, u)
		} else {
			directCandidates = append(directCandidates, u)
		}
	}

	return append(localCandidates, directCandidates...)
}

// ============================================================
// ★ 新增：自定义错误，封装错误码，同时兼容旧函数签名
// ============================================================
type DownloadError struct {
	Code string
	Err  error
}

func (e *DownloadError) Error() string {
	return e.Err.Error()
}

func classifyFileErr(err error) string {
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "过小"), strings.Contains(s, "too small"):
		return "file_too_small"
	case strings.Contains(s, "html"):
		return "html_body"
	case strings.Contains(s, "gzip"):
		return "gzip_invalid"
	}
	return "validate_fail"
}

// ============================================================
// 核心下载函数：2秒首包超时，5秒停滞超时，带细粒度错误码
// ============================================================
func downloadOnce(url, dst, appID string, sender ProgressSender) error {
	const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

	client := &http.Client{
		Timeout: 30 * time.Minute, // ★ 总时长封顶 30 分钟
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("重定向次数过多")
			}
			req.Header.Set("User-Agent", browserUA)
			return nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var startOffset int64 = 0
	if info, err := os.Stat(dst); err == nil {
		startOffset = info.Size()
	}

	// ★ 核心提速：首包超时降至 2 秒
	firstDataReceived := false
	firstDataTimer := time.AfterFunc(2*time.Second, func() {
		log.Printf("[download] ⏱️ 2 秒内未收到数据，强制取消: %s", url)
		cancel()
	})
	defer firstDataTimer.Stop()

	urlHost := extractURLHost(url)

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "*/*")

	if startOffset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", startOffset))
	}

	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "downloading",
		"msg": "连接中...", "progress": 0, "stage": "download",
		"url_host": urlHost,
	})

	// ★ 核心提速：停滞超时降至 5 秒
	stallTimer := time.AfterFunc(5*time.Second, func() {
		log.Printf("[download] ⏱️ 5 秒无新数据，强制取消: %s", url)
		cancel()
	})
	defer stallTimer.Stop()

	resp, err := client.Do(req)
	if err != nil {
		switch {
		case ctx.Err() != nil && !firstDataReceived:
			return &DownloadError{Code: "timeout_first_byte", Err: fmt.Errorf("首包超时(2s)")}
		case ctx.Err() != nil:
			return &DownloadError{Code: "timeout_stall", Err: fmt.Errorf("停滞超时(5s)")}
		case strings.Contains(err.Error(), "no such host"):
			return &DownloadError{Code: "dns_fail", Err: err}
		case strings.Contains(err.Error(), "connection refused"):
			return &DownloadError{Code: "conn_refused", Err: err}
		case strings.Contains(err.Error(), "x509"), strings.Contains(err.Error(), "tls"):
			return &DownloadError{Code: "tls_fail", Err: err}
		}
		return &DownloadError{Code: "network", Err: fmt.Errorf("请求失败: %v", err)}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 416 {
		os.Remove(dst)
		return &DownloadError{Code: "http_4xx", Err: fmt.Errorf("HTTP 416 范围错误")}
	} else if resp.StatusCode == 206 {
		log.Printf("   ⬇️ 断点续传: 从 %d 字节开始, url=%s", startOffset, url)
	} else if resp.StatusCode == 200 {
		if startOffset > 0 {
			startOffset = 0
		}
	} else if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return &DownloadError{Code: "http_4xx", Err: fmt.Errorf("HTTP %d", resp.StatusCode)}
	} else if resp.StatusCode >= 500 {
		return &DownloadError{Code: "http_5xx", Err: fmt.Errorf("HTTP %d", resp.StatusCode)}
	} else {
		return &DownloadError{Code: "http_other", Err: fmt.Errorf("HTTP %d", resp.StatusCode)}
	}

	totalSize := resp.ContentLength
	if resp.StatusCode == 206 {
		totalSize += startOffset
	}

	var out *os.File
	if startOffset > 0 && resp.StatusCode == 206 {
		out, err = os.OpenFile(dst, os.O_WRONLY|os.O_APPEND, 0644)
	} else {
		out, err = os.Create(dst)
	}
	if err != nil {
		return &DownloadError{Code: "file_write", Err: err}
	}
	defer out.Close()

	downloaded := startOffset
	start := time.Now()
	lastProgressTime := time.Now()
	buf := make([]byte, 64*1024)

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if !firstDataReceived {
				firstDataReceived = true
				firstDataTimer.Stop()
			}
			stallTimer.Reset(5 * time.Second) // ★ 数据流动，重置 5 秒停滞计时

			if _, werr := out.Write(buf[:n]); werr != nil {
				return &DownloadError{Code: "file_write", Err: werr}
			}
			downloaded += int64(n)

			if time.Since(lastProgressTime) > 500*time.Millisecond {
				lastProgressTime = time.Now()
				elapsed := time.Since(start).Seconds()
				if elapsed <= 0 { elapsed = 0.01 }
				
				speed := float64(downloaded-startOffset) / elapsed
				speedStr := fmt.Sprintf("%.1f KB/s", speed/1024)
				if speed > 1024*1024 { speedStr = fmt.Sprintf("%.1f MB/s", speed/1024/1024) }

				var msg string
				var progress int
				if totalSize > 0 {
					progress = int(downloaded * 100 / totalSize)
					if progress > 100 { progress = 100 }
					msg = fmt.Sprintf("下载中... %d%%", progress)
				} else {
					msg = fmt.Sprintf("下载中... 已下载 %.1f MB", float64(downloaded)/1024/1024)
					progress = int(float64(downloaded) / 1024 / 1024 * 2)
					if progress > 95 { progress = 95 }
				}

				sendProgress(sender, "progress", map[string]interface{}{
					"app_id":     appID,
					"status":     "downloading",
					"msg":        msg,
					"progress":   progress,
					"speed_str":  speedStr,
					"downloaded": downloaded,
					"total":      totalSize,
					"stage":      "download",
					"url_host":   urlHost,
				})
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return &DownloadError{Code: "timeout_stall", Err: fmt.Errorf("超时中断")}
			}
			return &DownloadError{Code: "read_error", Err: fmt.Errorf("读取中断: %v", readErr)}
		}
	}

	if downloaded == 0 {
		return &DownloadError{Code: "empty_body", Err: fmt.Errorf("下载失败：0 字节")}
	}
	return nil
}

func downloadChunked(url, dst, appID string, sender ProgressSender) error {
	return downloadOnce(url, dst, appID, sender)
}

func isGzipFile(path string) bool {
	f, err := os.Open(path)
	if err != nil { return false }
	defer f.Close()
	magic := make([]byte, 2)
	if _, err := io.ReadFull(f, magic); err != nil { return false }
	return magic[0] == 0x1f && magic[1] == 0x8b
}

func runAppCenterCLI(args ...string) (string, string, error) {
	const cliLogFile = "/tmp/fnsoft-cli.log"
	os.Remove(cliLogFile)

	cmd := exec.Command("/usr/local/bin/appcenter-cli", args...)
	cmd.Env = []string{
		"PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
		"HOME=/root", "USER=root", "LOGNAME=root", "SHELL=/bin/bash",
		"LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TRIM_TEMP_LOGFILE=" + cliLogFile,
	}
	cmd.Dir = "/tmp"
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()

	if extra, e := os.ReadFile(cliLogFile); e == nil && len(extra) > 0 {
		stdout.WriteString("\n[TRIM_TEMP_LOGFILE]\n")
		stdout.Write(extra)
	}
	os.Remove(cliLogFile)
	return stdout.String(), stderr.String(), err
}

func checkAppCenterCLI() {
	const cliPath = "/usr/local/bin/appcenter-cli"
	if _, err := os.Stat(cliPath); err != nil {
		log.Printf("[v2.9.3] ⚠️ appcenter-cli 不存在: %v", err)
		return
	}
}

func isAppStopped(appID string) bool {
	stdout, stderr, err := runAppCenterCLI("status", appID)
	if err != nil { return true }
	lowered := strings.ToLower(stdout + " " + stderr)
	if strings.Contains(lowered, "running") && !strings.Contains(lowered, "not running") {
		return false
	}
	return true
}

func installFPKExhaustive(extraArgs []string, fpkPath string) (string, string, error) {
	inferredVol := getDefaultVolume()
	mountedVols := getMountedVolumes()
	type attempt struct { desc string; args []string }
	var attempts []attempt

	args1 := []string{"install-fpk", fpkPath}
	args1 = append(args1, extraArgs...)
	attempts = append(attempts, attempt{"无 --volume", args1})

	if inferredVol != "" {
		args := []string{"install-fpk", fpkPath, "--volume", inferredVol}
		args = append(args, extraArgs...)
		attempts = append(attempts, attempt{"--volume " + inferredVol, args})
	}
	for _, v := range mountedVols {
		if v == inferredVol { continue }
		args := []string{"install-fpk", fpkPath, "--volume", v}
		args = append(args, extraArgs...)
		attempts = append(attempts, attempt{"--volume " + v, args})
	}

	var lastStdout, lastStderr string
	var lastErr error
	for i, att := range attempts {
		log.Printf("📋 尝试 %d/%d: %s", i+1, len(attempts), att.desc)
		stdout, stderr, err := runAppCenterCLI(att.args...)
		full := stdout + "\n" + stderr
		lastStdout, lastStderr, lastErr = stdout, stderr, err
		if strings.Contains(stdout, "Installation complete") || strings.Contains(full, "is not installed") {
			return stdout, stderr, err
		}
		if !strings.Contains(full, "specify the volume index") && !strings.Contains(full, "volume index") &&
			!strings.Contains(full, "unknown flag") && !strings.Contains(full, "Usage:") {
			return stdout, stderr, err
		}
	}
	return lastStdout, lastStderr, lastErr
}

func getDefaultVolume() string {
	re := regexp.MustCompile(`/vol(\d+)`)
	if v := os.Getenv("TRIM_APPDEST_VOL"); v != "" {
		if m := re.FindStringSubmatch(v); len(m) > 1 { return m[1] }
	}
	if v := os.Getenv("TRIM_APPDEST"); v != "" {
		if m := re.FindStringSubmatch(v); len(m) > 1 { return m[1] }
	}
	matches, _ := filepath.Glob("/vol*/@appcenter")
	for _, m := range matches {
		target := m
		if !strings.HasSuffix(target, "/") { target += "/" }
		if mm := re.FindStringSubmatch(target); len(mm) > 1 { return mm[1] }
	}
	return ""
}

func getMountedVolumes() []string {
	matches, _ := filepath.Glob("/vol*")
	vols := []string{}
	for _, m := range matches {
		name := filepath.Base(m)
		if strings.HasPrefix(name, "vol") { vols = append(vols, strings.TrimPrefix(name, "vol")) }
	}
	return vols
}

func filterEmpty(ss []string) []string {
	out := []string{}
	for _, s := range ss {
		if strings.TrimSpace(s) != "" { out = append(out, strings.TrimSpace(s)) }
	}
	return out
}

func dockerBin() string {
	for _, p := range []string{"/usr/bin/docker", "/usr/local/bin/docker", "/usr/sbin/docker"} {
		if _, err := os.Stat(p); err == nil { return p }
	}
	return "docker"
}
// ============================================================
// 解压目录辅助：搬运 / 标记 / 清理
// ============================================================

const extractMarkerName = ".fnsoft-extract"

// copyDir 递归复制目录
func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			if err := copyDir(s, d); err != nil {
				return err
			}
			continue
		}
		in, err := os.Open(s)
		if err != nil {
			return err
		}
		out, err := os.Create(d)
		if err != nil {
			in.Close()
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			in.Close()
			out.Close()
			return err
		}
		in.Close()
		out.Close()
	}
	return nil
}

// markExtractDir 打上归属标记，避免清理时误删飞牛官方自己的目录
func markExtractDir(dir string) {
	_ = os.WriteFile(filepath.Join(dir, extractMarkerName), []byte("fnsoft"), 0644)
}

// isOwnExtractDir 判断目录是否由本客户端创建
func isOwnExtractDir(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, extractMarkerName))
	return err == nil
}

// cleanOldExtracts 清理超过 48 小时、且由本客户端创建的解压目录
func cleanOldExtracts() {
	base := AppCenterDownloadsDir()
	if base == "" {
		return
	}
	cutoff := time.Now().Add(-48 * time.Hour)
	entries, err := os.ReadDir(base)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasSuffix(e.Name(), "-tpk") {
			continue
		}
		full := filepath.Join(base, e.Name())
		if !isOwnExtractDir(full) {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().Before(cutoff) {
			os.RemoveAll(full)
			log.Printf("[install] 🧹 清理旧解压目录: %s", e.Name())
		}
	}
}

// listOwnExtractDirs 返回本客户端创建的解压目录（带归属标记，可安全删除）
func listOwnExtractDirs() []string {
	out := []string{}
	for _, full := range listAllExtractDirs() {
		if isOwnExtractDir(full) {
			out = append(out, full)
		}
	}
	return out
}

// listAllExtractDirs 返回 appcenter-downloads 下全部 <name>-<ver>-tpk 目录。
// 既包含本客户端解压的，也包含飞牛官方应用中心解压的（不带归属标记）。
// 统计占用时用这个，避免「目录里明明有文件但显示 0」。
func listAllExtractDirs() []string {
	base := AppCenterDownloadsDir()
	if base == "" {
		return nil
	}
	out := []string{}
	entries, err := os.ReadDir(base)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasSuffix(e.Name(), "-tpk") {
			continue
		}
		out = append(out, filepath.Join(base, e.Name()))
	}
	return out
}
