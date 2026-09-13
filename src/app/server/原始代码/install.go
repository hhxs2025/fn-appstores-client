package main

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ============================================================
// 进度推送接口（解耦 WebSocket）
// ============================================================
type ProgressSender interface {
	Send(event string, data interface{}) error
}

// sendProgress 统一包装，记录推送失败但不停业务
func sendProgress(sender ProgressSender, event string, data interface{}) {
	if err := sender.Send(event, data); err != nil {
		log.Printf("⚠️ 推送 %s 失败: %v", event, err)
	}
}

// ============================================================
// FPK 解压
// ============================================================
func ExtractFPK(fpkPath string) (string, error) {
	baseDir := filepath.Dir(fpkPath)
	extractDir := filepath.Join(baseDir, "fpk_extract")
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

// ============================================================
// 向导检测
// ============================================================
func parseWizardConfig(extractDir, wizardType string) interface{} {
	wizardFile := filepath.Join(extractDir, "wizard", wizardType)
	data, err := os.ReadFile(wizardFile)
	if err != nil {
		return nil
	}
	var config interface{}
	if err := jsonUnmarshal(data, &config); err != nil {
		return nil
	}
	return config
}

// ============================================================
// 下载 + 进度推送
// ============================================================
func downloadWithProgress(url, dst, appID string, sender ProgressSender) error {
	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "downloading",
		"msg": "连接中...", "progress": 0, "stage": "download",
	})

	const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

	// 关键：CheckRedirect 在 302 到 Gitee 后重新补 Referer / UA
	// Go 默认在跨域名重定向时会清掉 Referer，导致 Gitee 认成爬虫限速
	client := &http.Client{
		Timeout: 1800 * time.Second, // 30 分钟，大文件也下得完
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("重定向次数过多")
			}
			req.Header.Set("User-Agent", browserUA)
			req.Header.Set("Referer", "https://gitee.com/")
			req.Header.Set("Accept", "*/*")
			req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
			return nil
		},
	}

	req, _ := http.NewRequest("GET", url, nil)
	// 首次请求也伪装浏览器
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Referer", "https://gitee.com/")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("下载失败: HTTP %d", resp.StatusCode)
	}

	total := resp.ContentLength
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	// 64KB 缓冲区，比 8KB 快
	buf := make([]byte, 64*1024)
	var downloaded int64
	start := time.Now()
	lastUpdate := time.Now()

	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			out.Write(buf[:n])
			downloaded += int64(n)
			if time.Since(lastUpdate) > 500*time.Millisecond {
				lastUpdate = time.Now()
				progress := 0
				if total > 0 {
					progress = int(downloaded * 100 / total)
					if progress > 100 {
						progress = 100
					}
				}
				elapsed := time.Since(start).Seconds()
				speed := float64(downloaded) / elapsed
				speedStr := fmt.Sprintf("%.1f KB/s", speed/1024)
				if speed > 1024*1024 {
					speedStr = fmt.Sprintf("%.1f MB/s", speed/1024/1024)
				}
				sendProgress(sender, "progress", map[string]interface{}{
					"app_id":     appID,
					"status":     "downloading",
					"msg":        fmt.Sprintf("下载中... %d%%", progress),
					"progress":   progress,
					"speed_str":  speedStr,
					"downloaded": downloaded,   // ★ 新增：已下载字节
					"total":      total,        // ★ 新增：总字节
					"stage":      "download",
				})
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "extracting",
		"msg": "解压中...", "progress": 100, "stage": "extract",
	})
	return nil
}

// ============================================================
// 调 appcenter-cli
// ============================================================
func runAppCenterCLI(args ...string) (string, string, error) {
	cmd := exec.Command("/usr/local/bin/appcenter-cli", args...)
	cmd.Env = append(os.Environ(),
		"PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
		"HOME=/root",
		"USER=root",
	)
	cmd.Dir = "/tmp"

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

func refreshAppStatus(appID string) {
	runAppCenterCLI("list", "--refresh")
	time.Sleep(2 * time.Second)
	runAppCenterCLI("start", appID)
	time.Sleep(2 * time.Second)
	runAppCenterCLI("list", "--refresh")
}

// ============================================================
// 错误解析（直译 Python parse_docker_error）
// ============================================================
var (
	portInUseRe  = regexp.MustCompile(`(?i)port.*(already in use|address already in use)`)
	imageRe      = regexp.MustCompile(`(?i)image.*(not found|pull|failed to pull)`)
	volumeRe     = regexp.MustCompile(`(?i)(volume|mount).*(failed|error)`)
	containerRe  = regexp.MustCompile(`(?i)container.*(failed|error|create)`)
	daemonRe     = regexp.MustCompile(`(?i)docker.*(daemon|not running)`)
	permissionRe = regexp.MustCompile(`(?i)(permission|denied|权限|不允许)`)
	spaceRe      = regexp.MustCompile(`(?i)(space|no space left|空间)`)
	depRe        = regexp.MustCompile(`(?i)(依赖|dependency|missing.*dependency)`)
	corruptRe    = regexp.MustCompile(`(?i)(corrupt|损坏|invalid|无效)`)
	depNameRe    = regexp.MustCompile(`依赖[：:]\s*([^\s,;.]+)`)
)

func parseInstallError(output string) string {
	if output == "" {
		return "安装失败：请查看系统日志或尝试在应用中心手动安装"
	}
	switch {
	case portInUseRe.MatchString(output):
		return "安装失败：端口被占用，请修改向导中的端口设置"
	case imageRe.MatchString(output):
		return "安装失败：镜像拉取失败，请检查网络或镜像地址"
	case volumeRe.MatchString(output):
		return "安装失败：卷挂载失败，请检查路径格式"
	case containerRe.MatchString(output):
		return "安装失败：容器创建失败，请检查日志"
	case daemonRe.MatchString(output):
		return "安装失败：Docker 服务未运行，请检查飞牛系统"
	case permissionRe.MatchString(output):
		return "安装失败：权限不足，请检查飞牛系统设置"
	case spaceRe.MatchString(output):
		return "安装失败：磁盘空间不足，请清理后重试"
	case depRe.MatchString(output):
		if m := depNameRe.FindStringSubmatch(output); len(m) > 1 {
			return "安装失败：缺少依赖「" + m[1] + "」，请先在应用中心安装该依赖"
		}
		return "安装失败：缺少依赖，请在应用中心查看详情"
	case corruptRe.MatchString(output):
		return "安装失败：安装包可能已损坏，请尝试重新下载"
	}
	return "安装失败：请查看系统日志或尝试在应用中心手动安装"
}

// ============================================================
// 无向导安装
// ============================================================
func installAndReport(appID, fpkPath string, sender ProgressSender) {
	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "installing",
		"msg": "安装中...", "progress": 100, "stage": "install",
	})

	// 清理旧目录
	for _, base := range getAppCenterBases() {
		cand := filepath.Join(base, appID)
		if _, err := os.Stat(cand); err == nil {
			os.RemoveAll(cand)
		}
	}
	time.Sleep(1 * time.Second)

	stdout, stderr, err := runAppCenterCLI("install-fpk", fpkPath)
	time.Sleep(3 * time.Second)
	runAppCenterCLI("list", "--refresh")
	time.Sleep(2 * time.Second)
	listOut, _, _ := runAppCenterCLI("list")

	full := stdout + "\n" + stderr
	systemOK := strings.Contains(strings.ToLower(listOut), strings.ToLower(appID))
	installed := GetInstalledApps()
	dirOK := contains(installed, appID)

	if err == nil && (systemOK || dirOK) {
		refreshAppStatus(appID)
		sendProgress(sender, "result", map[string]interface{}{
			"app_id": appID, "status": "success", "msg": "安装成功",
		})
		logOperation("安装", appID)
		return
	}

	msg := parseInstallError(full)
	sendProgress(sender, "result", map[string]interface{}{
		"app_id": appID, "status": "error", "msg": msg,
	})
	logOperation("安装失败", appID+": "+msg)
}

// ============================================================
// 主入口：带进度安装
// ============================================================
func InstallAppWithProgress(appID, downloadURL string, sender ProgressSender) {
	tmpDir, err := os.MkdirTemp("", "fnsoft_"+appID+"_")
	if err != nil {
		sendProgress(sender, "result", map[string]interface{}{
			"app_id": appID, "status": "error", "msg": "创建临时目录失败",
		})
		return
	}

	fpkPath := filepath.Join(tmpDir, appID+".fpk")
	if err := downloadWithProgress(downloadURL, fpkPath, appID, sender); err != nil {
		os.RemoveAll(tmpDir)
		sendProgress(sender, "result", map[string]interface{}{
			"app_id": appID, "status": "error", "msg": err.Error(),
		})
		return
	}

	extractDir, err := ExtractFPK(fpkPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		sendProgress(sender, "result", map[string]interface{}{
			"app_id": appID, "status": "error", "msg": "解压失败",
		})
		return
	}

	// 检测向导
	if cfg := parseWizardConfig(extractDir, "install"); cfg != nil {
		sessionID := fmt.Sprintf("%s_%d_%s", appID, time.Now().Unix(), randHex(6))
		saveWizardSession(sessionID, &WizardSession{
			AppID:      appID,
			FPKPath:    fpkPath,
			TmpDir:     tmpDir,
			ExtractDir: extractDir,
			Config:     cfg,
		})
		sendProgress(sender, "wizard.show", map[string]interface{}{
			"app_id":     appID,
			"session_id": sessionID,
			"type":       "install",
			"steps":      cfg,
			"title":      "安装向导",
		})
		return
	}

	installAndReport(appID, fpkPath, sender)
	os.RemoveAll(tmpDir)
}