package main

import (
	"errors"
	"testing"
)

// fleet places every ship horizontally on its own row.
func fleet() []Ship {
	s := make([]Ship, len(Fleet))
	for i, l := range Fleet {
		s[i] = Ship{X: 0, Y: i * 2, Len: l}
	}
	return s
}

func TestNewBoard(t *testing.T) {
	cases := map[string]func([]Ship) []Ship{
		"valid":        func(s []Ship) []Ship { return s },
		"missing ship": func(s []Ship) []Ship { return s[1:] },
		"wrong length": func(s []Ship) []Ship { s[4].Len = 4; return s },
		"zero length":  func(s []Ship) []Ship { s[4].Len = 0; return s },
		"out of board": func(s []Ship) []Ship { s[0].X = 6; return s },
		"negative":     func(s []Ship) []Ship { s[0].X = -1; return s },
		"overlap":      func(s []Ship) []Ship { s[1].Y = 0; return s },
		"vertical off": func(s []Ship) []Ship { s[0] = Ship{X: 9, Y: 6, Len: 5, Vertical: true}; return s },
	}
	for name, mutate := range cases {
		_, err := NewBoard(mutate(fleet()))
		if wantOK := name == "valid"; (err == nil) != wantOK {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestFire(t *testing.T) {
	b, err := NewBoard(fleet())
	if err != nil {
		t.Fatal(err)
	}
	if hit, _, _ := b.Fire(9, 9); hit {
		t.Error("water reported as hit")
	}
	if _, _, err := b.Fire(9, 9); !errors.Is(err, ErrAlreadyFired) {
		t.Errorf("repeat shot: err = %v", err)
	}
	if _, _, err := b.Fire(10, 0); !errors.Is(err, ErrOutOfBounds) {
		t.Errorf("off board: err = %v", err)
	}
	// The length-2 ship sits at (0,8)-(1,8).
	if hit, sunk, _ := b.Fire(0, 8); !hit || sunk != nil {
		t.Errorf("first hit: hit=%v sunk=%v", hit, sunk)
	}
	if hit, sunk, _ := b.Fire(1, 8); !hit || sunk == nil || sunk.Len != 2 {
		t.Errorf("sinking hit: hit=%v sunk=%v", hit, sunk)
	}
	if b.AllSunk() {
		t.Error("AllSunk with ships afloat")
	}
	for _, s := range b.ships {
		for _, c := range s.cells() {
			b.Fire(c[0], c[1])
		}
	}
	if !b.AllSunk() {
		t.Error("AllSunk false after sinking everything")
	}
}
