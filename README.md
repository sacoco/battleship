# Battleship

A small, two-player online Battleship game. Built as a learning project for
multiplayer game development. Players pick a call sign, see a live list of
operations in the lobby, create one or join an open one (from the list, by
4-letter code, or with an invite link), and play 1 vs 1 in the browser.

- **Server:** Go, one binary, game state in memory.
- **Client:** plain HTML/CSS/JavaScript, embedded in the binary.
- **Transport:** WebSockets with JSON messages.
- **UI languages:** English and Spanish.
- **Look:** military command console, pixel-art ships drawn on a canvas at
  runtime, missile, explosion and splash effects (disabled when the system
  asks for reduced motion).

## Run

```sh
go run .
```

Open <http://localhost:8080>, enter a call sign and create an operation. Open
a second window (a private one, so it gets its own call sign) and join from
the lobby list. Set `PORT` to listen elsewhere.

No Go installed? Use Docker:

```sh
docker run --rm -it --init -p 8080:8080 -v "$PWD":/src -w /src golang:1 go run .
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
| `game.go` | Pure game rules: fleet, ship types, firing, win check. No networking. |
| `server.go` | Lobby and match flow: call signs, rooms, turns, messages, disconnects. |
| `main.go` | HTTP server, static files, one WebSocket connection per player. |
| `web/app.js` | Browser client: screens, boards, deployment, effects, side panels. |
| `web/sprites.js` | Pixel-art ship sprites. |
| `web/i18n.js` | Every UI string, in English and Spanish. |

All server state sits behind one mutex, so simultaneous messages (two shots
arriving together, a join racing a disconnect) are applied one after the
other. Every connection has a buffered outgoing queue; a client too slow to
drain it is disconnected rather than silently missing game state.

### Protocol

Client → server:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `hello` | `name` | Set the call sign (1–16 characters). Required first. |
| `create` | | Create an operation. |
| `join` | `code` | Join an open operation. |
| `leave` | | Leave the current operation (ends it) and return to the lobby. |
| `place` | `ships: [{type, x, y, vertical}]` | Submit the fleet. |
| `fire` | `x`, `y` | Shoot at the opponent's board. |

Server → client:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `welcome` | `name` | Call sign accepted. |
| `games` | `games: [{code, host, guest, state}]` | Lobby list; pushed to everyone in the lobby on every change. |
| `room` | `code` | Operation created; waiting for an opponent. |
| `placing` | `code`, `opponent`, `fleet` | Both players are in; deploy the fleet. |
| `placed` | | Your fleet was accepted. |
| `opponent_ready` | | The opponent deployed their fleet. |
| `turn` | `yours` | Whose turn it is. |
| `shot` | `byYou`, `x`, `y`, `hit`, `sunk` | Result of a shot. `sunk` is the ship, or `null`. |
| `game_over` | `win` | The match ended. |
| `opponent_left` | | The opponent left; the match is over. |
| `error` | `code` | A rejected action, e.g. `not_your_turn`, `invalid_fleet`. |

Match states shown in the lobby: `waiting` (open to join), `placing`,
`battle`. Finished matches are not listed.

### Rules

10×10 board. Each player deploys one of each ship:

| Type | Length |
| --- | --- |
| Aircraft carrier | 5 |
| Battleship | 4 |
| Frigate | 3 |
| Submarine | 3 |
| Patrol boat | 2 |

Ships may touch but not overlap. The server takes each ship's length from its
type, never from the client. A random player starts and turns alternate after
every shot.

To add a ship type, add it to `Fleet` in `game.go`, a sprite case in
`web/sprites.js`, and a `ship.<type>` string per language in `web/i18n.js`.

## Adding a language

Add a block to `I18N` in `web/i18n.js` (copy `en` and translate every key)
and an `<option>` to the language selector in `web/index.html`.

## Not built yet

Deliberately left out to keep the core small:

- Reconnecting after a dropped connection (today it ends the match).
- Accounts, rankings, chat, matchmaking, spectators.
- Turn timer.
- Persistence: a server restart ends all games.
