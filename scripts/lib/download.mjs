// GitHub Release 자산 받기. 앱의 archive 받기 규칙과 같다:
// 첫 응답은 정확히 1 hop의 redirect이고, 대상은 GitHub 자산 호스트(HTTPS, 기본 포트)뿐이다.

export const ASSET_HOSTS = Object.freeze(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

export class DownloadError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const HEADERS = { 'user-agent': 'dho-catalog-register', 'accept-encoding': 'identity' };

function checkEncoding(response) {
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw new DownloadError('network', `압축 응답은 받지 않는다(${encoding})`);
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new DownloadError('too-large', `${declared} byte > ${maxBytes}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw new DownloadError('too-large', `${maxBytes} byte 초과`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function checkRedirectTarget(location, base) {
  let target;
  try {
    target = new URL(location, base);
  } catch {
    throw new DownloadError('redirect-denied', '해석할 수 없는 redirect');
  }
  if (target.protocol !== 'https:' || target.port !== '' || target.username || target.password || !ASSET_HOSTS.includes(target.hostname)) {
    throw new DownloadError('redirect-denied', `허용하지 않는 redirect 대상 ${target.hostname}`);
  }
  return target.toString();
}

// 반환: { status: 'ok', bytes } 또는 { status: 'missing' }(allowMissing일 때 첫 응답 404)
export async function downloadReleaseAsset(url, { maxBytes, fetchImpl = fetch, allowMissing = false, timeoutMs = 10 * 60 * 1000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let first;
  try {
    first = await fetchImpl(url, { redirect: 'manual', headers: HEADERS, signal });
  } catch (error) {
    throw new DownloadError('network', error.message);
  }
  if (allowMissing && first.status === 404) return { status: 'missing' };
  if (first.status < 300 || first.status > 399) throw new DownloadError('http-status', `첫 응답은 redirect여야 한다(${first.status})`);
  const target = checkRedirectTarget(first.headers.get('location'), url);
  let second;
  try {
    second = await fetchImpl(target, { redirect: 'manual', headers: HEADERS, signal });
  } catch (error) {
    throw new DownloadError('network', error.message);
  }
  if (second.status >= 300 && second.status <= 399) throw new DownloadError('redirect-denied', 'redirect는 1 hop만 허용한다');
  if (second.status !== 200) throw new DownloadError('http-status', `${second.status}`);
  checkEncoding(second);
  return { status: 'ok', bytes: await readCapped(second, maxBytes) };
}
