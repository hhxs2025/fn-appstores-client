package main

// ============================================================
// 向导与安装会话已全面废弃
// 前端通过飞牛官方 API 直接接管了 install/info 和 install/task
// 此文件仅用于保留部分结构体以兼容旧接口，防止编译错误
// ============================================================

type WizardSession struct {
	AppID      string
	FPKPath    string
	TmpDir     string
	ExtractDir string
	Config     interface{}
}

// cleanupOldSessions 占位空函数，供 main.go 的定时器调用而不报错
func cleanupOldSessions() {
	// no-op
}