import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStrictJson } from '../scripts/lib/json-strict.mjs';
import { validateSchema } from '../scripts/lib/schema-lite.mjs';
import {
  CATALOG_SCHEMA,
  ITEM_SCHEMA,
  checkDownloadUrl,
  compareSemver,
  isModuleId,
  isPackId,
  validateItemDocument,
} from '../scripts/lib/rules.mjs';
import { ADVANCED, fixedModuleItem, moduleItem, packItem } from './helpers/fixtures.mjs';

const options = { advancedCapabilities: ADVANCED };

test('엄격한 JSON: 중복 키·깊이·남은 문자를 거부한다', () => {
  assert.deepEqual(parseStrictJson('{"a":[1,{"b":"c"}]}'), { a: [1, { b: 'c' }] });
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /중복 키/);
  assert.throws(() => parseStrictJson('{"a":{"b":{"a":1,"a":1}}}'), /중복 키/);
  assert.throws(() => parseStrictJson('[[[1]]]', { maxDepth: 2 }), /깊이/);
  assert.throws(() => parseStrictJson('{"a":1} x'), /남은 문자/);
  assert.throws(() => parseStrictJson(Buffer.from([0x7b, 0xff, 0x7d])), /UTF-8/);
  assert.equal(parseStrictJson('{"__proto__":1}').__proto__, 1);
});

test('semver 순서: prerelease는 정식보다 낮고 build metadata는 무시한다', () => {
  assert.equal(compareSemver('2.2.1-beta.3', '2.2.1'), -1);
  assert.equal(compareSemver('2.2.1-beta.10', '2.2.1-beta.9'), 1);
  assert.equal(compareSemver('2.2.1-0', '2.2.1-beta.1'), -1);
  assert.equal(compareSemver('1.0.0+a', '1.0.0+b'), 0);
  assert.equal(compareSemver('10.0.0', '9.9.9'), 1);
});

test('ID 형식', () => {
  assert.ok(isModuleId('dev.dho-unofficial.sea-notice'));
  assert.ok(!isModuleId('dev.example'));
  assert.ok(!isModuleId('Dev.example.tool'));
  assert.ok(!isModuleId('dev.example.1tool'));
  assert.ok(isPackId('community.dhoport.haewio'));
  assert.ok(!isPackId('.community'));
  assert.ok(!isPackId('Community'));
});

test('다운로드 주소 허용 표', () => {
  const base = { kind: 'module', repository: 'Owner/Repo', version: '1.0.0', fileName: 'tool-1.0.0.dho-module' };
  const ok = 'https://github.com/owner/repo/releases/download/v1.0.0/tool-1.0.0.dho-module';
  assert.deepEqual(checkDownloadUrl({ ...base, url: ok }), []);
  const rejected = {
    latest: 'https://github.com/owner/repo/releases/download/latest/tool-1.0.0.dho-module',
    otherRepo: 'https://github.com/owner/other/releases/download/v1.0.0/tool-1.0.0.dho-module',
    query: `${ok}?x=1`,
    fragment: `${ok}#x`,
    port: 'https://github.com:443/owner/repo/releases/download/v1.0.0/tool-1.0.0.dho-module',
    http: ok.replace('https', 'http'),
    upperScheme: ok.replace('https', 'HTTPS'),
    percent: 'https://github.com/owner/repo/releases/download/v1.0.0/tool-1.0.0%2Edho-module',
    userinfo: 'https://user@github.com/owner/repo/releases/download/v1.0.0/tool-1.0.0.dho-module',
    otherHost: 'https://example.com/owner/repo/releases/download/v1.0.0/tool-1.0.0.dho-module',
  };
  for (const [name, url] of Object.entries(rejected)) {
    assert.notDeepEqual(checkDownloadUrl({ ...base, url }), [], name);
  }
  const pack = 'https://github.com/owner/repo/releases/download/v1.0.0/tool-1.0.0.dho-pack';
  assert.notDeepEqual(checkDownloadUrl({ ...base, fileName: 'tool-1.0.0.dho-pack', url: pack }), [], '확장자와 kind 불일치');
  const otherVersion = 'https://github.com/owner/repo/releases/download/v1.0.0/tool-1.0.1.dho-module';
  assert.notDeepEqual(checkDownloadUrl({ ...base, fileName: 'tool-1.0.1.dho-module', url: otherVersion }), [], '파일 이름 버전 불일치');
});

test('item.json: 기본 예시가 통과한다', () => {
  assert.deepEqual(validateItemDocument(moduleItem(), options), []);
  assert.deepEqual(validateItemDocument(packItem(), options), []);
  assert.deepEqual(validateItemDocument(fixedModuleItem(), { ...options, requireFixed: true }), []);
});

test('item.json: 의미 규칙 위반', () => {
  const cases = {
    '예약 Module ID': moduleItem({ id: 'app.dhoport.manager.city-information', publisher: { id: 'app.dhoport', name: 'x' } }),
    '예약 팩 ID': packItem({ id: 'builtin.default', publisher: { id: 'builtin', name: 'x' } }),
    'publisher 접두': moduleItem({ id: 'dev.other.tool' }),
    '팩 capability': packItem({ versions: [{ ...packItem().versions[0], capabilities: ['storage.local'] }] }),
    '고급 권한 설명 없음': moduleItem({ versions: [{ ...moduleItem().versions[0], capabilities: ['files.user'] }] }),
    '고급 권한 없는데 설명': moduleItem({ advanced: { explanation: '필요 없음' } }),
    '정렬 안 된 capabilities': moduleItem({ versions: [{ ...moduleItem().versions[0], capabilities: ['storage.local', 'navigation.read'] }] }),
    '고정 값 일부만': moduleItem({ versions: [{ ...moduleItem().versions[0], download: { ...moduleItem().versions[0].download, sha256: 'a'.repeat(64) } }] }),
    '요약 81자': moduleItem({ summary: '가'.repeat(81) }),
    '제어 문자': moduleItem({ name: 'a\u0007b' }),
    '모르는 필드': { ...moduleItem(), extra: 1 },
    '대문자 sha256': fixedModuleItem({ versions: [{ ...moduleItem().versions[0], download: { ...moduleItem().versions[0].download, bytes: 1, sha256: 'A'.repeat(64) }, registration: { toolVersion: 'v', runId: '1', at: '2026-11-18T00:00:00Z' } }] }),
  };
  for (const [name, item] of Object.entries(cases)) {
    assert.notDeepEqual(validateItemDocument(item, options), [], name);
  }
  assert.deepEqual(validateItemDocument(moduleItem({ summary: '가'.repeat(80) }), options), [], '요약 80자는 허용');
});

test('item.json: versions는 엄격한 내림차순, 중복 금지', () => {
  const v = (version) => ({
    ...moduleItem().versions[0],
    version,
    download: {
      url: `https://github.com/example-owner/sample-tool/releases/download/v${version}/sample-${version}.dho-module`,
      fileName: `sample-${version}.dho-module`,
    },
  });
  assert.deepEqual(validateItemDocument(moduleItem({ versions: [v('1.1.0'), v('1.0.0')] }), options), []);
  assert.notDeepEqual(validateItemDocument(moduleItem({ versions: [v('1.0.0'), v('1.1.0')] }), options), []);
  assert.notDeepEqual(validateItemDocument(moduleItem({ versions: [v('1.0.0'), v('1.0.0')] }), options), []);
});

test('고정 값을 요구하면 없는 버전을 거부한다', () => {
  const errors = validateItemDocument(moduleItem(), { ...options, requireFixed: true });
  assert.ok(errors.some((message) => message.includes('고정 값이 없다')));
});

test('schema 사이 버전 형식이 어긋나지 않는다', () => {
  const itemVersion = ITEM_SCHEMA.$defs.version.properties;
  const catalogVersion = CATALOG_SCHEMA.$defs.version.properties;
  for (const key of ['version', 'releasedAt', 'compatibility', 'capabilities']) {
    assert.ok(key in catalogVersion, key);
  }
  assert.deepEqual(Object.keys(catalogVersion).sort(), Object.keys(itemVersion).filter((key) => key !== 'registration').sort());
  assert.deepEqual(CATALOG_SCHEMA.$defs.version.properties.download.required, ['url', 'fileName', 'bytes', 'sha256']);
  assert.deepEqual(ITEM_SCHEMA.$defs.version.properties.download.required, ['url', 'fileName']);
  for (const key of ['semver', 'isoTime', 'sha256', 'httpsUrl', 'repository', 'capability', 'display40', 'display80', 'id']) {
    assert.deepEqual(CATALOG_SCHEMA.$defs[key], ITEM_SCHEMA.$defs[key], key);
  }
  const itemTop = ITEM_SCHEMA.required;
  assert.deepEqual(CATALOG_SCHEMA.$defs.item.required, [...itemTop, 'media']);
});

test('schema 해석기는 모르는 키워드를 거부한다', () => {
  assert.throws(() => validateSchema({ type: 'string', format: 'uri' }, 'x'), /지원하지 않는/);
  assert.deepEqual(validateSchema({ type: 'string', maxLength: 2 }, '가나'), []);
  assert.notDeepEqual(validateSchema({ type: 'string', maxLength: 2 }, '가나다'), []);
});
