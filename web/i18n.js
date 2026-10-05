// UI strings. To add a language, add a block here and an <option> in index.html.
// Keys starting with "err." match the error codes the server sends.
const I18N = {
  en: {
    title: 'Battleship',
    create: 'Create game',
    join: 'Join',
    codePlaceholder: 'Game code',
    copyLink: 'Copy invite link',
    copied: 'Link copied.',
    shareCode: 'Share this code with your opponent and wait for them to join.',
    rotate: 'Rotate (R)',
    reset: 'Reset',
    ready: 'Ready',
    yourFleet: 'Your fleet',
    enemyWaters: 'Enemy waters',
    playAgain: 'Play again',
    connecting: 'Connecting…',
    placeShips: 'Place your ships: {n} left. Click a cell; R rotates.',
    allPlaced: 'All ships placed. Press Ready.',
    waitingOpponent: 'Waiting for your opponent to place their ships…',
    opponentReady: 'Your opponent is ready.',
    yourTurn: 'Your turn: fire at the enemy waters.',
    theirTurn: "Opponent's turn…",
    win: 'You won! 🎉',
    lose: 'You lost. All your ships were sunk.',
    opponentLeft: 'Your opponent left the game.',
    disconnected: 'Connection lost.',
    'err.room_not_found': 'That game does not exist or has ended.',
    'err.room_full': 'That game already has two players.',
    'err.invalid_fleet': 'Invalid ship placement.',
    'err.already_fired': 'You already fired at that cell.',
    'err.not_your_turn': 'It is not your turn.',
    'err.unknown': 'Something went wrong.',
  },
  es: {
    title: 'Batalla naval',
    create: 'Crear partida',
    join: 'Unirse',
    codePlaceholder: 'Código de partida',
    copyLink: 'Copiar enlace de invitación',
    copied: 'Enlace copiado.',
    shareCode: 'Comparte este código con tu rival y espera a que se una.',
    rotate: 'Rotar (R)',
    reset: 'Reiniciar',
    ready: 'Listo',
    yourFleet: 'Tu flota',
    enemyWaters: 'Aguas enemigas',
    playAgain: 'Jugar de nuevo',
    connecting: 'Conectando…',
    placeShips: 'Coloca tus barcos: faltan {n}. Haz clic en una casilla; R rota.',
    allPlaced: 'Barcos colocados. Pulsa Listo.',
    waitingOpponent: 'Esperando a que tu rival coloque sus barcos…',
    opponentReady: 'Tu rival está listo.',
    yourTurn: 'Tu turno: dispara a las aguas enemigas.',
    theirTurn: 'Turno del rival…',
    win: '¡Ganaste! 🎉',
    lose: 'Perdiste. Hundieron todos tus barcos.',
    opponentLeft: 'Tu rival abandonó la partida.',
    disconnected: 'Se perdió la conexión.',
    'err.room_not_found': 'Esa partida no existe o ya terminó.',
    'err.room_full': 'Esa partida ya tiene dos jugadores.',
    'err.invalid_fleet': 'Posición de barcos no válida.',
    'err.already_fired': 'Ya disparaste a esa casilla.',
    'err.not_your_turn': 'No es tu turno.',
    'err.unknown': 'Algo salió mal.',
  },
};

let lang = (() => {
  try {
    const saved = localStorage.getItem('lang');
    if (saved in I18N) return saved;
  } catch {}
  return navigator.language.startsWith('es') ? 'es' : 'en';
})();

function t(key, params = {}) {
  const s = I18N[lang][key] ?? I18N.en[key] ?? (key.startsWith('err.') ? I18N[lang]['err.unknown'] : key);
  return s.replace(/\{(\w+)\}/g, (_, k) => params[k]);
}

function applyI18n() {
  document.documentElement.lang = lang;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

function setLang(l) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch {}
  applyI18n();
}
