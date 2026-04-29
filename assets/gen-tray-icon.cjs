// Hand-build a 64x64 RGBA PNG of a Mario-style pipe silhouette and emit base64.
// We bypass qlmanage / SVG renderers because qlmanage produces near-empty PNGs from
// our SVG sources (it doesn't parse <text> or even <rect>/<path> reliably across
// macOS versions). zlib + a tiny PNG encoder is deterministic and self-contained.
//
// Run: `node assets/gen-tray-icon.cjs > /tmp/icon-b64.txt`
// Then paste the base64 into ICON_BASE64 in src/tray.ts.

const zlib = require('node:zlib')

const W = 64
const H = 64

// Pipe silhouette — rim is wider/shorter, body is narrower/taller.
const RIM = { x: 6, y: 10, w: 52, h: 14 }
const BODY = { x: 14, y: 24, w: 36, h: 32 }

const inside = (x, y) =>
  (x >= RIM.x && x < RIM.x + RIM.w && y >= RIM.y && y < RIM.y + RIM.h) ||
  (x >= BODY.x && x < BODY.x + BODY.w && y >= BODY.y && y < BODY.y + BODY.h)

// Build raw RGBA pixels.
const pixels = Buffer.alloc(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    if (inside(x, y)) {
      // black, opaque
      pixels[i + 3] = 255
    }
    // else: zeros = fully transparent
  }
}

// Apply PNG filter type 0 (none) to every scanline.
const filtered = Buffer.alloc(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  pixels.copy(filtered, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4)
}
const idat = zlib.deflateSync(filtered, { level: 9 })

// Minimal PNG encoder.
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c >>> 0
}
function crc32(data) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const tb = Buffer.from(type)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0)
  return Buffer.concat([len, tb, data, crc])
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8       // 8-bit depth
ihdr[9] = 6       // RGBA color type
ihdr[10] = 0      // deflate compression
ihdr[11] = 0      // filter method
ihdr[12] = 0      // no interlace

const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
])

process.stdout.write(png.toString('base64'))
