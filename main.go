// Command battleship serves a two-player online Battleship game: the web
// client and a WebSocket endpoint where the server holds all game state.
package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := ":8080"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}
	s := newServer()
	static, _ := fs.Sub(webFS, "web")
	http.Handle("/", http.FileServerFS(static))
	http.HandleFunc("/ws", s.serveWS)
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func (s *server) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil) // nil options = same-origin only
	if err != nil {
		return
	}
	defer conn.CloseNow()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	c := &client{send: make(chan msgOut, 32), kick: cancel}
	s.connect(c)
	defer s.disconnect(c)
	go writeLoop(ctx, conn, c)

	for {
		var m msgIn
		if err := wsjson.Read(ctx, conn, &m); err != nil {
			return
		}
		s.handle(c, m)
	}
}

func writeLoop(ctx context.Context, conn *websocket.Conn, c *client) {
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-c.send:
			if err := wsjson.Write(ctx, conn, m); err != nil {
				c.kick()
				return
			}
		}
	}
}
