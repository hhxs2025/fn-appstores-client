package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// findAppSource 根据 app_id 找到应用来源的源地址
func findAppSource(appID string) string {
	for _, a := range GetAllApps(false) {
		if a.ID == appID {
			return trimSlash(a.SourceURL)
		}
	}
	return ""
}

// outboundClientID 统一返回发往源站的设备标识。
// ★ 2.11.0 服务端新增全局 BanMiddleware：未携带 X-Client-ID 的 /api/* 请求
//   会被当作 legacy 请求直接 403（FNSOFT_BLOCK_LEGACY=1 时），
//   因此所有转发到源站的请求都必须带上设备标识，否则评分会被"误封禁"。
//   优先使用统一网关 uid（与评分 body 的 client_id 保持一致），回退本机 ClientID。
func outboundClientID(c *gin.Context) string {
	if uid := getGatewayUID(c); uid != "" {
		return "uid:" + uid
	}
	return ClientID
}

// APIGetRating 查询评分（转发到对应源）
func APIGetRating(c *gin.Context) {
	appID := c.Param("app_id")
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}

	srcURL := findAppSource(appID)
	if srcURL == "" {
		c.JSON(404, gin.H{"success": false, "message": "应用不存在"})
		return
	}

	// ★ 携带设备标识，避免被服务端 BanMiddleware 拦截
	req, err := http.NewRequest("GET", srcURL+"/api/rating/"+appID, nil)
	if err != nil {
		c.JSON(502, gin.H{"success": false, "message": "构造请求失败"})
		return
	}
	req.Header.Set("X-Client-ID", outboundClientID(c))

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(502, gin.H{"success": false, "message": "源服务不可达"})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
}

// ============================================================
// APISubmitRating 提交评分
// ★ 改造：优先使用统一网关 uid，回退到 client_id
// ============================================================
func APISubmitRating(c *gin.Context) {
	appID := c.Param("app_id")
	if appID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少 app_id"})
		return
	}

	srcURL := findAppSource(appID)
	if srcURL == "" {
		c.JSON(404, gin.H{"success": false, "message": "应用不存在"})
		return
	}

	// 读前端请求体
	var req struct {
		ClientID string `json:"client_id"`
		Rating   int    `json:"rating"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "无效数据"})
		return
	}

	// ★ 优先使用统一网关 uid
	if uid := getGatewayUID(c); uid != "" {
		// 加前缀区分 uid 和 client_id，避免碰撞
		req.ClientID = "uid:" + uid
	} else if req.ClientID == "" {
		c.JSON(400, gin.H{"success": false, "message": "缺少用户标识"})
		return
	}

	if req.Rating < 1 || req.Rating > 5 {
		c.JSON(400, gin.H{"success": false, "message": "评分必须在 1-5 之间"})
		return
	}

	// 重新构造请求体，转发给源服务端
	bodyBytes, _ := json.Marshal(req)

	client := &http.Client{Timeout: 5 * time.Second}
	httpReq, _ := http.NewRequest("POST", srcURL+"/api/rating/"+appID, bytes.NewReader(bodyBytes))
	httpReq.Header.Set("Content-Type", "application/json")
	// ★ 设备标识放入 header（与服务端 BanMiddleware 的识别方式对齐），
	//   此前只放在 JSON body 里，服务端封禁检查根本看不到，且
	//   FNSOFT_BLOCK_LEGACY=1 时整个评分请求都会被 403 拦掉。
	httpReq.Header.Set("X-Client-ID", req.ClientID)

	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("⚠️ 提交评分失败: %v", err)
		c.JSON(502, gin.H{"success": false, "message": "源服务不可达"})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json; charset=utf-8", respBody)
}

// 保留 strings 引用
var _ = strings.TrimSpace