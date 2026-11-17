#!/usr/bin/env node
// tools.lock.json이 고정한 공개 도구 키트를 받아 크기·SHA-256을 확인하고 푼다.
// 사용: node scripts/fetch-tools.mjs <출력 폴더>

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { downloadReleaseAsset } from './lib/download.mjs';
import { sha256Hex } from './lib/media.mjs';
import { readJsonFile } from './lib/repo.mjs';
import { readZip } from './lib/zip.mjs';

const [outDir] = process.argv.slice(2);
if (!outDir) {
  console.error('사용: node scripts/fetch-tools.mjs <출력 폴더>');
  process.exit(1);
}

const lock = readJsonFile('tools.lock.json');
for (const [kind, tool] of Object.entries(lock.tools)) {
  const { bytes } = await downloadReleaseAsset(tool.url, { maxBytes: 64 * 1024 * 1024 });
  const sha256 = sha256Hex(bytes);
  if (bytes.length !== tool.bytes || sha256 !== tool.sha256) {
    throw new Error(`${tool.fileName}: tools.lock.json과 다르다(${bytes.length} byte, ${sha256})`);
  }
  const zip = readZip(bytes);
  const target = join(outDir, kind);
  for (const name of zip.names) {
    if (name.endsWith('/')) continue;
    const path = join(target, ...name.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, zip.read(name));
  }
  console.log(`${kind}: ${tool.fileName} ${sha256} 확인`);
}
