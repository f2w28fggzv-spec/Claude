// Renders the iPhone app's icon from tools/app-icon/icon.svg: an opaque PNG, 8-bit RGB with no alpha channel, as App
// Store Connect requires for the 1024 x 1024 icon (it refuses one with alpha: ITMS-90717).
//
//   npm run app-icon
//   (node tools/app-icon/render.cjs <in.svg> <out.png> <size>, with Playwright from NODE_PATH)
//
// The SVG is drawn into a canvas in the pre-installed Chromium from a data: URL, so nothing is loaded from anywhere
// (and the browser is cut off from every other site anyway: tools/offline-check/local-only.cjs). The PNG is written
// here with node:zlib (deflate and CRC-32): no image library. Any pixel that isn't opaque is refused.
const { readFileSync, writeFileSync } = require('node:fs');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const { launchLocalOnly } = require('../offline-check/local-only.cjs');

const [, , input, output, sizeArg] = process.argv;
const size = Number(sizeArg || 1024);
if (!input || !output || !Number.isInteger(size) || size < 16 || size > 4096) {
  console.error('Usage: node tools/app-icon/render.cjs <in.svg> <out.png> <size>');
  process.exit(2);
}

/** An 8-bit RGB PNG (colour type 2, no alpha) from RGBA pixels that must all be opaque. */
function pngRgb(width, height, rgba) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] !== 255) throw new Error(`pixel ${x},${y} is not opaque (alpha ${rgba[i + 3]})`);
      rgba.copy(raw, y * (width * 3 + 1) + 1 + x * 3, i, i + 3);
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

(async () => {
  const svg = readFileSync(input, 'utf8');
  const browser = await launchLocalOnly(chromium);
  try {
    const page = await browser.newPage();
    const pixels = await page.evaluate(
      async ({ svg, size }) => {
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        return Array.from(ctx.getImageData(0, 0, size, size).data);
      },
      { svg, size },
    );
    writeFileSync(output, pngRgb(size, size, Buffer.from(pixels)));
    console.log(`app-icon: ${output} (${size} x ${size}, 8-bit RGB, no alpha)`);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(`app-icon: ${err.message}`);
  process.exit(1);
});
