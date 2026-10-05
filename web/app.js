// Client: renders boards and sends intents. The server decides every outcome;
// the opponent's ships are never sent here, only the result of each shot.
const SIZE = 10;
const FLEET = [5, 4, 3, 3, 2];
const $ = id => document.getElementById(id);

let ws;
let ships = [];
let vertical = false;
let phase = 'lobby'; // lobby | waiting | placing | battle | over
let myTurn = false;
let status = { key: '', params: {} };
let notice = '';

function setStatus(key, params = {}) {
  status = { key, params };
  $('status').textContent = key ? t(key, params) : '';
}

function setNotice(key) {
  notice = key;
  $('notice').textContent = key ? t(key) : '';
}

function show(section) {
  for (const id of ['lobby', 'waiting', 'game', 'over']) $(id).hidden = id !== section;
}

// makeBoard builds a SIZE×SIZE grid of buttons and returns a cell lookup.
function makeBoard(el, onClick, onHover) {
  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.setAttribute('aria-label', String.fromCharCode(65 + y) + (x + 1));
      b.addEventListener('click', () => onClick(x, y));
      if (onHover) b.addEventListener('pointerenter', () => onHover(x, y));
      el.append(b);
      cells.push(b);
    }
  }
  return (x, y) => cells[y * SIZE + x];
}

const own = makeBoard($('own-board'), placeShip, preview);
const enemy = makeBoard($('enemy-board'), fire);

function cellsOf(s) {
  return Array.from({ length: s.len }, (_, i) => (s.vertical ? [s.x, s.y + i] : [s.x + i, s.y]));
}

const inBounds = ([x, y]) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
const taken = ([x, y]) => ships.some(s => cellsOf(s).some(([a, b]) => a === x && b === y));

function nextShip(x, y) {
  return ships.length < FLEET.length ? { x, y, len: FLEET[ships.length], vertical } : null;
}

function preview(x, y) {
  document.querySelectorAll('#own-board .preview, #own-board .bad').forEach(c => c.classList.remove('preview', 'bad'));
  const s = phase === 'placing' && nextShip(x, y);
  if (!s) return;
  const cells = cellsOf(s);
  const ok = cells.every(c => inBounds(c) && !taken(c));
  cells.filter(inBounds).forEach(([cx, cy]) => own(cx, cy).classList.add(ok ? 'preview' : 'bad'));
}

function placeShip(x, y) {
  const s = phase === 'placing' && nextShip(x, y);
  if (!s || !cellsOf(s).every(c => inBounds(c) && !taken(c))) return;
  ships.push(s);
  cellsOf(s).forEach(([cx, cy]) => own(cx, cy).classList.add('ship'));
  updatePlacing();
  preview(x, y);
}

function updatePlacing() {
  const left = FLEET.length - ships.length;
  $('ready').disabled = left > 0;
  setStatus(left ? 'placeShips' : 'allPlaced', { n: left });
}

function fire(x, y) {
  if (phase !== 'battle' || !myTurn || enemy(x, y).classList.contains('shot')) return;
  myTurn = false; // wait for the server before allowing another shot
  send({ type: 'fire', x, y });
}

function send(m) {
  ws.send(JSON.stringify(m));
}

function connect(first) {
  setStatus('connecting');
  setNotice('');
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => send(first);
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (phase === 'over') return;
    if (phase === 'lobby') { setStatus(''); return; }
    end('disconnected');
  };
}

function end(key) {
  phase = 'over';
  myTurn = false;
  setStatus(key);
  $('place-controls').hidden = true;
  $('over').hidden = false;
  ws.close();
}

function handle(m) {
  switch (m.type) {
    case 'created': {
      phase = 'waiting';
      const url = new URL(location.href);
      url.search = `?code=${m.code}`;
      history.replaceState(null, '', url);
      $('room-code').textContent = m.code;
      show('waiting');
      setStatus('shareCode');
      break;
    }
    case 'placing':
      phase = 'placing';
      setNotice('');
      show('game');
      updatePlacing();
      break;
    case 'placed':
      $('place-controls').hidden = true;
      setStatus('waitingOpponent');
      break;
    case 'opponent_ready':
      if (phase === 'placing' && !$('place-controls').hidden) setNotice('opponentReady');
      break;
    case 'turn':
      phase = 'battle';
      myTurn = m.yours;
      $('enemy').hidden = false;
      $('enemy-board').classList.toggle('active', myTurn);
      setNotice('');
      setStatus(myTurn ? 'yourTurn' : 'theirTurn');
      break;
    case 'shot': {
      const board = m.byYou ? enemy : own;
      board(m.x, m.y).classList.add('shot', m.hit ? 'hit' : 'miss');
      if (m.sunk) cellsOf(m.sunk).forEach(([x, y]) => board(x, y).classList.add('sunk'));
      break;
    }
    case 'game_over':
      end(m.win ? 'win' : 'lose');
      break;
    case 'opponent_left':
      end('opponentLeft');
      break;
    case 'error':
      setNotice(`err.${m.code}`);
      if (m.code === 'room_not_found' || m.code === 'room_full') {
        phase = 'lobby';
        ws.close();
        history.replaceState(null, '', location.pathname);
      }
      if (m.code === 'not_your_turn' || m.code === 'already_fired') myTurn = phase === 'battle';
      break;
  }
}

$('create').addEventListener('click', () => connect({ type: 'create' }));
$('join-form').addEventListener('submit', e => {
  e.preventDefault();
  connect({ type: 'join', code: $('code').value });
});
$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    setNotice('copied');
  } catch {}
});
$('rotate').addEventListener('click', () => { vertical = !vertical; });
document.addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') vertical = !vertical;
});
$('reset').addEventListener('click', () => {
  ships = [];
  document.querySelectorAll('#own-board .ship').forEach(c => c.classList.remove('ship'));
  updatePlacing();
});
$('ready').addEventListener('click', () => send({ type: 'place', ships }));
$('again').addEventListener('click', () => { location.href = location.pathname; });
$('lang').addEventListener('change', e => {
  setLang(e.target.value);
  setStatus(status.key, status.params);
  setNotice(notice);
});

$('lang').value = lang;
applyI18n();
const invite = new URLSearchParams(location.search).get('code');
if (invite) {
  $('code').value = invite;
  connect({ type: 'join', code: invite });
}
