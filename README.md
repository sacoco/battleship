# Battleship

A small, two-player online Battleship game. Built as a learning project for
multiplayer game development: one player creates a game, shares a 4-letter
code (or invite link), the other joins, and they play 1 vs 1 in the browser.

- **Server:** Go, one binary, game state in memory.
- **Client:** plain HTML/CSS/JavaScript, embedded in the binary.
- **Transport:** WebSockets with JSON messages.
- **UI languages:** English and Spanish.

## Run

```sh
go run .
```

Open <http://localhost:8080>, create a game, and open the invite link in a
second window. Set `PORT` to listen elsewhere.

No Go installed? Use Docker:

```sh
docker run --rm -p 8080:8080 -v "$PWD":/src -w /src golang:1 go run .
```

## Test

```sh
go test ./...
```

## How it works

The server is authoritative. It holds both boards; a client only ever sends
intents ("place these ships", "fire at x,y") and receives outcomes. The
opponent's ship positions never reach the browser, so they cannot be read
from DevTools.

| File | Responsibility |
| --- | --- |
| `game.go` | Pure game rules: fleet validation, firing, win check. No networking. |
| `room.go` | Lobby (create/join by code) and match flow: turns, messages, disconnects. |
| `main.go` | HTTP server, static files, one WebSocket connection per player. |
| `web/` | Browser client. `i18n.js` holds all UI strings. |

Each match is a `room` guarded by a mutex, so simultaneous messages (two
shots arriving together) are applied one after the other. Every connection
has a buffered outgoing queue; a client too slow to drain it is disconnected
rather than silently missing game state.

### Protocol

Client → server:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `create` | | Create a game. |
| `join` | `code` | Join a game by code. |
| `place` | `ships: [{x, y, len, vertical}]` | Submit the fleet. |
| `fire` | `x`, `y` | Shoot at the opponent's board. |

Server → client:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `created` | `code` | Game created; share the code. |
| `placing` | | Both players are in; place your ships. |
| `placed` | | Your fleet was accepted. |
| `opponent_ready` | | The opponent placed their fleet. |
| `turn` | `yours` | Whose turn it is. |
| `shot` | `byYou`, `x`, `y`, `hit`, `sunk` | Result of a shot. `sunk` is the ship, or `null`. |
| `game_over` | `win` | The match ended. |
| `opponent_left` | | The opponent disconnected; the match is over. |
| `error` | `code` | A rejected action, e.g. `not_your_turn`, `invalid_fleet`. |

### Rules

10×10 board, fleet of 5, 4, 3, 3 and 2. Ships may touch but not overlap.
A random player starts and turns alternate after every shot.

## Adding a language

Add a block to `I18N` in `web/i18n.js` (copy `en` and translate every key)
and an `<option>` to the language selector in `web/index.html`.

## Not built yet

Deliberately left out to keep the core small:

- Reconnecting after a dropped connection (today it ends the match).
- Accounts, rankings, chat, matchmaking.
- Persistence: a server restart ends all games.
