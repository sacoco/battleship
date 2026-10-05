// Pixel-art ships, drawn top-down at 8×8 pixels per board cell and scaled up
// with `image-rendering: pixelated`. Each sprite is drawn once and cached.
const SPRITE_PALETTE = {
  h: '#353e45', // hull outline
  d: '#6c7782', // deck
  l: '#a1abb4', // light deck / superstructure
  w: '#d8dee3', // white details
  g: '#171b1f', // guns, dark fittings
  s: '#465a4f', // submarine hull
  t: '#67826f', // submarine tower
  y: '#d9a21b', // deck markings
};

const spriteCache = new Map();

function shipSprite(type, len, vertical) {
  const key = `${type}:${len}:${vertical}`;
  if (!spriteCache.has(key)) spriteCache.set(key, drawSprite(shipPixels(type, len), vertical));
  return spriteCache.get(key);
}

function shipPixels(type, len) {
  const W = len * 8;
  const H = 8;
  const px = Array.from({ length: H }, () => Array(W).fill(null));
  const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y][x] = c; };
  const rect = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c);
  };
  // hull fills rows top..bottom, tapering to a point at the bow (right).
  const hull = (top, bottom, bow, stern, edge, fill) => {
    const mid = (top + bottom) / 2;
    for (let y = top; y <= bottom; y++) {
      const d = Math.abs(y - mid);
      const start = Math.round(d * stern);
      const end = W - 1 - Math.round(d * bow);
      for (let x = start; x <= end; x++) {
        put(x, y, y === top || y === bottom || x === start || x === end ? edge : fill);
      }
    }
  };

  switch (type) {
    case 'carrier':
      hull(1, 6, 1.2, 0.4, 'h', 'd');
      for (let x = 4; x < W - 7; x += 4) rect(x, 3, 2, 2, 'w'); // runway centreline
      rect(Math.floor(W * 0.6), 1, 6, 2, 'g'); // island
      put(Math.floor(W * 0.6) + 2, 1, 'w');
      for (const x of [7, 14]) { // parked aircraft
        put(x + 1, 2, 'y'); rect(x, 3, 3, 1, 'y'); put(x + 1, 4, 'y'); put(x + 1, 5, 'y');
      }
      rect(1, 5, 3, 1, 'y');
      break;
    case 'battleship':
      hull(1, 6, 2, 0.4, 'h', 'd');
      rect(W - 11, 3, 3, 2, 'g'); rect(W - 8, 3, 3, 1, 'g'); rect(W - 8, 4, 3, 1, 'h'); // fore turret
      rect(5, 3, 3, 2, 'g'); rect(2, 3, 3, 1, 'g'); rect(2, 4, 3, 1, 'h'); // aft turret
      rect(11, 2, 8, 4, 'l'); rect(16, 3, 2, 2, 'w'); rect(12, 3, 2, 2, 'g'); // bridge, funnel
      break;
    case 'frigate':
      hull(1, 6, 2, 0.4, 'h', 'd');
      rect(W - 8, 3, 2, 2, 'g'); rect(W - 6, 3, 2, 1, 'g'); // gun
      rect(8, 2, 7, 4, 'l'); put(12, 3, 'w'); put(12, 4, 'w'); // superstructure, mast
      rect(2, 2, 5, 4, 'g'); put(4, 3, 'y'); put(4, 4, 'y'); // helipad
      break;
    case 'submarine':
      hull(2, 5, 3, 2, 'h', 's');
      rect(9, 3, 4, 2, 't'); put(11, 3, 'w'); // conning tower, periscope
      put(10, 1, 'g'); put(10, 6, 'g'); // dive planes
      break;
    case 'patrol':
      hull(2, 5, 2.5, 0.6, 'h', 'd');
      rect(4, 3, 4, 2, 'l'); put(7, 3, 'w'); put(7, 4, 'w'); // cabin
      put(11, 3, 'g'); put(12, 3, 'g'); // gun
      put(1, 3, 'y'); put(1, 4, 'y'); // ensign
      break;
    default:
      hull(1, 6, 2, 0.4, 'h', 'd');
  }
  return px;
}

// drawSprite renders the pixel grid; vertical ships point their bow down.
function drawSprite(px, vertical) {
  const H = px.length;
  const W = px[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = vertical ? H : W;
  canvas.height = vertical ? W : H;
  const g = canvas.getContext('2d');
  px.forEach((row, y) => row.forEach((c, x) => {
    if (!c) return;
    g.fillStyle = SPRITE_PALETTE[c];
    if (vertical) g.fillRect(H - 1 - y, x, 1, 1);
    else g.fillRect(x, y, 1, 1);
  }));
  return canvas.toDataURL();
}
