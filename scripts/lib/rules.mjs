// 항목·목록의 의미 규칙. schema로 표현하기 어려운 규칙(ID 형식, 버전 순서, 다운로드 주소, 고급 권한)을 검사한다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './schema-lite.mjs';

export const LIMITS = Object.freeze({
  catalogBytes: 1024 * 1024,
  catalogDepth: 16,
  items: 500,
  withdrawn: 500,
  versionsPerItem: 5,
  moduleArchiveBytes: 128 * 1024 * 1024,
  packArchiveBytes: 16 * 1024 * 1024,
  thumbnailBytes: 512 * 1024,
  thumbnailDimension: 1024,
  screenshotBytes: 1024 * 1024,
  screenshotWidth: 2560,
  screenshotHeight: 1600,
  screenshots: 4,
  readmeBytes: 64 * 1024,
  changesBytes: 32 * 1024,
});

export const KIND_DIRS = Object.freeze({ module: 'modules', pack: 'packs' });
export const DIR_KINDS = Object.freeze({ modules: 'module', packs: 'pack' });
export const ARCHIVE_EXTENSION = Object.freeze({ module: 'dho-module', pack: 'dho-pack' });

const schemaUrl = (name) => new URL(`../../schema/${name}`, import.meta.url);
export const ITEM_SCHEMA = JSON.parse(readFileSync(fileURLToPath(schemaUrl('item-v1.schema.json')), 'utf8'));
export const CATALOG_SCHEMA = JSON.parse(readFileSync(fileURLToPath(schemaUrl('catalog-v1.schema.json')), 'utf8'));

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseSemver(value) {
  const match = typeof value === 'string' ? SEMVER.exec(value) : null;
  if (!match) return null;
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isSemver(value) {
  return parseSemver(value) !== null;
}

// semver 2.0 순서. build metadata는 무시한다.
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) throw new Error(`semver가 아니다: ${!a ? left : right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length ? -1 : 1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// Module ID·publisher ID: 점으로 나눈 단계마다 소문자로 시작하고 소문자·숫자·`-`만, 단계당 32 byte 이하.
export function isModuleIdentifier(value, minimumSegments, maximumSegments, maximumBytes) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > maximumBytes) return false;
  const segments = value.split('.');
  if (segments.length < minimumSegments || segments.length > maximumSegments) return false;
  return segments.every((segment) => /^[a-z][a-z0-9-]{0,31}$/.test(segment));
}

export function isModuleId(value) {
  return isModuleIdentifier(value, 3, 8, 128);
}

export function isModulePublisherId(value) {
  return isModuleIdentifier(value, 2, 7, 96);
}

// 팩 ID: 소문자·숫자로 시작하고 소문자·숫자·`.`·`_`·`-`만, 128 byte 이하.
export function isPackId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
}

export function isReservedId(kind, id) {
  if (kind === 'module') return id.startsWith('app.dhoport.manager.');
  if (kind === 'pack') return id.startsWith('builtin.');
  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 허용 다운로드 주소: https://github.com/{repository}/releases/download/{tag}/{fileName}
export function checkDownloadUrl({ kind, repository, version, url, fileName }) {
  const errors = [];
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/releases\/download\/([A-Za-z0-9._-]{1,64})\/([^/?#%@:\s]+)$/.exec(url ?? '');
  if (!match) {
    return ['download.url은 https://github.com/<owner>/<repo>/releases/download/<tag>/<file> 형식이어야 한다(query·fragment·포트·percent-encoding 금지)'];
  }
  const [, owner, repo, tag, urlFileName] = match;
  if (`${owner}/${repo}`.toLowerCase() !== String(repository).toLowerCase()) errors.push('download.url의 저장소가 repository와 다르다');
  if (tag === 'latest') errors.push('download.url의 태그로 latest를 쓸 수 없다');
  if (urlFileName !== fileName) errors.push('download.url의 파일 이름이 download.fileName과 다르다');
  const extension = ARCHIVE_EXTENSION[kind];
  const pattern = new RegExp(`^[a-z0-9][a-z0-9-]{0,63}-${escapeRegExp(version)}\\.(dho-module|dho-pack)$`);
  const nameMatch = pattern.exec(fileName ?? '');
  if (!nameMatch) {
    errors.push(`download.fileName은 <이름>-${version}.${extension} 형식이어야 한다`);
  } else if (nameMatch[1] !== extension) {
    errors.push(`${kind}의 확장자는 .${extension}이어야 한다`);
  }
  return errors;
}

export function hasFixedValues(entry) {
  return entry.download?.bytes !== undefined && entry.download?.sha256 !== undefined && entry.registration !== undefined;
}

export function validateIsoTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

// item.json(작성 원본) 또는 catalog.json 항목에 공통인 의미 규칙.
// options.requireFixed: 모든 버전에 고정 값이 있어야 하는지(목록 생성)
export function checkItemSemantics(item, { advancedCapabilities, requireFixed = false, source = 'item' } = {}) {
  const errors = [];
  const { kind, id } = item;
  if (kind === 'module') {
    if (!isModuleId(id)) errors.push('Module ID 형식이 아니다(소문자 단계 3~8개, 단계당 32자 이하)');
    if (!isModulePublisherId(item.publisher?.id)) errors.push('Module publisher.id 형식이 아니다(소문자 단계 2~7개)');
    else if (!String(id).startsWith(`${item.publisher.id}.`)) errors.push('Module ID는 publisher.id + "."로 시작해야 한다');
  } else if (kind === 'pack') {
    if (!isPackId(id)) errors.push('팩 ID 형식이 아니다');
    if (!isPackId(item.publisher?.id)) errors.push('팩 publisher.id 형식이 아니다');
  }
  if (isReservedId(kind, String(id))) errors.push(`예약된 ID다: ${id}`);
  const [, repoName] = String(item.repository).split('/');
  if (repoName === '.' || repoName === '..') errors.push('repository 이름이 올바르지 않다');

  const versions = Array.isArray(item.versions) ? item.versions : [];
  for (let index = 0; index < versions.length; index += 1) {
    const entry = versions[index];
    const where = `versions[${index}] ${entry.version}`;
    if (!isSemver(entry.version)) continue;
    if (index > 0 && isSemver(versions[index - 1].version) && compareSemver(versions[index - 1].version, entry.version) <= 0) {
      errors.push(`${where}: versions는 semver 엄격한 내림차순이어야 하고 같은 버전이 둘이면 안 된다`);
    }
    if (!validateIsoTime(entry.releasedAt)) errors.push(`${where}: releasedAt이 올바른 시각이 아니다`);
    const compatibility = entry.compatibility ?? {};
    if (
      isSemver(compatibility.minimumManagerVersion) &&
      isSemver(compatibility.maximumManagerVersionExclusive) &&
      compareSemver(compatibility.minimumManagerVersion, compatibility.maximumManagerVersionExclusive) >= 0
    ) {
      errors.push(`${where}: maximumManagerVersionExclusive는 minimumManagerVersion보다 커야 한다`);
    }
    const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : [];
    if (kind === 'pack' && capabilities.length) errors.push(`${where}: 팩의 capabilities는 빈 배열이어야 한다`);
    const sorted = [...capabilities].sort();
    if (sorted.some((value, i) => value !== capabilities[i])) errors.push(`${where}: capabilities는 정렬돼 있어야 한다`);
    for (const message of checkDownloadUrl({ kind, repository: item.repository, version: entry.version, ...entry.download })) {
      errors.push(`${where}: ${message}`);
    }
    const fixedParts = [entry.download?.bytes, entry.download?.sha256, ...(source === 'item' ? [entry.registration] : [])];
    const present = fixedParts.filter((value) => value !== undefined).length;
    if (present !== 0 && present !== fixedParts.length) errors.push(`${where}: 고정 값(bytes·sha256·registration)은 함께 있어야 한다`);
    if (requireFixed && present !== fixedParts.length) errors.push(`${where}: 등재 workflow가 기록한 고정 값이 없다`);
    const limit = kind === 'pack' ? LIMITS.packArchiveBytes : LIMITS.moduleArchiveBytes;
    if (Number.isInteger(entry.download?.bytes) && entry.download.bytes > limit) errors.push(`${where}: archive 크기가 상한 ${limit} byte를 넘는다`);
    if (entry.registration && !validateIsoTime(entry.registration.at)) errors.push(`${where}: registration.at이 올바른 시각이 아니다`);
  }

  if (!Array.isArray(advancedCapabilities)) throw new Error('고급 권한 목록이 필요하다');
  const advancedSet = new Set(advancedCapabilities);
  const usesAdvanced = versions.some((entry) => (entry.capabilities ?? []).some((value) => advancedSet.has(value)));
  if (usesAdvanced && !item.advanced) errors.push('고급 권한을 쓰는 버전이 있으므로 advanced.explanation이 필요하다');
  if (!usesAdvanced && item.advanced !== null) errors.push('고급 권한을 쓰지 않으면 advanced는 null이어야 한다');
  return errors;
}

export function validateItemDocument(item, options) {
  const schemaErrors = validateSchema(ITEM_SCHEMA, item);
  if (schemaErrors.length) return schemaErrors;
  return checkItemSemantics(item, { ...options, source: 'item' });
}

export function validateCatalogDocument(catalog, { advancedCapabilities }) {
  const schemaErrors = validateSchema(CATALOG_SCHEMA, catalog);
  if (schemaErrors.length) return schemaErrors;
  const errors = [];
  const seen = new Set();
  for (const item of catalog.items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) errors.push(`${key}: (kind, id)가 중복된다`);
    seen.add(key);
    for (const message of checkItemSemantics(item, { advancedCapabilities, requireFixed: true, source: 'catalog' })) {
      errors.push(`${key}: ${message}`);
    }
    const base = `items/${KIND_DIRS[item.kind]}/${item.id}/`;
    const files = [item.media.thumbnail, item.media.readme, item.media.changes, ...item.media.screenshots].filter(Boolean);
    for (const file of files) {
      if (!file.path.startsWith(base)) errors.push(`${key}: media 경로 ${file.path}가 항목 폴더 밖이다`);
    }
    if (item.media.thumbnail && !/\/thumbnail\.(png|webp)$/.test(item.media.thumbnail.path)) errors.push(`${key}: thumbnail 경로가 올바르지 않다`);
    if (!item.media.readme.path.endsWith('/README.md')) errors.push(`${key}: readme 경로가 올바르지 않다`);
    if (item.media.changes && !item.media.changes.path.endsWith('/CHANGES.md')) errors.push(`${key}: changes 경로가 올바르지 않다`);
    item.media.screenshots.forEach((file, index) => {
      if (!new RegExp(`/screenshots/${index + 1}\\.(png|webp|jpg)$`).test(file.path)) errors.push(`${key}: 스크린샷 번호는 1부터 빈틈없이 이어져야 한다`);
    });
    const limits = { readme: LIMITS.readmeBytes, changes: LIMITS.changesBytes, thumbnail: LIMITS.thumbnailBytes };
    for (const [name, limit] of Object.entries(limits)) {
      if (item.media[name] && item.media[name].bytes > limit) errors.push(`${key}: ${name} 크기 상한 초과`);
    }
  }
  for (const entry of catalog.withdrawn) {
    if (!validateIsoTime(entry.at)) errors.push(`withdrawn ${entry.kind}:${entry.id}: at이 올바른 시각이 아니다`);
  }
  if (!validateIsoTime(catalog.generatedAt)) errors.push('generatedAt이 올바른 시각이 아니다');
  return errors;
}
