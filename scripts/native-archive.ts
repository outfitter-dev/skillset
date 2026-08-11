import { deflateRawSync, inflateRawSync } from "node:zlib";

import type { NativeArchiveKind } from "./native-targets";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32LE(
  buffer: Uint8Array,
  offset: number,
  value: number
): void {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  view.setUint32(offset, value >>> 0, true);
}

function writeUInt16LE(
  buffer: Uint8Array,
  offset: number,
  value: number
): void {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  view.setUint16(offset, value, true);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function writeAscii(
  buffer: Uint8Array,
  offset: number,
  length: number,
  value: string
): void {
  const bytes = encoder.encode(value);
  if (bytes.byteLength > length) {
    throw new Error(`Archive field exceeds ${length} bytes: ${value}`);
  }
  buffer.set(bytes, offset);
}

function writeOctal(
  buffer: Uint8Array,
  offset: number,
  length: number,
  value: number
): void {
  const text = value.toString(8).padStart(length - 1, "0");
  writeAscii(buffer, offset, length, `${text}\0`);
}

function createTar(executableName: string, executable: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  writeAscii(header, 0, 100, executableName);
  writeOctal(header, 100, 8, 0o755);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, executable.byteLength);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);

  const padding = new Uint8Array((512 - (executable.byteLength % 512)) % 512);
  return concatBytes(header, executable, padding, new Uint8Array(1024));
}

function createGzip(bytes: Uint8Array): Uint8Array {
  const compressed = new Uint8Array(deflateRawSync(bytes, { level: 9 }));
  const header = Uint8Array.of(0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0xff);
  const trailer = new Uint8Array(8);
  writeUInt32LE(trailer, 0, crc32(bytes));
  writeUInt32LE(trailer, 4, bytes.byteLength);
  return concatBytes(header, compressed, trailer);
}

function extractGzip(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error("Invalid deterministic gzip archive");
  }
  const compressed = bytes.subarray(10, bytes.byteLength - 8);
  const result = new Uint8Array(inflateRawSync(compressed));
  const trailer = new DataView(
    bytes.buffer,
    bytes.byteOffset + bytes.byteLength - 8,
    8
  );
  if (trailer.getUint32(0, true) !== crc32(result)) {
    throw new Error("Gzip CRC32 mismatch");
  }
  if (trailer.getUint32(4, true) !== result.byteLength) {
    throw new Error("Gzip size mismatch");
  }
  return result;
}

function createZip(executableName: string, executable: Uint8Array): Uint8Array {
  const name = encoder.encode(executableName);
  const compressed = new Uint8Array(deflateRawSync(executable, { level: 9 }));
  const checksum = crc32(executable);

  const local = new Uint8Array(30 + name.byteLength);
  writeUInt32LE(local, 0, 0x04034b50);
  writeUInt16LE(local, 4, 20);
  writeUInt16LE(local, 6, 0);
  writeUInt16LE(local, 8, 8);
  writeUInt16LE(local, 10, 0);
  writeUInt16LE(local, 12, 0x21);
  writeUInt32LE(local, 14, checksum);
  writeUInt32LE(local, 18, compressed.byteLength);
  writeUInt32LE(local, 22, executable.byteLength);
  writeUInt16LE(local, 26, name.byteLength);
  writeUInt16LE(local, 28, 0);
  local.set(name, 30);

  const central = new Uint8Array(46 + name.byteLength);
  writeUInt32LE(central, 0, 0x02014b50);
  writeUInt16LE(central, 4, 0x0314);
  writeUInt16LE(central, 6, 20);
  writeUInt16LE(central, 8, 0);
  writeUInt16LE(central, 10, 8);
  writeUInt16LE(central, 12, 0);
  writeUInt16LE(central, 14, 0x21);
  writeUInt32LE(central, 16, checksum);
  writeUInt32LE(central, 20, compressed.byteLength);
  writeUInt32LE(central, 24, executable.byteLength);
  writeUInt16LE(central, 28, name.byteLength);
  writeUInt16LE(central, 30, 0);
  writeUInt16LE(central, 32, 0);
  writeUInt16LE(central, 34, 0);
  writeUInt16LE(central, 36, 0);
  writeUInt32LE(central, 38, 0o100755 << 16);
  writeUInt32LE(central, 42, 0);
  central.set(name, 46);

  const end = new Uint8Array(22);
  writeUInt32LE(end, 0, 0x06054b50);
  writeUInt16LE(end, 4, 0);
  writeUInt16LE(end, 6, 0);
  writeUInt16LE(end, 8, 1);
  writeUInt16LE(end, 10, 1);
  writeUInt32LE(end, 12, central.byteLength);
  writeUInt32LE(end, 16, local.byteLength + compressed.byteLength);
  writeUInt16LE(end, 20, 0);

  return concatBytes(local, compressed, central, end);
}

function extractZip(bytes: Uint8Array): {
  readonly bytes: Uint8Array;
  readonly name: string;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) {
    throw new Error("Invalid deterministic zip archive");
  }
  const method = view.getUint16(8, true);
  const checksum = view.getUint32(14, true);
  const compressedSize = view.getUint32(18, true);
  const rawSize = view.getUint32(22, true);
  const nameSize = view.getUint16(26, true);
  const extraSize = view.getUint16(28, true);
  const name = decoder.decode(bytes.subarray(30, 30 + nameSize));
  const start = 30 + nameSize + extraSize;
  const compressed = bytes.subarray(start, start + compressedSize);
  if (method !== 8)
    throw new Error(`Unsupported zip compression method ${method}`);
  const result = new Uint8Array(inflateRawSync(compressed));
  if (result.byteLength !== rawSize || crc32(result) !== checksum) {
    throw new Error("Zip payload checksum or size mismatch");
  }
  return { bytes: result, name };
}

function extractTar(bytes: Uint8Array): {
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly name: string;
} {
  if (bytes.byteLength < 1536)
    throw new Error("Invalid deterministic tar archive");
  const name = decoder.decode(bytes.subarray(0, 100)).replace(/\0.*$/s, "");
  const mode = Number.parseInt(
    decoder.decode(bytes.subarray(100, 108)).replace(/\0.*$/s, ""),
    8
  );
  const size = Number.parseInt(
    decoder.decode(bytes.subarray(124, 136)).replace(/\0.*$/s, ""),
    8
  );
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(mode)) {
    throw new Error("Invalid tar metadata");
  }
  return { bytes: bytes.slice(512, 512 + size), mode, name };
}

export function createNativeArchive(
  kind: NativeArchiveKind,
  executableName: string,
  executable: Uint8Array
): Uint8Array {
  return kind === "zip"
    ? createZip(executableName, executable)
    : createGzip(createTar(executableName, executable));
}

export function extractNativeArchive(
  kind: NativeArchiveKind,
  archive: Uint8Array
): {
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly name: string;
} {
  if (kind === "zip") {
    const extracted = extractZip(archive);
    return { ...extracted, mode: 0o755 };
  }
  return extractTar(extractGzip(archive));
}
