package main

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ============================================================
// 本地回滚备份
// 每次成功安装后把 FPK 缓存到 DataDir/rollback/
// 升级失败时从这里拿旧版重装，不依赖服务端
// ============================================================

func getRollbackDir() string {
	dir := filepath.Join(DataDir, "rollback")
	_ = os.MkdirAll(dir, 0755)
	return dir
}

func saveRollbackFPK(appID, version, fpkPath string) {
	if appID == "" || version == "" || fpkPath == "" {
		return
	}
	info, err := os.Stat(fpkPath)
	if err != nil {
		log.Printf("[rollback] 保存失败，源文件不存在: %v", err)
		return
	}
	if info.Size() < 1024 {
		log.Printf("[rollback] 保存失败，文件过小: %d 字节", info.Size())
		return
	}

	dir := getRollbackDir()
	dst := filepath.Join(dir, appID+"-"+version+".fpk")

	if err := copyFile(fpkPath, dst); err != nil {
		log.Printf("[rollback] 保存失败: %v", err)
		return
	}
	log.Printf("[rollback] ✅ 已保存备份: %s (%.1f MB)",
		filepath.Base(dst), float64(info.Size())/1024/1024)

	cleanOldRollbackKeepLatest(appID)
}

func findRollbackFPK(appID string) string {
	files, err := listRollbackFiles(appID)
	if err != nil || len(files) == 0 {
		return ""
	}
	return files[0]
}

func listRollbackFiles(appID string) ([]string, error) {
	if appID == "" {
		return nil, nil
	}
	dir := getRollbackDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	prefix := appID + "-"
	type item struct {
		full    string
		modTime int64
	}
	var list []item
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".fpk") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		list = append(list, item{
			full:    filepath.Join(dir, name),
			modTime: info.ModTime().Unix(),
		})
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].modTime > list[j].modTime
	})

	out := make([]string, len(list))
	for i, it := range list {
		out[i] = it.full
	}
	return out, nil
}

func cleanOldRollbackKeepLatest(appID string) {
	files, err := listRollbackFiles(appID)
	if err != nil {
		return
	}
	for i := 1; i < len(files); i++ {
		_ = os.Remove(files[i])
		log.Printf("[rollback] 清理旧备份: %s", filepath.Base(files[i]))
	}
}

func removeFileIfExists(path string) error {
	if path == "" {
		return nil
	}
	if _, err := os.Stat(path); err == nil {
		return os.Remove(path)
	}
	return nil
}