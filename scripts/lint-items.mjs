#!/usr/bin/env node
// PR 안내용 검사(pr-lint.yml). 신뢰 근거가 아니다. 등재 판정은 main의 register.yml이 한다.
// 사용: node scripts/lint-items.mjs [--require-fixed]

import { parseArgs } from 'node:util';
import { assessItemFolder } from './lib/catalog.mjs';
import { resolveAdvancedCapabilities } from './lib/registration.mjs';
import { listItemFolders, readFolderFiles, readJsonFile } from './lib/repo.mjs';
import { checkBaseConfig } from './lib/base-config.mjs';

const { values } = parseArgs({ options: { 'require-fixed': { type: 'boolean', default: false } } });

const errors = [];
const warnings = [];
const lock = readJsonFile('tools.lock.json');
const advancedCapabilities = resolveAdvancedCapabilities(lock, null);
errors.push(...checkBaseConfig(readJsonFile('catalog-base.json')).map((message) => `catalog-base.json: ${message}`));

const { folders, errors: layoutErrors } = listItemFolders('.');
errors.push(...layoutErrors);
for (const folder of folders) {
  const result = assessItemFolder({ ...folder, files: readFolderFiles(folder.dir) }, { advancedCapabilities, requireFixed: values['require-fixed'] });
  errors.push(...result.errors.map((message) => `${folder.path}: ${message}`));
  warnings.push(...result.warnings.map((message) => `${folder.path}: ${message}`));
  if (result.item && !values['require-fixed']) {
    for (const entry of result.item.versions ?? []) {
      if (entry.download?.sha256 === undefined) warnings.push(`${folder.path}: ${entry.version}은 아직 고정 값이 없다(소유자가 register.yml로 기록한다)`);
    }
  }
}

for (const warning of warnings) console.log(`경고: ${warning}`);
for (const error of errors) console.log(`오류: ${error}`);
console.log(`항목 ${folders.length}개, 오류 ${errors.length}개, 경고 ${warnings.length}개`);
process.exit(errors.length ? 1 : 0);
