import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessItemFolder, buildCatalog, nextRevision } from '../scripts/lib/catalog.mjs';
import { validateCatalogDocument } from '../scripts/lib/rules.mjs';
import { ADVANCED, SHA_A, fixedModuleItem, folderFiles, moduleItem, packItem } from './helpers/fixtures.mjs';

const base = { schemaVersion: '1.0', minimumManagerVersion: '2.2.1-0', withdrawn: [] };
const COMMIT = 'c'.repeat(40);

function entryFor(item) {
  const result = assessItemFolder({ kind: item.kind, id: item.id, files: folderFiles(item) }, { advancedCapabilities: ADVANCED, requireFixed: true });
  assert.deepEqual(result.errors, []);
  return { item: result.item, media: result.media };
}

test('revision: catalog-r 태그 최댓값 + 1, 없으면 1', () => {
  assert.deepEqual(nextRevision([]), { revision: 1, tag: 'catalog-r1' });
  assert.deepEqual(nextRevision(['catalog-r1', 'catalog-r10', 'catalog-r9', 'v1.0.0', 'catalog-r01']), { revision: 11, tag: 'catalog-r11' });
  assert.throws(() => nextRevision([`catalog-r${Number.MAX_SAFE_INTEGER}`]), /상한/);
});

test('목록 생성: 고정 값을 그대로 옮기고 registration은 빼며 schema를 통과한다', () => {
  const item = fixedModuleItem();
  const { catalog, text } = buildCatalog({
    base,
    entries: [entryFor(item)],
    revision: 3,
    sourceCommit: COMMIT,
    generatedAt: '2026-11-18T00:00:00.000Z',
    advancedCapabilities: ADVANCED,
  });
  assert.equal(catalog.catalogRevision, 3);
  assert.equal(catalog.items[0].versions[0].download.sha256, SHA_A);
  assert.equal(catalog.items[0].versions[0].registration, undefined);
  assert.equal(catalog.items[0].media.readme.path, 'items/modules/dev.example.sample-tool/README.md');
  assert.equal(catalog.items[0].media.thumbnail, null);
  assert.deepEqual(validateCatalogDocument(JSON.parse(text), { advancedCapabilities: ADVANCED }), []);
});

test('목록 생성: 고정 값이 없는 버전이 있으면 실패한다', () => {
  const result = assessItemFolder({ kind: 'module', id: moduleItem().id, files: folderFiles(moduleItem()) }, { advancedCapabilities: ADVANCED, requireFixed: true });
  assert.ok(result.errors.some((message) => message.includes('고정 값이 없다')));
  assert.throws(
    () => buildCatalog({ base, entries: [{ item: moduleItem(), media: entryFor(fixedModuleItem()).media }], revision: 1, sourceCommit: COMMIT, generatedAt: '2026-11-18T00:00:00Z', advancedCapabilities: ADVANCED }),
    /검증 실패/,
  );
});

test('목록 검증: 중복 (kind, id)와 폴더 밖 media 경로를 거부한다', () => {
  const entry = entryFor(fixedModuleItem());
  assert.throws(() => buildCatalog({ base, entries: [entry, entry], revision: 1, sourceCommit: COMMIT, generatedAt: '2026-11-18T00:00:00Z', advancedCapabilities: ADVANCED }), /중복/);
  const moved = structuredClone(entry);
  moved.media.readme.path = 'items/modules/dev.example.other-tool/README.md';
  assert.throws(() => buildCatalog({ base, entries: [moved], revision: 1, sourceCommit: COMMIT, generatedAt: '2026-11-18T00:00:00Z', advancedCapabilities: ADVANCED }), /폴더 밖/);
});

test('항목 폴더: kind·id는 폴더와 같아야 하고 item.json 중복 키를 거부한다', () => {
  const item = moduleItem();
  const result = assessItemFolder({ kind: 'module', id: 'dev.example.other-tool', files: folderFiles(item) }, { advancedCapabilities: ADVANCED });
  assert.ok(result.errors.some((message) => message.includes('폴더 이름')));
  const packResult = assessItemFolder({ kind: 'module', id: packItem().id, files: folderFiles(packItem()) }, { advancedCapabilities: ADVANCED });
  assert.ok(packResult.errors.some((message) => message.includes('kind')));
  const dup = assessItemFolder({ kind: 'module', id: item.id, files: [{ path: 'item.json', bytes: Buffer.from('{"kind":"module","kind":"pack"}') }, { path: 'README.md', bytes: Buffer.from('x') }] }, { advancedCapabilities: ADVANCED });
  assert.ok(dup.errors.some((message) => message.includes('중복 키')));
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeRepo(items) {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-test-'));
  writeFileSync(join(dir, 'tools.lock.json'), readFileSync(join(ROOT, 'tools.lock.json')));
  writeFileSync(join(dir, 'catalog-base.json'), JSON.stringify(base));
  for (const item of items) {
    for (const file of folderFiles(item)) {
      const path = join(dir, 'items', `${item.kind}s`, item.id, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.bytes);
    }
  }
  return dir;
}

function runPublish(dir, tags) {
  writeFileSync(join(dir, 'tags.txt'), tags.join('\n'));
  return spawnSync(process.execPath, [join(ROOT, 'scripts', 'publish-catalog.mjs'), '--tags-file', 'tags.txt', '--source-commit', COMMIT, '--out', 'catalog.json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: join(dir, 'output.txt') },
  });
}

test('publish 스크립트: 고정 값이 있으면 다음 revision으로 만들고, 없으면 실패한다', () => {
  const ok = makeRepo([fixedModuleItem()]);
  try {
    const run = runPublish(ok, ['catalog-r1', 'catalog-r2']);
    assert.equal(run.status, 0, run.stderr);
    const catalog = JSON.parse(readFileSync(join(ok, 'catalog.json'), 'utf8'));
    assert.equal(catalog.catalogRevision, 3);
    assert.equal(catalog.sourceCommit, COMMIT);
    assert.match(readFileSync(join(ok, 'output.txt'), 'utf8'), /tag=catalog-r3/);
  } finally {
    rmSync(ok, { recursive: true, force: true });
  }
  const missing = makeRepo([moduleItem()]);
  try {
    const run = runPublish(missing, []);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /고정 값이 없다/);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
  const empty = makeRepo([]);
  try {
    const run = runPublish(empty, []);
    assert.equal(run.status, 0);
    assert.match(readFileSync(join(empty, 'output.txt'), 'utf8'), /skip=true/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
