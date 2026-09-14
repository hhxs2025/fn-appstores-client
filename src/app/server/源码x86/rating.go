package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
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

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(srcURL + "/api/rating/" + appID)
	if err != nil {
		c.JSON(502, gin.H{"success": false, "message": "源服务不可达"})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
}

// APISubmitRating 提交评分（转发到对应源）
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

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "无效数据"})
		return
	}

	var req struct {
		ClientID string `json:"client_id"`
		Rating   int    `json:"rating"`
	}
	if err := json.Unmarshal(bodyBytes, &req); err != nil || req.ClientID == "" || req.Rating < 1 || req.Rating > 5 {
		c.JSON(400, gin.H{"success": false, "message": "无效的评分数据"})
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	httpReq, _ := http.NewRequest("POST", srcURL+"/api/rating/"+appID, bytes.NewReader(bodyBytes))
	httpReq.Header.Set("Content-Type", "application/json")

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