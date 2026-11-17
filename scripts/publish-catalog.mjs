#!/usr/bin/env node
// publish.yml 목록 생성. item.json의 고정 값을 그대로 옮기고, 고정 값이 없는 버전이 있으면 실패한다.
// 사용: node scripts/publish-catalog.mjs --tags-file <태그 목록 파일> --source-commit <sha> --out <catalog.json>
// GITHUB_OUTPUT이 있으면 skip·revision·tag를 기록한다.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkBaseConfig } from './lib/base-config.mjs';
import { assessItemFolder, buildCatalog, nextRevision } from './lib/catalog.mjs';
import { resolveAdvancedCapabilities } from './lib/registration.mjs';
import { listItemFolders, readFolderFiles, readJsonFile } from './lib/repo.mjs';

const { values } = parseArgs({
  options: {
    'tags-file': { type: 'string' },
    'source-commit': { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values['tags-file'] || !values['source-commit'] || !values.out) {
  console.error('필수 인수: --tags-file --source-commit --out');
  process.exit(1);
}
const output = (key, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};

const lock = readJsonFile('tools.lock.json');
const advancedCapabilities = resolveAdvancedCapabilities(lock, null);
const base = readJsonFile('catalog-base.json');
const errors = checkBaseConfig(base).map((message) => `catalog-base.json: ${message}`);

const { folders, errors: layoutErrors } = listItemFolders('.');
errors.push(...layoutErrors);
const entries = [];
for (const folder of folders) {
  const result = assessItemFolder({ ...folder, files: readFolderFiles(folder.dir) }, { advancedCapabilities, requireFixed: true });
  if (result.errors.length) errors.push(...result.errors.map((message) => `${folder.path}: ${message}`));
  else entries.push({ item: result.item, media: result.media });
}
if (errors.length) {
  console.error(`목록을 만들지 않는다:\n- ${errors.join('\n- ')}`);
  process.exit(2);
}
if (!entries.length && !base.withdrawn.length) {
  console.log('등재된 항목이 없어 Release를 만들지 않는다.');
  output('skip', 'true');
  process.exit(0);
}

const tags = readFileSync(values['tags-file'], 'utf8').split(/\s+/).filter(Boolean);
const { revision, tag } = nextRevision(tags);
const { text } = buildCatalog({
  base,
  entries,
  revision,
  sourceCommit: values['source-commit'],
  generatedAt: new Date().toISOString(),
  advancedCapabilities,
});
writeFileSync(values.out, text);
output('skip', 'false');
output('revision', String(revision));
output('tag', tag);
console.log(`${tag}: 항목 ${entries.length}개, ${Buffer.byteLength(text)} byte`);
