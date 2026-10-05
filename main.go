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
	l := &lobby{rooms: map[string]*room{}}
	static, _ := fs.Sub(webFS, "web")
	http.Handle("/", http.FileServerFS(static))
	http.HandleFunc("/ws", l.serveWS)
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func (l *lobby) serveWS(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil) // nil options = same-origin only
	if err != nil {
		return
	}
	defer c.CloseNow()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	p := &player{send: make(chan msgOut, 16), kick: cancel}
	go writeLoop(ctx, c, p)

	var (
		rm   *room
		idx  int
		code string
	)
	for {
		var m msgIn
		if err := wsjson.Read(ctx, c, &m); err != nil {
			break
		}
		if rm != nil {
			rm.handle(idx, m)
			continue
		}
		switch m.Type {
		case "create":
			code, rm = l.create(p)
			idx = 0
			p.push(msgOut{"type": "created", "code": code})
		case "join":
			code = normalizeCode(m.Code)
			if rm, err = l.join(code, p); err != nil {
				p.push(errMsg(err))
			}
			idx = 1
		default:
			p.push(errMsg(ErrNoRoom))
		}
	}
	if rm != nil {
		rm.leave(idx)
		l.remove(code)
	}
}

func writeLoop(ctx context.Context, c *websocket.Conn, p *player) {
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-p.send:
			if err := wsjson.Write(ctx, c, m); err != nil {
				p.kick()
				return
			}
		}
	}
}
