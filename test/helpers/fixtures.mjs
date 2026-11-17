// 테스트용 합성 자료: ZIP, 이미지 머리, 항목 예시.

import { deflateRawSync } from 'node:zlib';

export function makeZip(files, { method = 0 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content);
    const stored = method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, stored);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + stored.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

export function pngHeader(width, height, padding = 0) {
  const buffer = Buffer.alloc(33 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

export function webpVp8xHeader(width, height) {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'latin1');
  buffer.write('VP8X', 12, 'latin1');
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

export function jpegHeader(width, height) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

export const SHA_A = 'a'.repeat(64);
export const SHA_B = 'b'.repeat(64);

export function moduleItem(overrides = {}) {
  return {
    kind: 'module',
    id: 'dev.example.sample-tool',
    name: 'Sample',
    summary: '예시 Module입니다.',
    publisher: { id: 'dev.example', name: 'Example' },
    repository: 'example-owner/sample-tool',
    license: 'MIT',
    advanced: null,
    versions: [
      {
        version: '1.0.0',
        releasedAt: '2026-11-17T00:00:00Z',
        compatibility: { minimumManagerVersion: '2.2.0' },
        capabilities: ['navigation.read', 'storage.local'],
        download: {
          url: 'https://github.com/example-owner/sample-tool/releases/download/v1.0.0/sample-1.0.0.dho-module',
          fileName: 'sample-1.0.0.dho-module',
        },
      },
    ],
    ...overrides,
  };
}

export function fixedModuleItem(overrides = {}) {
  const item = moduleItem(overrides);
  for (const entry of item.versions) {
    entry.download.bytes ??= 1234;
    entry.download.sha256 ??= SHA_A;
    entry.registration ??= { toolVersion: 'v2.2.0', runId: '100', at: '2026-11-18T00:00:00Z' };
  }
  return item;
}

export function packItem(overrides = {}) {
  return {
    kind: 'pack',
    id: 'community.example.theme',
    name: '예시 팩',
    summary: '예시 리소스팩입니다.',
    publisher: { id: 'community.example', name: 'Example', url: 'https://example.com' },
    repository: 'example-owner/pack-theme',
    license: 'CC-BY-4.0',
    advanced: null,
    versions: [
      {
        version: '2.0.0',
        releasedAt: '2026-11-17T00:00:00Z',
        compatibility: { minimumManagerVersion: '2.2.0', maximumManagerVersionExclusive: '3.0.0' },
        capabilities: [],
        download: {
          url: 'https://github.com/example-owner/pack-theme/releases/download/v2.0.0/theme-2.0.0.dho-pack',
          fileName: 'theme-2.0.0.dho-pack',
        },
      },
    ],
    ...overrides,
  };
}

export const ADVANCED = [
  'files.user',
  'network.session',
  'network.stream',
  'service.background',
  'sidecar.execute',
  'sidecar.resident',
  'vision.captureRegion',
  'vision.readText',
];

export function folderFiles(item, extra = {}) {
  return [
    { path: 'item.json', bytes: Buffer.from(JSON.stringify(item, null, 2)) },
    { path: 'README.md', bytes: Buffer.from('# 소개\n\n[저장소](https://github.com/example-owner/sample-tool)\n') },
    ...Object.entries(extra).map(([path, bytes]) => ({ path, bytes: Buffer.from(bytes) })),
  ];
}
