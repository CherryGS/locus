import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(name), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, checksum]);
}
export function fixturePng(width: number, height: number) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 4 + 1) + 1 + x * 4; pixels.set([35, 91, 160, 255], i); }
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
/** Decode the noninterlaced RGB/RGBA PNG emitted by these real decoder fixtures,
 * including all PNG row filters and chunk checksums; merely checking magic bytes
 * would not establish a decodable derived representation. */
export function decodePng(bytes: Buffer) {
  assert.deepEqual(bytes.subarray(0, 8), signature); let offset = 8; let width = 0; let height = 0; let channels = 0; let ended = false; const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset); const name = bytes.toString("ascii", offset + 4, offset + 8); const data = bytes.subarray(offset + 8, offset + 8 + size);
    assert.equal(crc(bytes.subarray(offset + 4, offset + 8 + size)), bytes.readUInt32BE(offset + 8 + size));
    if (name === "IHDR") { width = data.readUInt32BE(); height = data.readUInt32BE(4); assert.equal(data[8], 8); assert([2, 6].includes(data[9])); channels = data[9] === 2 ? 3 : 4; assert.equal(data[12], 0); }
    if (name === "IDAT") compressed.push(data);
    offset += size + 12; if (name === "IEND") { ended = true; break; }
  }
  assert(ended); assert(width > 0 && height > 0); const raw = inflateSync(Buffer.concat(compressed)); const stride = width * channels;
  assert.equal(raw.length, (stride + 1) * height); const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x; const a = x >= channels ? pixels[at - channels] : 0; const b = y ? pixels[at - stride] : 0; const c = y && x >= channels ? pixels[at - stride - channels] : 0;
      const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      pixels[at] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}
