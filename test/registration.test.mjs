import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertWritePaths,
  buildArtifact,
  changesMarkdown,
  checkArchiveManifest,
  codeSpan,
  describeChanges,
  oneLine,
  ownerMismatch,
  checkCompanionSha,
  checkTreeEntries,
  mergeFixedValues,
  parseToolResult,
  planRegistration,
  resolveAdvancedCapabilities,
  scopeFromChangedPaths,
  validateArtifact,
} from '../scripts/lib/registration.mjs';
import { validateItemDocument } from '../scripts/lib/rules.mjs';
import { ADVANCED, SHA_A, SHA_B, fixedModuleItem, moduleItem, packItem } from './helpers/fixtures.mjs';

const DIR = 'items/modules/dev.example.sample-tool';

test('범위: 항목 폴더 하나만 바꿀 수 있다', () => {
  assert.deepEqual(scopeFromChangedPaths([`${DIR}/item.json`, `${DIR}/README.md`]), { kind: 'module', id: 'dev.example.sample-tool', dir: DIR });
  assert.throws(() => scopeFromChangedPaths([`${DIR}/item.json`, 'items/packs/other/item.json']), /하나만/);
  assert.throws(() => scopeFromChangedPaths([`${DIR}/item.json`, 'catalog-base.json']), /하나만/);
  assert.throws(() => scopeFromChangedPaths(['.github/workflows/register.yml']), /하나만/);
  assert.throws(() => scopeFromChangedPaths(['tools.lock.json']), /하나만/);
  assert.throws(() => scopeFromChangedPaths([]), /없다/);
});

test('tree: 일반 파일만, 폴더 밖 경로 거부', () => {
  const blob = '0'.repeat(40);
  assert.deepEqual(checkTreeEntries([`100644 blob ${blob}\t${DIR}/item.json`, ''], DIR), [{ path: 'item.json', object: blob }]);
  assert.throws(() => checkTreeEntries([`120000 blob ${blob}\t${DIR}/README.md`], DIR), /일반 파일/);
  assert.throws(() => checkTreeEntries([`100755 blob ${blob}\t${DIR}/README.md`], DIR), /일반 파일/);
  assert.throws(() => checkTreeEntries([`160000 commit ${blob}\t${DIR}/sub`], DIR), /일반 파일/);
  assert.throws(() => checkTreeEntries([`100644 blob ${blob}\titems/modules/other/item.json`], DIR), /폴더 밖/);
});

function withNewVersion(item, version = '1.1.0') {
  const next = structuredClone(item);
  next.versions.unshift({
    ...structuredClone(moduleItem().versions[0]),
    version,
    download: {
      url: `https://github.com/example-owner/sample-tool/releases/download/v${version}/sample-${version}.dho-module`,
      fileName: `sample-${version}.dho-module`,
    },
  });
  return next;
}

test('등재 계획: 새 항목은 모든 버전이 새 버전이다', () => {
  const plan = planRegistration({ mainItem: null, headItem: moduleItem() });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.newVersions.map((entry) => entry.version), ['1.0.0']);
});

test('등재 계획: 이미 고정된 버전의 url·sha256·bytes·compatibility 변경을 거부한다', () => {
  const main = fixedModuleItem();
  const mutations = {
    sha256: (item) => (item.versions[1].download.sha256 = SHA_B),
    bytes: (item) => (item.versions[1].download.bytes = 99),
    url: (item) => (item.versions[1].download.url = item.versions[1].download.url.replace('v1.0.0', 'v1.0.0-re')),
    compatibility: (item) => (item.versions[1].compatibility = { minimumManagerVersion: '2.2.1' }),
    capabilities: (item) => (item.versions[1].capabilities = ['navigation.read']),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const head = withNewVersion(main);
    mutate(head);
    assert.notDeepEqual(planRegistration({ mainItem: main, headItem: head }).errors, [], name);
  }
  const head = withNewVersion(main);
  const plan = planRegistration({ mainItem: main, headItem: head });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.newVersions.map((entry) => entry.version), ['1.1.0']);
});

test('등재 계획: 새 버전에 해시를 적으면 거부, 소개만 바꾸면 새 버전 없이 통과', () => {
  const head = moduleItem();
  head.versions[0].download.sha256 = SHA_A;
  head.versions[0].download.bytes = 1;
  assert.match(planRegistration({ mainItem: null, headItem: head }).errors.join(), /적지 않는다/);
  const main = fixedModuleItem();
  const display = structuredClone(main);
  display.summary = '소개만 바꿉니다.';
  const plan = planRegistration({ mainItem: main, headItem: display });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.newVersions, []);
  const artifact = buildArtifact({ kind: 'module', id: main.id, results: [], toolVersion: 'v2.2.0', runId: '5', at: '2026-11-18T00:00:00Z' });
  assert.deepEqual(validateArtifact(artifact, { kind: 'module', id: main.id, newVersions: [], runId: '5', toolVersion: 'v2.2.0' }), []);
  assert.deepEqual(mergeFixedValues(display, artifact), display);
});

test('소유 잠금: repository 변경은 이전 허용 입력이 있어야 한다', () => {
  const main = fixedModuleItem();
  const head = withNewVersion(main);
  head.repository = 'someone-else/sample-tool';
  head.versions[0].download.url = head.versions[0].download.url.replace('example-owner', 'someone-else');
  assert.match(planRegistration({ mainItem: main, headItem: head }).errors.join(), /repository/);
  assert.deepEqual(planRegistration({ mainItem: main, headItem: head, allowRepositoryTransfer: true }).errors.filter((m) => m.includes('repository')), []);
});

const moduleManifest = {
  moduleId: 'dev.example.sample-tool',
  version: '1.0.0',
  publisher: { id: 'dev.example', name: 'Example' },
  minimumManagerVersion: '2.2.0',
  capabilities: ['storage.local', 'navigation.read'],
};

test('archive 대조: Module', () => {
  const item = moduleItem();
  const entry = item.versions[0];
  assert.deepEqual(checkArchiveManifest({ kind: 'module', item, entry, manifest: moduleManifest }), []);
  const cases = {
    moduleId: { moduleId: 'dev.example.other' },
    version: { version: '1.0.1' },
    publisher: { publisher: { id: 'dev.other' } },
    minimum: { minimumManagerVersion: '2.2.1' },
    maximum: { maximumManagerVersionExclusive: '3.0.0' },
    capability: { capabilities: ['navigation.read', 'storage.local', 'sidecar.resident'] },
  };
  for (const [name, change] of Object.entries(cases)) {
    assert.notDeepEqual(checkArchiveManifest({ kind: 'module', item, entry, manifest: { ...moduleManifest, ...change } }), [], name);
  }
});

const packManifest = {
  formatVersion: 1,
  packId: 'community.example.theme',
  version: '2.0.0',
  publisher: { id: 'community.example', name: 'Example' },
  compatibility: { minimumManagerVersion: '2.2.0', maximumManagerVersionExclusive: '3.0.0' },
  components: {},
};

test('archive 대조: 팩 추가 조건(formatVersion·signature·semver·내장 거점 보정)', () => {
  const item = packItem();
  const entry = item.versions[0];
  const read = () => null;
  assert.deepEqual(checkArchiveManifest({ kind: 'pack', item, entry, manifest: packManifest, readArchiveFile: read }), []);
  assert.notDeepEqual(checkArchiveManifest({ kind: 'pack', item, entry, manifest: { ...packManifest, formatVersion: 0 }, readArchiveFile: read }), []);
  assert.notDeepEqual(checkArchiveManifest({ kind: 'pack', item, entry, manifest: { ...packManifest, signature: {} }, readArchiveFile: read }), []);
  assert.notDeepEqual(checkArchiveManifest({ kind: 'pack', item, entry, manifest: { ...packManifest, version: '2.0' }, readArchiveFile: read }), []);
  const withPoi = { ...packManifest, components: { poiData: { source: 'components/poi-data/pois.json' } } };
  const poi = (data) => (name) => (name === 'components/poi-data/pois.json' ? Buffer.from(JSON.stringify(data)) : null);
  assert.deepEqual(checkArchiveManifest({ kind: 'pack', item, entry, manifest: withPoi, readArchiveFile: poi({ pois: [] }) }), []);
  assert.match(checkArchiveManifest({ kind: 'pack', item, entry, manifest: withPoi, readArchiveFile: poi({ pois: [], coordinateOverrides: [] }) }).join(), /내장 거점/);
  assert.match(checkArchiveManifest({ kind: 'pack', item, entry, manifest: withPoi, readArchiveFile: poi({ hiddenPoiIds: ['x'] }) }).join(), /내장 거점/);
  assert.match(checkArchiveManifest({ kind: 'pack', item, entry, manifest: withPoi, readArchiveFile: () => null }).join(), /읽을 수 없다/);
});

test('공개 도구 결과: exit 0과 status valid가 함께 있어야 통과', () => {
  assert.equal(parseToolResult('{"status":"valid","code":"ok"}\n', 0).valid, true);
  assert.equal(parseToolResult('{"status":"valid"}', 2).valid, false);
  assert.equal(parseToolResult('{"status":"invalid","code":"archive.x"}', 2).valid, false);
  assert.equal(parseToolResult('garbage', 0).valid, false);
  assert.equal(parseToolResult('{"status":"valid"}\n(node:1) ExperimentalWarning: x\n', 0).valid, true, '뒤에 섞인 경고 줄');
  assert.equal(parseToolResult('{"other":1}\n', 0).valid, false);
});

test('고급 권한 목록: 정책에 필드가 생기면 tools.lock.json과 같아야 한다', () => {
  const lock = { advancedCapabilities: ADVANCED };
  assert.deepEqual(resolveAdvancedCapabilities(lock, null), [...ADVANCED].sort());
  assert.deepEqual(resolveAdvancedCapabilities(lock, { capabilities: [] }), [...ADVANCED].sort());
  assert.deepEqual(resolveAdvancedCapabilities(lock, { advancedCapabilities: [...ADVANCED].reverse() }), [...ADVANCED].sort());
  assert.throws(() => resolveAdvancedCapabilities(lock, { advancedCapabilities: ['files.user'] }), /다르다/);
  assert.throws(() => resolveAdvancedCapabilities({}, null), /없다/);
});

test('.sha256 동반 자산 대조', () => {
  assert.ok(checkCompanionSha(`${SHA_A}  tool-1.0.0.dho-module\n`, SHA_A));
  assert.ok(!checkCompanionSha(`${SHA_B}  tool-1.0.0.dho-module\n`, SHA_A));
});

function artifactFor(overrides = {}) {
  return {
    ...buildArtifact({
      kind: 'module',
      id: 'dev.example.sample-tool',
      results: [{ version: '1.0.0', bytes: 1234, sha256: SHA_A, capabilities: ['navigation.read', 'storage.local'] }],
      toolVersion: 'v2.2.0',
      runId: '777',
      at: '2026-11-18T00:00:00.000Z',
    }),
    ...overrides,
  };
}

test('artifact 검증: 정상 artifact를 받아 item.json에 합친다', () => {
  const head = moduleItem();
  const { newVersions } = planRegistration({ mainItem: null, headItem: head });
  const artifact = artifactFor();
  assert.deepEqual(validateArtifact(artifact, { kind: 'module', id: head.id, newVersions, runId: '777', toolVersion: 'v2.2.0' }), []);
  const merged = mergeFixedValues(head, artifact);
  assert.equal(merged.versions[0].download.sha256, SHA_A);
  assert.equal(merged.versions[0].download.bytes, 1234);
  assert.deepEqual(merged.versions[0].registration, { toolVersion: 'v2.2.0', runId: '777', at: '2026-11-18T00:00:00.000Z' });
  assert.deepEqual(validateItemDocument(merged, { advancedCapabilities: ADVANCED, requireFixed: true }), []);
  assert.equal(head.versions[0].download.sha256, undefined, 'PR item은 바뀌지 않는다');
});

test('artifact 오염 거부', () => {
  const head = moduleItem();
  const { newVersions } = planRegistration({ mainItem: null, headItem: head });
  const context = { kind: 'module', id: head.id, newVersions, runId: '777', toolVersion: 'v2.2.0' };
  const good = artifactFor();
  const cases = {
    '항목 폴더 밖 경로 필드': { ...good, files: { '../../.github/workflows/x.yml': 'x' } },
    '버전 안 경로 필드': { ...good, versions: { '1.0.0': { ...good.versions['1.0.0'], path: '.github/x' } } },
    '64자 hex 아님': { ...good, versions: { '1.0.0': { ...good.versions['1.0.0'], sha256: 'abc' } } },
    '대문자 hex': { ...good, versions: { '1.0.0': { ...good.versions['1.0.0'], sha256: 'A'.repeat(64) } } },
    'PR에 없는 버전': { ...good, versions: { ...good.versions, '9.9.9': good.versions['1.0.0'] } },
    '버전 누락': { ...good, versions: {} },
    'bytes 0': { ...good, versions: { '1.0.0': { ...good.versions['1.0.0'], bytes: 0 } } },
    'bytes 상한 초과': { ...good, versions: { '1.0.0': { ...good.versions['1.0.0'], bytes: 128 * 1024 * 1024 + 1 } } },
    'capabilities 다름': { ...good, versions: { '1.0.0': { ...good.versions['1.0.0'], capabilities: ['navigation.read'] } } },
    '다른 실행 id': { ...good, registration: { ...good.registration, runId: '778' } },
    '다른 항목': { ...good, id: 'dev.example.other' },
    '다른 도구 버전': { ...good, registration: { ...good.registration, toolVersion: 'v9' } },
  };
  for (const [name, artifact] of Object.entries(cases)) {
    assert.notDeepEqual(validateArtifact(artifact, context), [], name);
  }
  const pack = packItem();
  const packPlan = planRegistration({ mainItem: null, headItem: pack });
  const bigPack = {
    kind: 'pack',
    id: pack.id,
    versions: { '2.0.0': { bytes: 16 * 1024 * 1024 + 1, sha256: SHA_A, capabilities: [] } },
    registration: good.registration,
  };
  assert.notDeepEqual(validateArtifact(bigPack, { kind: 'pack', id: pack.id, newVersions: packPlan.newVersions, runId: '777' }), [], '팩 상한');
});

test('main 대비 변경 요약: 제거되는 버전·바뀌는 필드·파일', () => {
  const main = withNewVersion(fixedModuleItem());
  main.versions[0].download.bytes = 1;
  main.versions[0].download.sha256 = SHA_B;
  main.versions[0].registration = { toolVersion: 'v2.2.0', runId: '2', at: '2026-11-18T00:00:00Z' };
  const head = fixedModuleItem({ summary: '바뀐 요약', advanced: null });
  const changes = describeChanges({
    mainItem: main,
    headItem: head,
    mainFiles: [{ path: 'README.md', bytes: Buffer.from('a') }, { path: 'CHANGES.md', bytes: Buffer.from('c') }],
    headFiles: [{ path: 'README.md', bytes: Buffer.from('b') }, { path: 'thumbnail.png', bytes: Buffer.from('p') }],
  });
  assert.deepEqual(changes.removedVersions, ['1.1.0']);
  assert.deepEqual(changes.addedVersions, []);
  assert.deepEqual(changes.changedFields, ['summary']);
  assert.deepEqual(changes.modifiedFiles, ['README.md']);
  assert.deepEqual(changes.removedFiles, ['CHANGES.md']);
  assert.deepEqual(changes.addedFiles, ['thumbnail.png']);
  const markdown = changesMarkdown(changes);
  assert.match(markdown, /제거되는 버전: `1\.1\.0`/);
  const fresh = describeChanges({ mainItem: null, headItem: head, mainFiles: [], headFiles: [] });
  assert.equal(fresh.isNew, true);
  assert.deepEqual(fresh.addedVersions, ['1.0.0']);
});

test('summary 값 정리: 백틱·개행 제거, PR 작성자와 owner 비교', () => {
  assert.equal(codeSpan('a`b\nc'), '`a b c`');
  assert.equal(codeSpan('x'.repeat(5), 3), '`xxx…`');
  assert.equal(codeSpan(undefined), '`없음`');
  assert.equal(oneLine('a\r\nb\nc'), 'a b c');
  assert.equal(ownerMismatch('Example-Owner', 'example-owner/tool'), false);
  assert.equal(ownerMismatch('someone', 'example-owner/tool'), true);
});

test('archive 대조 메시지의 archive 값은 백틱으로 감싸고 개행을 없앤다', () => {
  const item = moduleItem();
  const [message] = checkArchiveManifest({ kind: 'module', item, entry: item.versions[0], manifest: { ...moduleManifest, moduleId: 'evil\n### 승인됨' } });
  assert.equal(message.includes('\n'), false);
  assert.match(message, /`evil ### 승인됨`/);
});

test('쓰기 경로 검사: 항목 폴더 밖 변경이 있으면 commit하지 않는다', () => {
  assert.doesNotThrow(() => assertWritePaths([`${DIR}/item.json`, `${DIR}/README.md`], DIR));
  assert.throws(() => assertWritePaths([`${DIR}/item.json`, '.github/workflows/publish.yml'], DIR), /폴더 밖/);
  assert.throws(() => assertWritePaths([`${DIR}-evil/item.json`], DIR), /폴더 밖/);
  assert.throws(() => assertWritePaths([], DIR), /없다/);
});
