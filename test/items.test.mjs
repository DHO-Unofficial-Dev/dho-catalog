// 저장소에 있는 실제 항목 폴더와 설정 파일 검사(고정 값은 등재 전이면 없어도 된다).
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBaseConfig } from '../scripts/lib/base-config.mjs';
import { assessItemFolder } from '../scripts/lib/catalog.mjs';
import { resolveAdvancedCapabilities } from '../scripts/lib/registration.mjs';
import { listItemFolders, readFolderFiles, readJsonFile } from '../scripts/lib/repo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = readJsonFile(join(ROOT, 'tools.lock.json'));

test('tools.lock.json 형식', () => {
  assert.match(lock.toolVersion, /^v\d+\.\d+\.\d+/);
  for (const kind of ['module', 'pack']) {
    const tool = lock.tools[kind];
    assert.match(tool.url, /^https:\/\/github\.com\/DHO-Unofficial-Dev\/DHO-Manager\/releases\/download\/v[^/]+\/dho-(module|pack)-node-tools\.zip$/);
    assert.ok(tool.url.endsWith(`/${tool.fileName}`));
    assert.ok(tool.url.includes(`/${lock.toolVersion}/`));
    assert.match(tool.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(tool.bytes) && tool.bytes > 0);
  }
  assert.ok(resolveAdvancedCapabilities(lock, null).length > 0);
});

test('catalog-base.json 형식', () => {
  assert.deepEqual(checkBaseConfig(readJsonFile(join(ROOT, 'catalog-base.json'))), []);
});

test('저장소의 항목 폴더가 규칙을 지킨다', () => {
  const advancedCapabilities = resolveAdvancedCapabilities(lock, null);
  const { folders, errors } = listItemFolders(ROOT);
  assert.deepEqual(errors, []);
  for (const folder of folders) {
    const result = assessItemFolder({ ...folder, files: readFolderFiles(folder.dir) }, { advancedCapabilities });
    assert.deepEqual(result.errors, [], folder.path);
  }
});
