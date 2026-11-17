import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkItemFolder, checkMarkdown, imageInfo } from '../scripts/lib/media.mjs';
import { readZip } from '../scripts/lib/zip.mjs';
import { jpegHeader, makeZip, moduleItem, pngHeader, webpVp8xHeader } from './helpers/fixtures.mjs';

test('이미지 형식은 매직 넘버로 판정한다', () => {
  assert.deepEqual(imageInfo(pngHeader(1024, 576)), { format: 'png', width: 1024, height: 576 });
  assert.deepEqual(imageInfo(webpVp8xHeader(800, 600)), { format: 'webp', width: 800, height: 600 });
  assert.deepEqual(imageInfo(jpegHeader(1280, 720)), { format: 'jpg', width: 1280, height: 720 });
  assert.equal(imageInfo(Buffer.from('<svg/>')), null);
});

const item = Buffer.from(JSON.stringify(moduleItem()));
const readme = Buffer.from('# Sample\n');
const base = [
  { path: 'item.json', bytes: item },
  { path: 'README.md', bytes: readme },
];
const ctx = { kind: 'module', id: 'dev.example.sample-tool' };

test('항목 폴더: 허용 파일과 media 경로', () => {
  const result = checkItemFolder(
    [
      ...base,
      { path: 'thumbnail.png', bytes: pngHeader(512, 512) },
      { path: 'screenshots/1.jpg', bytes: jpegHeader(1920, 1080) },
      { path: 'screenshots/2.webp', bytes: webpVp8xHeader(1280, 720) },
      { path: 'CHANGES.md', bytes: Buffer.from('## 1.0.0\n') },
    ],
    ctx,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.media.thumbnail.path, 'items/modules/dev.example.sample-tool/thumbnail.png');
  assert.deepEqual(result.media.screenshots.map((file) => file.path.split('/').pop()), ['1.jpg', '2.webp']);
  assert.equal(result.media.readme.sha256.length, 64);
});

test('항목 폴더: 위반 사례', () => {
  const cases = {
    '모르는 파일': [...base, { path: 'logo.svg', bytes: Buffer.from('<svg/>') }],
    '대소문자 변형': [{ path: 'item.json', bytes: item }, { path: 'readme.md', bytes: readme }],
    'README 없음': [{ path: 'item.json', bytes: item }],
    '스크린샷 번호 빈틈': [...base, { path: 'screenshots/2.png', bytes: pngHeader(10, 10) }],
    '스크린샷 5번': [...base, { path: 'screenshots/5.png', bytes: pngHeader(10, 10) }],
    '확장자와 형식 불일치': [...base, { path: 'thumbnail.png', bytes: webpVp8xHeader(10, 10) }],
    '썸네일 해상도': [...base, { path: 'thumbnail.png', bytes: pngHeader(1025, 10) }],
    '썸네일 크기': [...base, { path: 'thumbnail.png', bytes: pngHeader(10, 10, 512 * 1024) }],
    '스크린샷 해상도': [...base, { path: 'screenshots/1.png', bytes: pngHeader(2561, 10) }],
    '썸네일 둘': [...base, { path: 'thumbnail.png', bytes: pngHeader(10, 10) }, { path: 'thumbnail.webp', bytes: webpVp8xHeader(10, 10) }],
    'README UTF-8 아님': [{ path: 'item.json', bytes: item }, { path: 'README.md', bytes: Buffer.from([0xff, 0xfe]) }],
    'README 64 KiB 초과': [{ path: 'item.json', bytes: item }, { path: 'README.md', bytes: Buffer.alloc(64 * 1024 + 1, 0x61) }],
    'README http 링크': [{ path: 'item.json', bytes: item }, { path: 'README.md', bytes: Buffer.from('[a](http://example.com)') }],
    'README 상대 링크': [{ path: 'item.json', bytes: item }, { path: 'README.md', bytes: Buffer.from('[a](../../releases)') }],
  };
  for (const [name, files] of Object.entries(cases)) {
    assert.notDeepEqual(checkItemFolder(files, ctx).errors, [], name);
  }
});

test('README 링크 검사: https 절대 주소만, 코드 안은 무시, HTML은 경고', () => {
  assert.deepEqual(checkMarkdown('[a](https://example.com/x)\n<https://example.com>\n[r]: https://example.com', 'R').errors, []);
  assert.deepEqual(checkMarkdown('`[a](javascript:x)`\n```\n[b](data:x)\n```', 'R').errors, []);
  assert.equal(checkMarkdown('[a](javascript:alert(1))', 'R').errors.length, 1);
  assert.equal(checkMarkdown('[r]: mailto:a@b.c', 'R').errors.length, 1);
  assert.equal(checkMarkdown('<img src="https://x">', 'R').warnings.length, 1);
});

test('ZIP 읽기: stored·deflate, 경로 탈출·중복 거부', () => {
  for (const method of [0, 8]) {
    const zip = readZip(makeZip({ 'manifest.json': '{"a":1}', 'dir/file.txt': 'hello' }, { method }));
    assert.deepEqual(zip.names, ['manifest.json', 'dir/file.txt']);
    assert.equal(zip.read('dir/file.txt').toString(), 'hello');
    assert.equal(zip.read('missing'), null);
  }
  assert.throws(() => readZip(makeZip({ '../evil': 'x' })), /허용하지 않는 경로/);
  assert.throws(() => readZip(makeZip({ '/abs': 'x' })), /허용하지 않는 경로/);
  assert.throws(() => readZip(makeZip({ 'a\\b': 'x' })), /허용하지 않는 경로/);
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /끝 레코드/);
});
