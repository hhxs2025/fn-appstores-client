package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"path/filepath"
	"strings"
)

var ClientID string

// InitDeviceInfo 初始化设备唯一标识
func InitDeviceInfo() {
	// 1. 最高优先级：读取飞牛系统注入的环境变量（真实设备机器码）
	if machineID := strings.TrimSpace(os.Getenv("TRIM_SYS_MACHINE_ID")); machineID != "" {
		ClientID = "fnos_" + machineID
		log.Printf("📱 已读取飞牛底层设备标识: %s", ClientID)
		return
	}

	// 2. 次高优先级：读取 Linux 系统的 machine-id
	if data, err := os.ReadFile("/etc/machine-id"); err == nil {
		machineID := strings.TrimSpace(string(data))
		if machineID != "" {
			ClientID = "linux_" + machineID
			log.Printf("📱 已读取 Linux 系统机器码: %s", ClientID)
			return
		}
	}

	// 3. 兜底方案：读本地文件缓存的 UUID
	idFile := filepath.Join(DataDir, "client_id.txt")
	if data, err := os.ReadFile(idFile); err == nil {
		ClientID = strings.TrimSpace(string(data))
	}
	
	// 4. 如果都没有，生成一个新的 UUID 并保存
	if ClientID == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err == nil {
			ClientID = "fnrc_" + hex.EncodeToString(b)
		} else {
			ClientID = "fnrc_fallback_id"
		}
		_ = os.WriteFile(idFile, []byte(ClientID), 0644)
		log.Printf("📱 生成新的应用级设备标识: %s", ClientID)
	} else {
		log.Printf("📱 已加载应用级设备标识: %s", ClientID)
	}
}