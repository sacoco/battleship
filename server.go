package main

import (
	"context"
	"crypto/rand"
	"errors"
	mrand "math/rand/v2"
	"sort"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalidName   = errors.New("invalid_name")
	ErrNeedName      = errors.New("need_name")
	ErrInRoom        = errors.New("in_room")
	ErrRoomNotFound  = errors.New("room_not_found")
	ErrRoomFull      = errors.New("room_full")
	ErrNotActive     = errors.New("game_not_active")
	ErrAlreadyPlaced = errors.New("already_placed")
	ErrNotYourTurn   = errors.New("not_your_turn")
	ErrBadRequest    = errors.New("bad_request")
)

const (
	stateWaiting = "waiting" // host alone, open to join
	statePlacing = "placing" // both in, deploying fleets
	stateBattle  = "battle"
	stateOver    = "over"
)

type msgIn struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Code  string `json:"code"`
	Ships []Ship `json:"ships"`
	X     int    `json:"x"`
	Y     int    `json:"y"`
}

type msgOut map[string]any

func errMsg(err error) msgOut { return msgOut{"type": "error", "code": err.Error()} }

// client is one connection. name is empty until it says hello; room is nil
// while it is in the lobby.
type client struct {
	send chan msgOut
	kick context.CancelFunc
	name string
	room *room
	idx  int
}

// push queues m without blocking. A client too slow to drain its queue is
// disconnected rather than silently missing game state.
func (c *client) push(m msgOut) {
	select {
	case c.send <- m:
	default:
		c.kick()
	}
}

type room struct {
	code    string
	seq     int // creation order, for a stable lobby list
	state   string
	players [2]*client
	boards  [2]*Board
	turn    int
}

// server owns every client and match.
// ponytail: one lock for all state; split per room if it ever contends.
type server struct {
	mu      sync.Mutex
	rooms   map[string]*room
	clients map[*client]bool
	seq     int
}

func newServer() *server {
	return &server{rooms: map[string]*room{}, clients: map[*client]bool{}}
}

func (s *server) connect(c *client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[c] = true
}

func (s *server) disconnect(c *client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.leave(c)
	delete(s.clients, c)
}

func (s *server) handle(c *client, m msgIn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.dispatch(c, m); err != nil {
		c.push(errMsg(err))
	}
}

func (s *server) dispatch(c *client, m msgIn) error {
	if m.Type == "hello" {
		if c.room != nil {
			return ErrInRoom
		}
		name, err := cleanName(m.Name)
		if err != nil {
			return err
		}
		c.name = name
		c.push(msgOut{"type": "welcome", "name": name})
		c.push(s.gameList())
		return nil
	}
	if c.name == "" {
		return ErrNeedName
	}
	switch m.Type {
	case "create":
		return s.create(c)
	case "join":
		return s.join(c, normalizeCode(m.Code))
	case "leave":
		s.leave(c)
		c.push(s.gameList())
		return nil
	case "place":
		return s.place(c, m.Ships)
	case "fire":
		return s.fire(c, m.X, m.Y)
	}
	return ErrBadRequest
}

func (s *server) create(c *client) error {
	if c.room != nil {
		return ErrInRoom
	}
	code := newCode()
	for s.rooms[code] != nil {
		code = newCode()
	}
	s.seq++
	r := &room{code: code, seq: s.seq, state: stateWaiting, players: [2]*client{c}}
	s.rooms[code] = r
	c.room, c.idx = r, 0
	c.push(msgOut{"type": "room", "code": code})
	s.broadcastGames()
	return nil
}

func (s *server) join(c *client, code string) error {
	if c.room != nil {
		return ErrInRoom
	}
	r := s.rooms[code]
	if r == nil || r.state == stateOver {
		return ErrRoomNotFound
	}
	if r.state != stateWaiting {
		return ErrRoomFull
	}
	r.players[1] = c
	c.room, c.idx = r, 1
	r.state = statePlacing
	for i, p := range r.players {
		p.push(msgOut{"type": "placing", "code": code, "opponent": r.players[1-i].name, "fleet": Fleet})
	}
	s.broadcastGames()
	return nil
}

func (s *server) place(c *client, ships []Ship) error {
	r := c.room
	if r == nil || r.state != statePlacing {
		return ErrNotActive
	}
	if r.boards[c.idx] != nil {
		return ErrAlreadyPlaced
	}
	b, err := NewBoard(ships)
	if err != nil {
		return err
	}
	r.boards[c.idx] = b
	c.push(msgOut{"type": "placed"})
	r.players[1-c.idx].push(msgOut{"type": "opponent_ready"})
	if r.boards[1-c.idx] != nil {
		r.state = stateBattle
		r.turn = mrand.IntN(2)
		r.pushTurn()
		s.broadcastGames()
	}
	return nil
}

func (s *server) fire(c *client, x, y int) error {
	r := c.room
	if r == nil || r.state != stateBattle {
		return ErrNotActive
	}
	if r.turn != c.idx {
		return ErrNotYourTurn
	}
	opp := r.players[1-c.idx]
	target := r.boards[1-c.idx]
	hit, sunk, err := target.Fire(x, y)
	if err != nil {
		return err
	}
	shot := func(byYou bool) msgOut {
		return msgOut{"type": "shot", "byYou": byYou, "x": x, "y": y, "hit": hit, "sunk": sunk}
	}
	c.push(shot(true))
	opp.push(shot(false))
	if target.AllSunk() {
		r.state = stateOver
		c.push(msgOut{"type": "game_over", "win": true})
		opp.push(msgOut{"type": "game_over", "win": false})
		s.broadcastGames()
		return nil
	}
	r.turn = 1 - c.idx
	r.pushTurn()
	return nil
}

func (r *room) pushTurn() {
	for i, p := range r.players {
		p.push(msgOut{"type": "turn", "yours": i == r.turn})
	}
}

// leave takes c out of its room. A 1 vs 1 match cannot go on with one
// player, so leaving ends it; the room is dropped once empty.
func (s *server) leave(c *client) {
	r := c.room
	if r == nil {
		return
	}
	r.players[c.idx] = nil
	c.room = nil
	if other := r.players[1-c.idx]; other != nil && r.state != stateOver {
		other.push(msgOut{"type": "opponent_left"})
	}
	r.state = stateOver
	if r.players[0] == nil && r.players[1] == nil {
		delete(s.rooms, r.code)
	}
	s.broadcastGames()
}

// gameList is what the lobby shows: every match that has not ended.
func (s *server) gameList() msgOut {
	var rooms []*room
	for _, r := range s.rooms {
		if r.state != stateOver {
			rooms = append(rooms, r)
		}
	}
	sort.Slice(rooms, func(i, j int) bool { return rooms[i].seq < rooms[j].seq })
	games := make([]msgOut, len(rooms))
	for i, r := range rooms {
		g := msgOut{"code": r.code, "host": r.players[0].name, "guest": "", "state": r.state}
		if p := r.players[1]; p != nil {
			g["guest"] = p.name
		}
		games[i] = g
	}
	return msgOut{"type": "games", "games": games}
}

// broadcastGames refreshes the list for everyone sitting in the lobby.
func (s *server) broadcastGames() {
	m := s.gameList()
	for c := range s.clients {
		if c.name != "" && c.room == nil {
			c.push(m)
		}
	}
}

func cleanName(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < 1 || n > 16 || !utf8.ValidString(s) {
		return "", ErrInvalidName
	}
	for _, r := range s {
		if !unicode.IsPrint(r) {
			return "", ErrInvalidName
		}
	}
	return s, nil
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
