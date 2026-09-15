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
// 下载策略开关
//
// useChunkedDownload = false（默认）：
//   - 一次性 GET 完整下载，不依赖 HEAD / Content-Length / Range
//   - 适合外链托管（Gitee 等），Gitee CDN 冷启动时不会踩坑
//   - 缺点：断线无法续传
//
// useChunkedDownload = true：
//   - 分片 256KB 下载 + 断点续传
//   - 适合本地托管 + frp 穿透场景（避开 frp 长连接截断）
//   - 缺点：依赖 HEAD / Content-Length / Accept-Ranges，Gitee 冷启动易踩坑
// ============================================================
const useChunkedDownload = false

// ============================================================
// 下载入口
// ============================================================
func downloadWithProgress(url, dst, appID string, sender ProgressSender) error {
	if useChunkedDownload {
		return downloadChunked(url, dst, appID, sender)
	}
	return downloadOnce(url, dst, appID, sender)
}

// ============================================================
// 一次性下载（默认路径）
//
// 核心设计：
// 1. 一次 GET，不发送 HEAD
// 2. 不依赖 Content-Length / Accept-Ranges
// 3. 流式写入，节流推送进度
// 4. totalSize 未知时显示"已下载 X MB"，不做百分比
// ============================================================
func downloadOnce(url, dst, appID string, sender ProgressSender) error {
	const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

	client := &http.Client{
		Timeout: 30 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("重定向次数过多")
			}
			// Go 默认跨域重定向会清掉 Referer，导致 Gitee 认成爬虫
			req.Header.Set("User-Agent", browserUA)
			req.Header.Set("Referer", "https://gitee.com/")
			req.Header.Set("Accept", "*/*")
			req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
			return nil
		},
	}

	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "downloading",
		"msg": "连接中...", "progress": 0, "stage": "download",
	})

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Referer", "https://gitee.com/")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	// ContentLength 可能为 -1（CDN 冷启动 / chunked），不用纠结，走"已下载 X MB"分支
	totalSize := resp.ContentLength
	log.Printf("   ⬇️ 一次性下载: totalSize=%d", totalSize)

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	var downloaded int64
	start := time.Now()
	lastProgressTime := time.Now()
	buf := make([]byte, 64*1024)

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				return werr
			}
			downloaded += int64(n)

			if time.Since(lastProgressTime) > 500*time.Millisecond {
				lastProgressTime = time.Now()

				elapsed := time.Since(start).Seconds()
				if elapsed <= 0 {
					elapsed = 0.01
				}
				speed := float64(downloaded) / elapsed
				speedStr := fmt.Sprintf("%.1f KB/s", speed/1024)
				if speed > 1024*1024 {
					speedStr = fmt.Sprintf("%.1f MB/s", speed/1024/1024)
				}

				var msg string
				var progress int
				if totalSize > 0 {
					progress = int(downloaded * 100 / totalSize)
					if progress > 100 {
						progress = 100
					}
					msg = fmt.Sprintf("下载中... %d%%", progress)
				} else {
					msg = fmt.Sprintf("下载中... 已下载 %.1f MB", float64(downloaded)/1024/1024)
					progress = 0
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
				})
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return fmt.Errorf("读取中断: %v（已下载 %d 字节）", readErr, downloaded)
		}
	}

	if downloaded == 0 {
		return fmt.Errorf("下载失败：未获取到任何数据")
	}

	sendProgress(sender, "progress", map[string]interface{}{
		"app_id":     appID,
		"status":     "downloading",
		"msg":        "下载完成",
		"progress":   100,
		"downloaded": downloaded,
		"total":      totalSize,
		"stage":      "download",
	})

	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "extracting",
		"msg": "解压中...", "progress": 100, "stage": "extract",
	})

	return nil
}

// ============================================================
// 分片下载（可选路径，当前默认关闭）
//
// 适用场景：本地托管 + frp 穿透（长连接截断）
// 不适用：外链托管（Gitee CDN 冷启动）
// ============================================================
func downloadChunked(url, dst, appID string, sender ProgressSender) error {
	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "downloading",
		"msg": "连接中...", "progress": 0, "stage": "download",
	})

	const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
	const chunkSize = 256 * 1024
	const maxAttempts = 30

	client := &http.Client{
		Timeout: 120 * time.Second,
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

	// HEAD 探测
	var totalSize int64 = -1
	acceptRanges := false
	{
		headReq, _ := http.NewRequest("HEAD", url, nil)
		headReq.Header.Set("User-Agent", browserUA)
		headReq.Header.Set("Referer", "https://gitee.com/")
		headResp, err := client.Do(headReq)
		if err == nil {
			totalSize = headResp.ContentLength
			ar := strings.ToLower(headResp.Header.Get("Accept-Ranges"))
			acceptRanges = (ar == "bytes")
			headResp.Body.Close()
		}
	}

	log.Printf("   ⬇️ HEAD 结果: size=%d, range=%v", totalSize, acceptRanges)

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	var downloaded int64
	start := time.Now()
	lastProgressTime := time.Now()
	attempt := 0

	pushProgress := func(force bool) {
		now := time.Now()
		if !force && now.Sub(lastProgressTime) < 500*time.Millisecond {
			return
		}
		lastProgressTime = now

		elapsed := time.Since(start).Seconds()
		if elapsed <= 0 {
			elapsed = 0.01
		}
		speed := float64(downloaded) / elapsed
		speedStr := fmt.Sprintf("%.1f KB/s", speed/1024)
		if speed > 1024*1024 {
			speedStr = fmt.Sprintf("%.1f MB/s", speed/1024/1024)
		}

		var msg string
		var progress int
		if totalSize > 0 {
			progress = int(downloaded * 100 / totalSize)
			if progress > 100 {
				progress = 100
			}
			msg = fmt.Sprintf("下载中... %d%%", progress)
		} else {
			msg = fmt.Sprintf("下载中... 已下载 %.1f MB", float64(downloaded)/1024/1024)
			progress = 0
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
		})
	}

	for attempt < maxAttempts {
		attempt++

		if totalSize > 0 && downloaded >= totalSize {
			break
		}

		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", browserUA)
		req.Header.Set("Referer", "https://gitee.com/")
		req.Header.Set("Accept", "*/*")
		req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")

		if acceptRanges {
			end := downloaded + chunkSize - 1
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", downloaded, end))
		}

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("⚠️ 第 %d 次请求失败: %v", attempt, err)
			if attempt >= maxAttempts {
				return fmt.Errorf("下载失败（重试 %d 次）: %v", attempt, err)
			}
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}

		if resp.StatusCode != 200 && resp.StatusCode != 206 {
			resp.Body.Close()
			log.Printf("⚠️ 第 %d 次请求返回 HTTP %d", attempt, resp.StatusCode)
			if attempt >= maxAttempts {
				return fmt.Errorf("下载失败：HTTP %d", resp.StatusCode)
			}
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}

		if totalSize <= 0 && resp.ContentLength > 0 {
			totalSize = resp.ContentLength
			log.Printf("   📏 从响应更新文件大小: %d 字节", totalSize)
		}
		if !acceptRanges {
			ar := strings.ToLower(resp.Header.Get("Accept-Ranges"))
			if ar == "bytes" {
				acceptRanges = true
				log.Printf("   ✅ 检测到 Accept-Ranges: bytes")
			}
		}

		if resp.StatusCode == 200 && downloaded > 0 {
			log.Printf("⚠️ 服务器返回 200，从头下载")
			out.Truncate(0)
			out.Seek(0, 0)
			downloaded = 0
			if totalSize < 0 && resp.ContentLength > 0 {
				totalSize = resp.ContentLength
			}
		}

		if _, err := out.Seek(downloaded, 0); err != nil {
			resp.Body.Close()
			return err
		}

		buf := make([]byte, 32*1024)
		thisRead := int64(0)
		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, werr := out.Write(buf[:n]); werr != nil {
					resp.Body.Close()
					return werr
				}
				downloaded += int64(n)
				thisRead += int64(n)
				pushProgress(false)
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				log.Printf("⚠️ 第 %d 次读取中断: %v（本次 %d 字节，累计 %d）",
					attempt, readErr, thisRead, downloaded)
				break
			}
		}
		resp.Body.Close()

		if totalSize > 0 && downloaded >= totalSize {
			break
		}

		if !acceptRanges {
			if totalSize > 0 && downloaded < totalSize {
				return fmt.Errorf("下载不完整：%d/%d 字节（不支持断点续传）", downloaded, totalSize)
			}
			if thisRead > 0 {
				break
			}
		}

		if thisRead == 0 {
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}

		time.Sleep(100 * time.Millisecond)
	}

	if totalSize > 0 && downloaded != totalSize {
		return fmt.Errorf("下载不完整：%d/%d 字节（重试 %d 次）", downloaded, totalSize, attempt)
	}
	if downloaded == 0 {
		return fmt.Errorf("下载失败：未获取到任何数据")
	}

	sendProgress(sender, "progress", map[string]interface{}{
		"app_id":     appID,
		"status":     "downloading",
		"msg":        "下载完成",
		"progress":   100,
		"downloaded": downloaded,
		"total":      totalSize,
		"stage":      "download",
	})

	sendProgress(sender, "progress", map[string]interface{}{
		"app_id": appID, "status": "extracting",
		"msg": "解压中...", "progress": 100, "stage": "extract",
	})

	return nil
}

// ============================================================
// gzip 魔数校验
//
// 用于检测下载的文件是否为有效 gzip（FPK 外层必须是 gzip）
// 前 2 字节为 0x1f 0x8b 才是合法 gzip
// ============================================================
func isGzipFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	magic := make([]byte, 2)
	if _, err := io.ReadFull(f, magic); err != nil {
		return false
	}
	return magic[0] == 0x1f && magic[1] == 0x8b
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
// 错误解析
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
//
// 下载后校验 gzip 魔数，不是就重试（最多 3 次）
// 用于处理 Gitee CDN 冷启动时首次 GET 返回错误页的情况
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

	// 下载 + gzip 校验 + 最多重试 3 次
	var downloadErr error
	const maxDownloadRetries = 3
	for retry := 0; retry < maxDownloadRetries; retry++ {
		os.Remove(fpkPath)

		downloadErr = downloadWithProgress(downloadURL, fpkPath, appID, sender)
		if downloadErr != nil {
			log.Printf("⚠️ 下载失败（第 %d/%d 次）: %v", retry+1, maxDownloadRetries, downloadErr)
			if retry < maxDownloadRetries-1 {
				time.Sleep(2 * time.Second)
				sendProgress(sender, "progress", map[string]interface{}{
					"app_id": appID, "status": "downloading",
					"msg":        fmt.Sprintf("下载失败，重试中... (%d/%d)", retry+1, maxDownloadRetries),
					"progress":   0,
					"stage":      "download",
				})
				continue
			}
			break
		}

		if isGzipFile(fpkPath) {
			log.Printf("   ✅ 文件校验通过")
			downloadErr = nil
			break
		}

		if info, _ := os.Stat(fpkPath); info != nil {
			log.Printf("   ⚠️ 下载的文件不是有效 gzip（%d 字节），可能是 CDN 冷启动，重试 %d/%d",
				info.Size(), retry+1, maxDownloadRetries)
		}
		downloadErr = fmt.Errorf("文件格式无效")

		if retry < maxDownloadRetries-1 {
			time.Sleep(2 * time.Second)
			sendProgress(sender, "progress", map[string]interface{}{
				"app_id": appID, "status": "downloading",
				"msg":        fmt.Sprintf("文件无效，重试中... (%d/%d)", retry+1, maxDownloadRetries),
				"progress":   0,
				"stage":      "download",
			})
		}
	}

	if downloadErr != nil {
		os.RemoveAll(tmpDir)
		sendProgress(sender, "result", map[string]interface{}{
			"app_id": appID, "status": "error",
			"msg": "下载失败：多次重试后仍无法获取有效文件，请稍后再试",
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