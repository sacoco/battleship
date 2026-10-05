// Client: renders what the server reports and sends intents. The server owns
// the game state; the enemy fleet's positions never reach this page.
const SIZE = 10;
const LETTERS = 'ABCDEFGHIJ';
const $ = id => document.getElementById(id);
const coord = (x, y) => LETTERS[y] + (x + 1);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function stored(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
  return null;
}

let ws = null;
let myName = stored('name') || '';
let games = [];
let room = null;
let invite = new URLSearchParams(location.search).get('code');
if (invite) history.replaceState(null, '', location.pathname);

function newRoom(code) {
  return {
    code,
    phase: 'waiting', // waiting | placing | ready | battle | over
    opponent: '',
    fleet: [],
    ships: [], // own placement
    selected: null,
    vertical: false,
    opponentReady: false,
    myTurn: false,
    pending: null, // "x,y" fired at, awaiting the result
    incoming: new Map(), // "x,y" -> hit, shots at our fleet
    outgoing: new Map(), // "x,y" -> hit, our shots
    enemySunk: [],
    ownSunk: new Set(),
    stats: { me: { shots: 0, hits: 0 }, them: { shots: 0, hits: 0 } },
    log: [],
    result: null, // win | lose | left
    animating: 0,
  };
}

// ---------- connection ----------

function connect() {
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => send({ type: 'hello', name: myName });
  sock.onmessage = e => handle(JSON.parse(e.data));
  sock.onclose = () => { if (ws === sock) $('conn-lost').hidden = false; };
}

function send(m) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function handle(m) {
  switch (m.type) {
    case 'welcome':
      myName = m.name;
      stored('name', m.name);
      $('my-name').textContent = m.name;
      if (!room) show('screen-lobby');
      if (invite) {
        send({ type: 'join', code: invite });
        invite = null;
      }
      break;
    case 'games':
      games = m.games;
      renderGames();
      break;
    case 'room':
      room = newRoom(m.code);
      show('screen-room');
      renderRoom();
      break;
    case 'placing':
      room ??= newRoom(m.code);
      Object.assign(room, { phase: 'placing', opponent: m.opponent, fleet: m.fleet, selected: m.fleet[0].type });
      addLog('log.joined', { name: m.opponent });
      show('screen-room');
      renderRoom();
      break;
    case 'placed':
      room.phase = 'ready';
      renderRoom();
      break;
    case 'opponent_ready':
      room.opponentReady = true;
      renderRoom();
      break;
    case 'turn':
      if (room.phase !== 'battle') {
        room.phase = 'battle';
        addLog(m.yours ? 'log.youFirst' : 'log.theyFirst', { name: room.opponent });
      }
      room.myTurn = m.yours;
      renderRoom();
      break;
    case 'shot':
      onShot(m);
      break;
    case 'game_over':
      endMatch(m.win ? 'win' : 'lose');
      break;
    case 'opponent_left':
      endMatch('left');
      break;
    case 'error':
      toast(`err.${m.code}`);
      if (m.code === 'invalid_name') showNameForm();
      if (room) {
        room.pending = null;
        renderBoards();
      }
      break;
  }
}

function endMatch(result) {
  if (room.result) return;
  Object.assign(room, { result, phase: 'over', myTurn: false, pending: null });
  renderRoom();
}

function leaveRoom() {
  send({ type: 'leave' });
  room = null;
  $('debrief').hidden = true;
  show('screen-lobby');
}

// ---------- screens ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  $('commander').hidden = id === 'screen-name' || !myName;
}

function showNameForm() {
  $('name-input').value = myName;
  show('screen-name');
  $('name-input').focus();
}

let toastTimer;
function toast(key) {
  const box = $('toast');
  box.textContent = t(key);
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 3500);
}

function renderGames() {
  $('games-body').replaceChildren(...games.map(g => {
    const tr = el('tr');
    tr.append(
      el('td', 'code-cell', g.code),
      el('td', '', g.host),
      el('td', g.guest ? '' : 'muted', g.guest || '—'),
      el('td', `state ${g.state}`, t(`state.${g.state}`)),
    );
    const action = el('td', 'action');
    if (g.state === 'waiting') {
      const b = el('button', 'small', t('join'));
      b.addEventListener('click', () => send({ type: 'join', code: g.code }));
      action.append(b);
    }
    tr.append(action);
    return tr;
  }));
  $('no-games').hidden = games.length > 0;
}

// ---------- boards ----------

function makeBoard(wrap, onClick, onHover) {
  wrap.className = 'board-wrap';
  wrap.append(el('div', 'axis'));
  for (let x = 0; x < SIZE; x++) wrap.append(el('div', 'axis', x + 1));
  for (let y = 0; y < SIZE; y++) {
    const a = el('div', 'axis', LETTERS[y]);
    a.style.gridArea = `${y + 2} / 1`;
    wrap.append(a);
  }
  const board = el('div', 'board');
  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = el('button', 'cell');
      c.type = 'button';
      c.setAttribute('aria-label', coord(x, y));
      c.addEventListener('click', () => onClick(x, y));
      c.addEventListener('pointerenter', () => onHover(x, y));
      board.append(c);
      cells.push(c);
    }
  }
  const ships = el('div', 'layer ships');
  const fx = el('div', 'layer fx');
  board.append(ships, fx);
  board.addEventListener('pointerleave', () => onHover(-1, -1));
  wrap.append(board);
  return { board, cells, ships, fx };
}

const own = makeBoard($('own-board'), ownClick, ownHover);
const enemy = makeBoard($('enemy-board'), enemyClick, enemyHover);

function cellsOf(s) {
  return Array.from({ length: s.len }, (_, i) => (s.vertical ? [s.x, s.y + i] : [s.x + i, s.y]));
}

function fits(s, ships) {
  return cellsOf(s).every(([x, y]) =>
    x >= 0 && x < SIZE && y >= 0 && y < SIZE &&
    !ships.some(o => cellsOf(o).some(([a, b]) => a === x && b === y)));
}

function place(e, x, y, w = 1, h = 1) {
  Object.assign(e.style, { left: `${x * 10}%`, top: `${y * 10}%`, width: `${w * 10}%`, height: `${h * 10}%` });
}

function shipEl(s, cls = '') {
  const d = el('div', `ship ${cls}`);
  place(d, s.x, s.y, s.vertical ? 1 : s.len, s.vertical ? s.len : 1);
  d.style.backgroundImage = `url(${shipSprite(s.type, s.len, s.vertical)})`;
  return d;
}

function paint(b, shots, pending) {
  b.cells.forEach((c, i) => {
    const key = `${i % SIZE},${Math.floor(i / SIZE)}`;
    const hit = shots.get(key);
    c.classList.toggle('shot', hit !== undefined);
    c.classList.toggle('hit', hit === true);
    c.classList.toggle('miss', hit === false);
    c.classList.toggle('locked', key === pending);
  });
}

function renderBoards() {
  const r = room;
  paint(own, r.incoming);
  paint(enemy, r.outgoing, r.pending);
  own.ships.replaceChildren(...r.ships.map(s => shipEl(s, r.ownSunk.has(s.type) ? 'sunk' : '')));
  enemy.ships.replaceChildren(...r.enemySunk.map(s => shipEl(s, 'sunk')));
  enemy.board.classList.toggle('armed', r.phase === 'battle' && r.myTurn && !r.pending);
  own.board.classList.toggle('placing', r.phase === 'placing');
  ownHover(...hover);
}

// ---------- deployment ----------

let hover = [-1, -1];

function candidate(x, y) {
  const r = room;
  const len = r.fleet.find(f => f.type === r.selected).len;
  return { type: r.selected, len, x, y, vertical: r.vertical };
}

function ownHover(x, y) {
  hover = [x, y];
  own.ships.querySelector('.ghost')?.remove();
  const r = room;
  if (r?.phase !== 'placing' || x < 0 || !r.selected) return;
  const s = candidate(x, y);
  own.ships.append(shipEl(s, fits(s, r.ships) ? 'ghost' : 'ghost bad'));
}

function ownClick(x, y) {
  const r = room;
  if (r?.phase !== 'placing') return;
  const i = r.ships.findIndex(s => cellsOf(s).some(([a, b]) => a === x && b === y));
  if (i >= 0) {
    pickUp(i);
  } else {
    if (!r.selected) return;
    const s = candidate(x, y);
    if (!fits(s, r.ships)) return;
    r.ships.push(s);
    r.selected = r.fleet.find(f => !r.ships.some(s => s.type === f.type))?.type ?? null;
  }
  renderRoom();
}

function pickUp(i) {
  const [s] = room.ships.splice(i, 1);
  room.selected = s.type;
  room.vertical = s.vertical;
}

function rotate() {
  if (room?.phase !== 'placing') return;
  room.vertical = !room.vertical;
  ownHover(...hover);
}

function randomFleet() {
  const r = room;
  r.ships = [];
  for (const { type, len } of r.fleet) {
    let s;
    do {
      s = { type, len, vertical: Math.random() < 0.5, x: Math.floor(Math.random() * SIZE), y: Math.floor(Math.random() * SIZE) };
    } while (!fits(s, r.ships));
    r.ships.push(s);
  }
  r.selected = null;
  renderRoom();
}

function renderDeploy() {
  const r = room;
  const placing = r.phase === 'placing';
  $('picker').replaceChildren(...r.fleet.map(f => {
    const placed = r.ships.some(s => s.type === f.type);
    const li = el('li');
    const b = el('button', `pick${placed ? ' placed' : ''}${r.selected === f.type ? ' selected' : ''}`);
    b.type = 'button';
    b.disabled = !placing;
    b.append(fleetIcon(f), el('span', 'name', t(`ship.${f.type}`)), el('span', 'len', `${f.len}`));
    b.addEventListener('click', () => {
      const i = r.ships.findIndex(s => s.type === f.type);
      if (i >= 0) pickUp(i);
      else r.selected = f.type;
      renderRoom();
    });
    li.append(b);
    return li;
  }));
  for (const id of ['rotate', 'random', 'clear']) $(id).disabled = !placing;
  $('ready').disabled = !placing || r.ships.length < r.fleet.length;
  $('enemy-ready').hidden = !r.opponentReady;
}

// ---------- battle ----------

function enemyHover(x, y) {
  enemy.board.classList.toggle('aiming', x >= 0);
  enemy.board.style.setProperty('--hx', x);
  enemy.board.style.setProperty('--hy', y);
  const armed = enemy.board.classList.contains('armed');
  $('target').textContent = armed && x >= 0 ? `${t('target')}: ${coord(x, y)}` : '';
}

function enemyClick(x, y) {
  const r = room;
  const key = `${x},${y}`;
  if (r?.phase !== 'battle' || !r.myTurn || r.pending || r.outgoing.has(key)) return;
  r.pending = key;
  send({ type: 'fire', x, y });
  renderBoards();
}

function onShot(m) {
  const r = room;
  const mine = m.byYou;
  if (mine) r.pending = null;
  r.animating++;
  renderBoards();
  strike(mine ? enemy : own, m.x, m.y, m.hit, () => {
    if (room !== r) return;
    (mine ? r.outgoing : r.incoming).set(`${m.x},${m.y}`, m.hit);
    const st = mine ? r.stats.me : r.stats.them;
    st.shots++;
    if (m.hit) st.hits++;
    const who = mine ? 'me' : 'them';
    addLog(`log.${mine ? 'you' : 'they'}${m.hit ? 'Hit' : 'Miss'}`, { c: coord(m.x, m.y) }, who);
    if (m.sunk) {
      if (mine) r.enemySunk.push(m.sunk);
      else r.ownSunk.add(m.sunk.type);
      addLog(mine ? 'log.youSank' : 'log.theySank', { ship: m.sunk.type }, `${who} big`);
    }
    r.animating--;
    renderRoom();
  });
}

// strike plays the missile and its impact, then calls done to reveal the result.
function strike(b, x, y, hit, done) {
  const missile = el('div', 'missile');
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    missile.remove();
    done();
  };
  if (reducedMotion) return finish();
  setTimeout(finish, 1500); // animationend never fires while the tab is hidden
  place(missile, x, y);
  b.fx.append(missile);
  missile.addEventListener('animationend', () => {
    const impact = el('div', hit ? 'blast' : 'splash');
    place(impact, x, y);
    b.fx.append(impact);
    setTimeout(() => impact.remove(), 700);
    if (hit) {
      b.board.classList.remove('shake');
      void b.board.offsetWidth; // restart the animation
      b.board.classList.add('shake');
    }
    finish();
  }, { once: true });
}

function addLog(key, params = {}, who = '') {
  room.log.unshift({ key, params, who });
  room.log.length = Math.min(room.log.length, 60);
}

// ---------- side panels ----------

function fleetIcon(f) {
  const img = el('img');
  img.src = shipSprite(f.type, f.len, false);
  img.alt = '';
  img.style.width = `${f.len * 16}px`;
  return img;
}

function fleetItem(f, damage, sunk) {
  const li = el('li', sunk ? 'sunk' : '');
  const pips = el('span', 'pips');
  for (let i = 0; i < f.len; i++) pips.append(el('i', i < damage ? 'dmg' : ''));
  li.append(fleetIcon(f), el('span', 'name', t(`ship.${f.type}`)), pips);
  return li;
}

function renderFleets() {
  const r = room;
  $('own-fleet').replaceChildren(...r.fleet.map(f => {
    const s = r.ships.find(s => s.type === f.type);
    const damage = s ? cellsOf(s).filter(([x, y]) => r.incoming.get(`${x},${y}`)).length : 0;
    return fleetItem(f, damage, r.ownSunk.has(f.type));
  }));
  $('enemy-fleet').replaceChildren(...r.fleet.map(f => {
    const sunk = r.enemySunk.some(s => s.type === f.type);
    return fleetItem(f, sunk ? f.len : 0, sunk);
  }));
}

function renderStats(table) {
  const { me, them } = room.stats;
  const acc = s => (s.shots ? `${Math.round((100 * s.hits) / s.shots)}%` : '—');
  const rows = [
    ['', t('you'), t('enemy')],
    [t('shots'), me.shots, them.shots],
    [t('hits'), me.hits, them.hits],
    [t('accuracy'), acc(me), acc(them)],
  ];
  table.replaceChildren(...rows.map((row, i) => {
    const tr = el('tr');
    row.forEach((v, j) => tr.append(el(i === 0 || j === 0 ? 'th' : 'td', '', v)));
    return tr;
  }));
}

function renderLog() {
  $('log').replaceChildren(...room.log.map(e => {
    const params = e.params.ship ? { ...e.params, ship: t(`ship.${e.params.ship}`) } : e.params;
    return el('li', e.who, t(e.key, params));
  }));
}

function renderHud() {
  const r = room;
  $('hud-me').textContent = myName;
  $('hud-them').textContent = r.opponent || '—';
  const battle = r.phase === 'battle';
  $('light-me').classList.toggle('on', battle && r.myTurn);
  $('light-them').classList.toggle('on', battle && !r.myTurn);
  const left = r.fleet.length - r.ships.length;
  const [key, params] = {
    waiting: ['waitingTitle'],
    placing: left ? ['placeShips', { n: left }] : ['allPlaced'],
    ready: ['waitingOpponent'],
    battle: [r.myTurn ? 'yourTurn' : 'theirTurn'],
    over: [r.result],
  }[r.phase];
  $('status').textContent = t(key, params);
  $('status').className = battle && r.myTurn ? 'go' : r.result === 'lose' ? 'bad' : '';
}

function renderDebrief() {
  const r = room;
  const visible = Boolean(r.result) && r.animating === 0;
  $('debrief').hidden = !visible;
  if (!visible) return;
  $('debrief-title').textContent = t(r.result);
  $('debrief-title').className = r.result === 'lose' ? 'bad' : 'go';
  $('debrief-text').textContent = t(`${r.result}Text`);
  renderStats($('debrief-stats'));
}

function renderRoom() {
  const r = room;
  if (!r) return;
  const deploying = r.phase === 'placing' || r.phase === 'ready';
  $('waiting-panel').hidden = r.phase !== 'waiting';
  $('theater').hidden = r.phase === 'waiting';
  $('deploy-col').hidden = !deploying;
  $('enemy-col').hidden = deploying;
  $('withdraw').hidden = r.phase === 'over';
  $('room-code').textContent = r.code;
  renderHud();
  renderBoards();
  renderDeploy();
  renderFleets();
  renderStats($('stats'));
  renderLog();
  renderDebrief();
}

// ---------- wiring ----------

$('name-form').addEventListener('submit', e => {
  e.preventDefault();
  myName = $('name-input').value.trim();
  if (ws) send({ type: 'hello', name: myName });
  else connect();
});
$('rename').addEventListener('click', showNameForm);
$('create').addEventListener('click', () => send({ type: 'create' }));
$('join-form').addEventListener('submit', e => {
  e.preventDefault();
  send({ type: 'join', code: $('code-input').value });
});
$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}?code=${room.code}`);
    toast('copied');
  } catch {}
});
$('abort').addEventListener('click', leaveRoom);
$('withdraw').addEventListener('click', () => {
  if (room.phase === 'waiting' || confirm(t('confirmWithdraw'))) leaveRoom();
});
$('back').addEventListener('click', leaveRoom);
$('reconnect').addEventListener('click', () => location.reload());
$('rotate').addEventListener('click', rotate);
$('random').addEventListener('click', randomFleet);
$('clear').addEventListener('click', () => {
  room.ships = [];
  room.selected = room.fleet[0].type;
  renderRoom();
});
$('ready').addEventListener('click', () => send({ type: 'place', ships: room.ships }));
own.board.addEventListener('contextmenu', e => {
  if (room?.phase !== 'placing') return;
  e.preventDefault();
  rotate();
});
document.addEventListener('keydown', e => {
  if ((e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLInputElement)) rotate();
});
$('lang').addEventListener('change', e => {
  setLang(e.target.value);
  renderGames();
  renderRoom();
});

$('lang').value = lang;
applyI18n();
if (myName) {
  $('my-name').textContent = myName;
  show('screen-lobby');
  connect();
} else {
  showNameForm();
}
