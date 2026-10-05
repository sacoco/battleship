package main

import "errors"

// Size is the width and height of a board.
const Size = 10

// ShipType is a class of ship and how many cells it covers.
type ShipType struct {
	Type string `json:"type"`
	Len  int    `json:"len"`
}

// Fleet lists the ships each player must place, one of each.
var Fleet = []ShipType{
	{"carrier", 5},
	{"battleship", 4},
	{"frigate", 3},
	{"submarine", 3},
	{"patrol", 2},
}

// Error messages double as codes the client translates.
var (
	ErrInvalidFleet = errors.New("invalid_fleet")
	ErrOutOfBounds  = errors.New("out_of_bounds")
	ErrAlreadyFired = errors.New("already_fired")
)

type Ship struct {
	Type     string `json:"type"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Len      int    `json:"len"`
	Vertical bool   `json:"vertical"`
}

func (s Ship) cells() [][2]int {
	c := make([][2]int, s.Len)
	for i := range c {
		if s.Vertical {
			c[i] = [2]int{s.X, s.Y + i}
		} else {
			c[i] = [2]int{s.X + i, s.Y}
		}
	}
	return c
}

// Board is one player's fleet and the shots fired at it.
type Board struct {
	ships []Ship
	owner [Size][Size]int // index+1 of the ship on each cell, 0 for water
	shots [Size][Size]bool
}

// NewBoard validates a placement: each Fleet type exactly once, in bounds, no
// overlaps. Lengths come from the ship type, not from the client.
func NewBoard(ships []Ship) (*Board, error) {
	if len(ships) != len(Fleet) {
		return nil, ErrInvalidFleet
	}
	lens := map[string]int{}
	for _, t := range Fleet {
		lens[t.Type] = t.Len
	}
	b := &Board{ships: make([]Ship, len(ships))}
	for i, s := range ships {
		l, ok := lens[s.Type]
		if !ok {
			return nil, ErrInvalidFleet
		}
		delete(lens, s.Type)
		s.Len = l
		b.ships[i] = s
		for _, c := range s.cells() {
			if !inBounds(c[0], c[1]) || b.owner[c[0]][c[1]] != 0 {
				return nil, ErrInvalidFleet
			}
			b.owner[c[0]][c[1]] = i + 1
		}
	}
	return b, nil
}

// Fire shoots at (x, y). sunk is set when the hit finished off a ship.
func (b *Board) Fire(x, y int) (hit bool, sunk *Ship, err error) {
	if !inBounds(x, y) {
		return false, nil, ErrOutOfBounds
	}
	if b.shots[x][y] {
		return false, nil, ErrAlreadyFired
	}
	b.shots[x][y] = true
	i := b.owner[x][y]
	if i == 0 {
		return false, nil, nil
	}
	s := b.ships[i-1]
	for _, c := range s.cells() {
		if !b.shots[c[0]][c[1]] {
			return true, nil, nil
		}
	}
	return true, &s, nil
}

func (b *Board) AllSunk() bool {
	for x := range Size {
		for y := range Size {
			if b.owner[x][y] != 0 && !b.shots[x][y] {
				return false
			}
		}
	}
	return true
}

func inBounds(x, y int) bool { return x >= 0 && x < Size && y >= 0 && y < Size }
