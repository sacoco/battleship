package main

import "testing"

func testClient() *client {
	return &client{send: make(chan msgOut, 64), kick: func() {}}
}

// drain returns the types of every queued message, plus the last of each.
func drain(c *client) (types []string, last map[string]msgOut) {
	last = map[string]msgOut{}
	for {
		select {
		case m := <-c.send:
			t := m["type"].(string)
			types = append(types, t)
			last[t] = m
		default:
			return types, last
		}
	}
}

func TestMatchFlow(t *testing.T) {
	s := newServer()
	a, b, watcher := testClient(), testClient(), testClient()
	for _, c := range []*client{a, b, watcher} {
		s.connect(c)
	}

	s.handle(a, msgIn{Type: "create"})
	if _, last := drain(a); last["error"]["code"] != "need_name" {
		t.Fatalf("create without a name: %v", last)
	}
	s.handle(a, msgIn{Type: "hello", Name: "  Ana  "})
	s.handle(b, msgIn{Type: "hello", Name: "Beto"})
	s.handle(watcher, msgIn{Type: "hello", Name: "Caro"})
	s.handle(a, msgIn{Type: "create"})
	_, last := drain(a)
	code := last["room"]["code"].(string)

	_, last = drain(watcher)
	games := last["games"]["games"].([]msgOut)
	if len(games) != 1 || games[0]["host"] != "Ana" || games[0]["state"] != stateWaiting {
		t.Fatalf("lobby list = %v", games)
	}

	s.handle(b, msgIn{Type: "join", Code: code})
	s.handle(watcher, msgIn{Type: "join", Code: code})
	if _, last := drain(watcher); last["error"]["code"] != "room_full" {
		t.Errorf("third player joined: %v", last)
	}
	if _, last := drain(b); last["placing"]["opponent"] != "Ana" {
		t.Errorf("guest placing = %v", last["placing"])
	}

	s.handle(a, msgIn{Type: "place", Ships: fleet()})
	s.handle(b, msgIn{Type: "place", Ships: fleet()})
	drain(a)
	drain(b)

	shooter, waiter := a, b
	if s.rooms[code].turn == 1 {
		shooter, waiter = b, a
	}
	s.handle(waiter, msgIn{Type: "fire", X: 0, Y: 0})
	if _, last := drain(waiter); last["error"]["code"] != "not_your_turn" {
		t.Errorf("out of turn shot: %v", last)
	}
	s.handle(shooter, msgIn{Type: "fire", X: 0, Y: 0})
	if _, last := drain(waiter); last["shot"]["hit"] != true || last["turn"]["yours"] != true {
		t.Errorf("after hit: %v", last)
	}

	s.disconnect(shooter)
	if _, last := drain(waiter); last["opponent_left"] == nil {
		t.Error("opponent_left not sent")
	}
	s.handle(waiter, msgIn{Type: "leave"})
	if len(s.rooms) != 0 {
		t.Errorf("empty room kept: %v", s.rooms)
	}
}
