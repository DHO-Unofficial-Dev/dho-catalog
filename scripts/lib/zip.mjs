// 등재 검사용 최소 ZIP 읽기. archive는 압축 해제·읽기만 하고 실행하지 않는다.
// zip64·암호화·중복 이름·경로 탈출은 거부한다. stored(0)와 deflate(8)만 읽는다.

import { inflateRawSync } from 'node:zlib';

export class ZipError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function readZip(buffer, { maxEntries = 4096, maxEntryBytes = 64 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  const searchStart = Math.max(0, buffer.length - (0xffff + 22));
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('ZIP 끝 레코드가 없다');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) throw new ZipError('zip64는 지원하지 않는다');
  if (entryCount > maxEntries) throw new ZipError(`파일 수 ${maxEntries} 초과`);
  if (centralOffset + centralSize > eocd) throw new ZipError('중앙 디렉터리 범위가 잘못됐다');

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new ZipError('중앙 디렉터리 항목이 잘못됐다');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x1) throw new ZipError(`암호화된 항목: ${name}`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('zip64는 지원하지 않는다');
    if (!isSafeName(name)) throw new ZipError(`허용하지 않는 경로: ${name}`);
    if (entries.has(name)) throw new ZipError(`중복 경로: ${name}`);
    if (size > maxEntryBytes) throw new ZipError(`파일이 너무 크다: ${name}`);
    entries.set(name, { name, method, compressedSize, size, localOffset });
  }

  const read = (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    const offset = entry.localOffset;
    if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new ZipError(`로컬 헤더가 잘못됐다: ${name}`);
    const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (data.length !== entry.compressedSize) throw new ZipError(`데이터가 잘렸다: ${name}`);
    let result;
    if (entry.method === 0) result = Buffer.from(data);
    else if (entry.method === 8) result = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) });
    else throw new ZipError(`지원하지 않는 압축 방식 ${entry.method}: ${name}`);
    if (result.length !== entry.size) throw new ZipError(`풀린 크기가 다르다: ${name}`);
    return result;
  };

  return { names: [...entries.keys()], has: (name) => entries.has(name), read };
}

function isSafeName(name) {
  if (!name || name.length > 1024) return false;
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((part, index, parts) => part !== '..' && part !== '.' && (part !== '' || index === parts.length - 1));
}
