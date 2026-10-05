package main

import (
	"context"
	"crypto/rand"
	"errors"
	mrand "math/rand/v2"
	"strings"
	"sync"
)

var (
	ErrRoomNotFound  = errors.New("room_not_found")
	ErrRoomFull      = errors.New("room_full")
	ErrNoRoom        = errors.New("no_room")
	ErrNotActive     = errors.New("game_not_active")
	ErrAlreadyPlaced = errors.New("already_placed")
	ErrNotYourTurn   = errors.New("not_your_turn")
	ErrBadRequest    = errors.New("bad_request")
)

type msgIn struct {
	Type  string `json:"type"`
	Code  string `json:"code"`
	Ships []Ship `json:"ships"`
	X     int    `json:"x"`
	Y     int    `json:"y"`
}

type msgOut map[string]any

func errMsg(err error) msgOut { return msgOut{"type": "error", "code": err.Error()} }

type player struct {
	send  chan msgOut
	kick  context.CancelFunc
	board *Board
}

// push queues m without blocking. A client too slow to drain its queue is
// disconnected rather than silently missing game state.
func (p *player) push(m msgOut) {
	select {
	case p.send <- m:
	default:
		p.kick()
	}
}

// room is one match. Every state change happens under mu, so two shots
// arriving together are applied one after the other.
type room struct {
	mu      sync.Mutex
	players [2]*player
	turn    int
	over    bool
}

func (r *room) handle(idx int, m msgIn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	me, opp := r.players[idx], r.players[1-idx]
	if r.over || opp == nil {
		me.push(errMsg(ErrNotActive))
		return
	}
	switch m.Type {
	case "place":
		if me.board != nil {
			me.push(errMsg(ErrAlreadyPlaced))
			return
		}
		b, err := NewBoard(m.Ships)
		if err != nil {
			me.push(errMsg(err))
			return
		}
		me.board = b
		me.push(msgOut{"type": "placed"})
		opp.push(msgOut{"type": "opponent_ready"})
		if opp.board != nil {
			r.turn = mrand.IntN(2)
			r.pushTurn()
		}
	case "fire":
		if me.board == nil || opp.board == nil {
			me.push(errMsg(ErrNotActive))
			return
		}
		if r.turn != idx {
			me.push(errMsg(ErrNotYourTurn))
			return
		}
		hit, sunk, err := opp.board.Fire(m.X, m.Y)
		if err != nil {
			me.push(errMsg(err))
			return
		}
		shot := func(byYou bool) msgOut {
			return msgOut{"type": "shot", "byYou": byYou, "x": m.X, "y": m.Y, "hit": hit, "sunk": sunk}
		}
		me.push(shot(true))
		opp.push(shot(false))
		if opp.board.AllSunk() {
			r.over = true
			me.push(msgOut{"type": "game_over", "win": true})
			opp.push(msgOut{"type": "game_over", "win": false})
			return
		}
		r.turn = 1 - idx
		r.pushTurn()
	default:
		me.push(errMsg(ErrBadRequest))
	}
}

func (r *room) pushTurn() {
	for i, p := range r.players {
		p.push(msgOut{"type": "turn", "yours": i == r.turn})
	}
}

// leave ends the match: a 1 vs 1 game cannot go on with one player.
func (r *room) leave(idx int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.players[idx] = nil
	if other := r.players[1-idx]; other != nil && !r.over {
		other.push(msgOut{"type": "opponent_left"})
	}
	r.over = true
}

type lobby struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func (l *lobby) create(p *player) (string, *room) {
	r := &room{players: [2]*player{p}}
	l.mu.Lock()
	defer l.mu.Unlock()
	code := newCode()
	for l.rooms[code] != nil {
		code = newCode()
	}
	l.rooms[code] = r
	return code, r
}

func (l *lobby) join(code string, p *player) (*room, error) {
	l.mu.Lock()
	r := l.rooms[code]
	l.mu.Unlock()
	if r == nil {
		return nil, ErrRoomNotFound
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.over {
		return nil, ErrRoomNotFound
	}
	if r.players[1] != nil {
		return nil, ErrRoomFull
	}
	r.players[1] = p
	for _, p := range r.players {
		p.push(msgOut{"type": "placing"})
	}
	return r, nil
}

func (l *lobby) remove(code string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.rooms, code)
}

// 32 symbols divide 256 evenly, so byte%32 is unbiased. No 0/O or 1/I.
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func newCode() string {
	b := make([]byte, 4)
	rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b)
}

func normalizeCode(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }
