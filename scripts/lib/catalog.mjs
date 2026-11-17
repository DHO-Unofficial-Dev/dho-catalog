// 항목 폴더 판정과 catalog.json 생성.
// 생성은 item.json의 고정 값을 그대로 옮긴다. archive를 다시 받거나 해시를 다시 계산하지 않는다.

import { parseStrictJson, jsonDepth } from './json-strict.mjs';
import { checkItemFolder } from './media.mjs';
import { LIMITS, validateCatalogDocument, validateItemDocument } from './rules.mjs';

export function assessItemFolder({ kind, id, files }, { advancedCapabilities, requireFixed = false }) {
  const folder = checkItemFolder(files, { kind, id });
  const errors = [...folder.errors];
  let item = null;
  if (folder.itemBytes) {
    try {
      item = parseStrictJson(folder.itemBytes, { maxDepth: 16 });
    } catch (error) {
      errors.push(`item.json: ${error.message}`);
    }
  }
  if (item) {
    errors.push(...validateItemDocument(item, { advancedCapabilities, requireFixed }).map((message) => `item.json: ${message}`));
    if (item.kind !== kind) errors.push(`item.json: kind가 폴더(${kind}s)와 다르다`);
    if (item.id !== id) errors.push(`item.json: id가 폴더 이름(${id})과 다르다`);
  }
  return { errors, warnings: folder.warnings, item, media: folder.media };
}

export function toCatalogItem(item, media) {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    summary: item.summary,
    publisher: item.publisher,
    repository: item.repository,
    license: item.license,
    advanced: item.advanced,
    versions: item.versions.map((entry) => ({
      version: entry.version,
      releasedAt: entry.releasedAt,
      compatibility: entry.compatibility,
      capabilities: entry.capabilities,
      download: {
        url: entry.download.url,
        fileName: entry.download.fileName,
        bytes: entry.download.bytes,
        sha256: entry.download.sha256,
      },
    })),
    media,
  };
}

// 다음 revision: 이미 있는 catalog-r<N> 태그 중 가장 큰 N + 1. 태그가 없으면 1.
export function nextRevision(tagNames) {
  let max = 0n;
  for (const name of tagNames) {
    const match = /^catalog-r([1-9]\d*)$/.exec(name);
    if (match && BigInt(match[1]) > max) max = BigInt(match[1]);
  }
  const next = max + 1n;
  if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('catalogRevision 상한을 넘는다');
  const tag = `catalog-r${next}`;
  if (tagNames.includes(tag)) throw new Error(`태그 ${tag}가 이미 있다`);
  return { revision: Number(next), tag };
}

export function assertTagAbsent(tagNames, tag) {
  if (tagNames.includes(tag)) throw new Error(`태그 ${tag}가 이미 있어 Release를 만들지 않는다`);
}

export function buildCatalog({ base, entries, revision, sourceCommit, generatedAt, advancedCapabilities }) {
  const items = [...entries]
    .sort((a, b) => (a.item.kind === b.item.kind ? (a.item.id < b.item.id ? -1 : 1) : a.item.kind < b.item.kind ? -1 : 1))
    .map(({ item, media }) => toCatalogItem(item, media));
  const catalog = {
    schemaVersion: base.schemaVersion,
    catalogRevision: revision,
    generatedAt,
    sourceCommit,
    minimumManagerVersion: base.minimumManagerVersion,
    items,
    withdrawn: base.withdrawn,
  };
  const errors = validateCatalogDocument(catalog, { advancedCapabilities });
  const text = `${JSON.stringify(catalog, null, 2)}\n`;
  if (Buffer.byteLength(text) > LIMITS.catalogBytes) errors.push('catalog.json이 1 MiB를 넘는다');
  if (jsonDepth(catalog) > LIMITS.catalogDepth) errors.push('catalog.json 깊이가 16을 넘는다');
  if (errors.length) {
    const error = new Error(`catalog.json 검증 실패\n- ${errors.join('\n- ')}`);
    error.details = errors;
    throw error;
  }
  return { catalog, text };
}
