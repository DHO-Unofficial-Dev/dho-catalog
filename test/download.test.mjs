import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadReleaseAsset } from '../scripts/lib/download.mjs';

const URL_A = 'https://github.com/owner/repo/releases/download/v1.0.0/tool-1.0.0.dho-module';

function response(status, { headers = {}, body = '' } = {}) {
  return new Response(status === 204 || (status >= 300 && status < 400) ? null : body, { status, headers });
}

function fakeFetch(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps.shift();
    if (!step) throw new Error('예상 밖 요청');
    return step(url);
  };
  return { fetchImpl, calls };
}

test('정확히 1 hop, 자산 호스트로만 받는다', async () => {
  const { fetchImpl, calls } = fakeFetch([
    () => response(302, { headers: { location: 'https://release-assets.githubusercontent.com/x?sig=1' } }),
    () => response(200, { body: 'archive' }),
  ]);
  const result = await downloadReleaseAsset(URL_A, { maxBytes: 100, fetchImpl });
  assert.equal(result.bytes.toString(), 'archive');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.headers['accept-encoding'], 'identity');
});

test('redirect 거부: 다른 호스트, http, 포트, 2 hop, redirect 없음', async () => {
  const cases = {
    다른호스트: [() => response(302, { headers: { location: 'https://evil.example.com/x' } })],
    http: [() => response(302, { headers: { location: 'http://release-assets.githubusercontent.com/x' } })],
    포트: [() => response(302, { headers: { location: 'https://release-assets.githubusercontent.com:8443/x' } })],
    두번: [
      () => response(302, { headers: { location: 'https://objects.githubusercontent.com/x' } }),
      () => response(302, { headers: { location: 'https://objects.githubusercontent.com/y' } }),
    ],
    직접200: [() => response(200, { body: 'x' })],
  };
  for (const [name, steps] of Object.entries(cases)) {
    const { fetchImpl } = fakeFetch(steps);
    await assert.rejects(downloadReleaseAsset(URL_A, { maxBytes: 100, fetchImpl }), /redirect|http-status/, name);
  }
});

test('크기 상한과 압축 응답 거부', async () => {
  const redirect = () => response(302, { headers: { location: 'https://objects.githubusercontent.com/x' } });
  let fake = fakeFetch([redirect, () => response(200, { body: 'x'.repeat(101) })]);
  await assert.rejects(downloadReleaseAsset(URL_A, { maxBytes: 100, fetchImpl: fake.fetchImpl }), /too-large/);
  fake = fakeFetch([redirect, () => response(200, { body: 'x', headers: { 'content-encoding': 'gzip' } })]);
  await assert.rejects(downloadReleaseAsset(URL_A, { maxBytes: 100, fetchImpl: fake.fetchImpl }), /압축/);
});

test('동반 자산이 없으면 missing으로 알린다', async () => {
  const { fetchImpl } = fakeFetch([() => response(404)]);
  assert.deepEqual(await downloadReleaseAsset(`${URL_A}.sha256`, { maxBytes: 100, fetchImpl, allowMissing: true }), { status: 'missing' });
});
