package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WSSender 线程安全的 WebSocket 发送器
type WSSender struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (w *WSSender) Send(event string, data interface{}) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteJSON(map[string]interface{}{
		"event": event,
		"data":  data,
	})
}

func HandleWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ WebSocket 升级失败: %v", err)
		return
	}
	defer conn.Close()

	sender := &WSSender{conn: conn}

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var req struct {
			Event string `json:"event"`
			Data  struct {
				AppID       string `json:"app_id"`
				DownloadURL string `json:"download_url"`
			} `json:"data"`
		}
		if err := json.Unmarshal(msg, &req); err != nil {
			continue
		}

		if req.Event == "install" && req.Data.AppID != "" && req.Data.DownloadURL != "" {
			appID := req.Data.AppID
			downloadURL := req.Data.DownloadURL
			go InstallAppWithProgress(appID, downloadURL, sender)
		}
	}
}