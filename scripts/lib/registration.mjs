// 등재 workflow(register.yml)의 판정 함수. 입출력 없이 값만 다루므로 node --test로 고정한다.

import { parseStrictJson } from './json-strict.mjs';
import { ITEM_SCHEMA, LIMITS, DIR_KINDS, KIND_DIRS, isSemver } from './rules.mjs';
import { validateSchema } from './schema-lite.mjs';

// PR이 바꾼 경로는 items/<kind>s/<id>/ 하나 안에 있어야 한다.
export function scopeFromChangedPaths(paths) {
  if (!paths.length) throw new Error('PR에 바뀐 파일이 없다');
  let scope = null;
  for (const path of paths) {
    const match = /^items\/(modules|packs)\/([a-z0-9][a-z0-9._-]*)\/[^\0]+$/.exec(path);
    if (!match) throw new Error(`등재 PR은 items/<kind>s/<id>/ 하나만 바꿀 수 있다: ${path}`);
    const current = { kind: DIR_KINDS[match[1]], id: match[2] };
    if (scope && (scope.kind !== current.kind || scope.id !== current.id)) throw new Error('등재 PR은 항목 폴더 하나만 바꿀 수 있다');
    scope = current;
  }
  return { ...scope, dir: `items/${KIND_DIRS[scope.kind]}/${scope.id}` };
}

// `git ls-tree -r` 줄: "<mode> <type> <object>\t<path>". 일반 파일(100644)만 허용한다.
export function checkTreeEntries(lines, dir) {
  const entries = [];
  for (const line of lines) {
    if (!line) continue;
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t(.+)$/.exec(line);
    if (!match) throw new Error(`해석할 수 없는 tree 줄: ${line}`);
    const [, mode, type, object, path] = match;
    if (!path.startsWith(`${dir}/`)) throw new Error(`항목 폴더 밖 경로: ${path}`);
    if (mode !== '100644' || type !== 'blob') throw new Error(`일반 파일만 허용한다(심볼릭 링크·실행 파일·submodule 금지): ${path}`);
    entries.push({ path: path.slice(dir.length + 1), object });
  }
  return entries;
}

const LOCKED_DOWNLOAD_FIELDS = ['url', 'fileName', 'bytes', 'sha256'];

function canonical(value) {
  return JSON.stringify(value, (key, child) => (child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort()) : child));
}

// main의 item.json(없으면 null)과 PR head의 item.json을 비교해 새로 고정할 버전을 정한다.
export function planRegistration({ mainItem, headItem, allowRepositoryTransfer = false }) {
  const errors = [];
  if (mainItem) {
    if (mainItem.repository !== headItem.repository && !allowRepositoryTransfer) {
      errors.push(`repository를 ${mainItem.repository}에서 ${headItem.repository}로 바꿀 수 없다(소유자가 allowRepositoryTransfer로 실행해야 한다)`);
    }
    if (mainItem.kind !== headItem.kind || mainItem.id !== headItem.id) errors.push('kind·id는 바꿀 수 없다');
  }
  const mainVersions = new Map((mainItem?.versions ?? []).map((entry) => [entry.version, entry]));
  const newVersions = [];
  for (const entry of headItem.versions) {
    const fixed = mainVersions.get(entry.version);
    const fixedOnMain = fixed && fixed.download?.sha256 !== undefined;
    if (fixedOnMain) {
      for (const field of LOCKED_DOWNLOAD_FIELDS) {
        if (fixed.download[field] !== entry.download[field]) errors.push(`${entry.version}: 이미 고정된 버전의 download.${field}는 바꿀 수 없다`);
      }
      if (canonical(fixed.compatibility) !== canonical(entry.compatibility)) errors.push(`${entry.version}: 이미 고정된 버전의 compatibility는 바꿀 수 없다`);
      if (canonical(fixed.capabilities) !== canonical(entry.capabilities)) errors.push(`${entry.version}: 이미 고정된 버전의 capabilities는 바꿀 수 없다`);
      if (canonical(fixed.registration) !== canonical(entry.registration)) errors.push(`${entry.version}: registration은 등재 workflow만 쓴다`);
      continue;
    }
    if (entry.download.bytes !== undefined || entry.download.sha256 !== undefined || entry.registration !== undefined) {
      errors.push(`${entry.version}: 새 버전에는 bytes·sha256·registration을 적지 않는다(등재 workflow가 기록한다)`);
    }
    newVersions.push(entry);
  }
  // 새 버전 없이 소개 정보·자료만 바꾸는 PR도 같은 흐름(소유 잠금·고정 값 보호)으로 기록한다.
  return { errors, newVersions };
}

// job summary(Markdown)에 넣을 외부 값: 제어 문자·개행·백틱을 공백으로 바꾸고 줄인 뒤 백틱으로 감싼다.
export function codeSpan(value, maximum = 120) {
  const text = String(value ?? '없음').replace(/[\u0000-\u001f\u007f-\u009f`]/g, ' ');
  const cut = [...text].slice(0, maximum).join('');
  return `\`${cut}${[...text].length > maximum ? '…' : ''}\``;
}

// summary 한 줄: 개행을 없앤다.
export function oneLine(text) {
  return String(text).replace(/[\r\n]+/g, ' ');
}

// PR 작성자와 repository owner가 다른지(대소문자 무시).
export function ownerMismatch(prAuthor, repository) {
  const owner = String(repository).split('/')[0] ?? '';
  return String(prAuthor).toLowerCase() !== owner.toLowerCase();
}

// 승인 화면용: main 대비 PR이 바꾸는 것. 버전 추가·제거, item.json 필드, 파일.
export function describeChanges({ mainItem, headItem, mainFiles, headFiles }) {
  const mainVersions = (mainItem?.versions ?? []).map((entry) => entry.version);
  const headVersions = (headItem?.versions ?? []).map((entry) => entry.version);
  const addedVersions = headVersions.filter((version) => !mainVersions.includes(version));
  const removedVersions = mainVersions.filter((version) => !headVersions.includes(version));
  const changedFields = [];
  if (mainItem) {
    const keys = new Set([...Object.keys(mainItem), ...Object.keys(headItem ?? {})]);
    for (const key of [...keys].sort()) {
      if (key === 'versions') continue;
      if (canonical(mainItem[key]) !== canonical(headItem?.[key])) changedFields.push(key);
    }
    const mainByVersion = new Map(mainItem.versions.map((entry) => [entry.version, entry]));
    for (const entry of headItem?.versions ?? []) {
      const before = mainByVersion.get(entry.version);
      if (!before) continue;
      for (const key of [...new Set([...Object.keys(before), ...Object.keys(entry)])].sort()) {
        if (canonical(before[key]) !== canonical(entry[key])) changedFields.push(`versions[${entry.version}].${key}`);
      }
    }
  }
  const mainMap = new Map(mainFiles.map((file) => [file.path, file.bytes]));
  const headMap = new Map(headFiles.map((file) => [file.path, file.bytes]));
  const addedFiles = [...headMap.keys()].filter((path) => !mainMap.has(path)).sort();
  const removedFiles = [...mainMap.keys()].filter((path) => !headMap.has(path)).sort();
  const modifiedFiles = [...headMap.keys()].filter((path) => mainMap.has(path) && !Buffer.from(mainMap.get(path)).equals(Buffer.from(headMap.get(path)))).sort();
  return { isNew: !mainItem, addedVersions, removedVersions, changedFields, addedFiles, removedFiles, modifiedFiles };
}

export function changesMarkdown(changes) {
  const list = (values) => (values.length ? values.map((value) => codeSpan(value)).join(', ') : '없음');
  const lines = ['#### main 대비 변경', ''];
  lines.push(`- 항목: ${changes.isNew ? '새 항목' : '기존 항목 갱신'}`);
  lines.push(`- 추가되는 버전: ${list(changes.addedVersions)}`);
  lines.push(`- **제거되는 버전: ${list(changes.removedVersions)}**`);
  lines.push(`- 바뀌는 item.json 필드: ${list(changes.changedFields)}`);
  lines.push(`- 추가 파일: ${list(changes.addedFiles)}`);
  lines.push(`- 삭제 파일: ${list(changes.removedFiles)}`);
  lines.push(`- 수정 파일: ${list(changes.modifiedFiles)}`);
  return lines.join('\n');
}

// 공개 도구 출력: 통과하면 stdout에 한 줄 JSON(status valid)과 exit 0, 실패하면 stderr에 JSON과 exit 2·1.
// 다른 줄(경고 등)이 섞여도 status가 있는 마지막 JSON 객체 줄을 결과로 본다.
export function parseToolResult(stdout, exitCode) {
  let result = null;
  for (const line of String(stdout).split('\n').reverse()) {
    try {
      const value = JSON.parse(line.trim());
      if (value && typeof value === 'object' && typeof value.status === 'string') {
        result = value;
        break;
      }
    } catch {
      // JSON이 아닌 줄은 건너뛴다.
    }
  }
  const valid = exitCode === 0 && result?.status === 'valid';
  return { valid, result };
}

function sameOptional(left, right) {
  return (left ?? null) === (right ?? null);
}

// archive manifest와 item.json의 대조. pack은 등재 추가 조건도 함께 본다.
export function checkArchiveManifest({ kind, item, entry, manifest, readArchiveFile }) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return ['archive manifest.json을 읽을 수 없다'];
  // archive 값은 job summary에 그대로 들어가므로 codeSpan으로 감싼다.
  const q = codeSpan;
  if (kind === 'module') {
    if (manifest.moduleId !== item.id) errors.push(`moduleId ${q(manifest.moduleId)} ≠ ${q(item.id)}`);
    if (manifest.version !== entry.version) errors.push(`version ${q(manifest.version)} ≠ ${q(entry.version)}`);
    if (manifest.publisher?.id !== item.publisher.id) errors.push(`publisher.id ${q(manifest.publisher?.id)} ≠ ${q(item.publisher.id)}`);
    if (manifest.minimumManagerVersion !== entry.compatibility.minimumManagerVersion) errors.push('minimumManagerVersion이 다르다');
    if (!sameOptional(manifest.maximumManagerVersionExclusive, entry.compatibility.maximumManagerVersionExclusive)) errors.push('maximumManagerVersionExclusive가 다르다');
    const declared = Array.isArray(manifest.capabilities) ? [...new Set(manifest.capabilities)].sort() : null;
    if (!declared || canonical(declared) !== canonical(entry.capabilities)) errors.push(`capabilities가 archive와 다르다(archive: ${q(declared?.join(', ') ?? '없음')})`);
    return errors;
  }
  if (manifest.packId !== item.id) errors.push(`packId ${q(manifest.packId)} ≠ ${q(item.id)}`);
  if (manifest.version !== entry.version) errors.push(`팩 version ${q(manifest.version)} ≠ ${q(entry.version)}`);
  if (!isSemver(manifest.version)) errors.push('팩 version은 semver여야 한다');
  if (manifest.publisher?.id !== item.publisher.id) errors.push(`publisher.id ${q(manifest.publisher?.id)} ≠ ${q(item.publisher.id)}`);
  if (manifest.formatVersion !== 1) errors.push('팩 formatVersion은 1이어야 한다');
  if (Object.hasOwn(manifest, 'signature')) errors.push('signature 선언이 있는 팩은 등재할 수 없다');
  if (manifest.compatibility?.minimumManagerVersion !== entry.compatibility.minimumManagerVersion) errors.push('minimumManagerVersion이 다르다');
  if (!sameOptional(manifest.compatibility?.maximumManagerVersionExclusive, entry.compatibility.maximumManagerVersionExclusive)) errors.push('maximumManagerVersionExclusive가 다르다');
  if (entry.capabilities.length) errors.push('팩의 capabilities는 빈 배열이어야 한다');
  const poiData = manifest.components?.poiData;
  if (poiData) {
    const source = typeof poiData.source === 'string' ? readArchiveFile(poiData.source) : null;
    if (!source) {
      errors.push('poiData 원본 파일을 읽을 수 없다');
    } else {
      let data = null;
      try {
        data = parseStrictJson(source, { maxDepth: 32 });
      } catch (error) {
        errors.push(`poiData 원본이 올바른 JSON이 아니다: ${codeSpan(error.message)}`);
      }
      if (data && (Object.hasOwn(data, 'coordinateOverrides') || Object.hasOwn(data, 'hiddenPoiIds'))) {
        errors.push('내장 거점 보정·숨김(coordinateOverrides·hiddenPoiIds)이 든 팩은 등재할 수 없다');
      }
    }
  }
  return errors;
}

export function checkCompanionSha(text, sha256) {
  const token = String(text).trim().split(/\s+/)[0]?.toLowerCase();
  return token === sha256;
}

// 고급 권한 목록. 원본은 공개 Module 정책 advancedCapabilities이고, tools.lock.json에 같은 목록을 고정해 둔다.
// 정책에 필드가 아직 없으면 tools.lock.json의 목록을 쓰고, 있으면 두 목록이 같아야 한다.
export function resolveAdvancedCapabilities(lock, kitPolicy) {
  const locked = lock?.advancedCapabilities;
  if (!Array.isArray(locked) || !locked.length) throw new Error('tools.lock.json에 advancedCapabilities가 없다');
  const sortedLocked = [...locked].sort();
  if (kitPolicy && Object.hasOwn(kitPolicy, 'advancedCapabilities')) {
    const fromPolicy = Array.isArray(kitPolicy.advancedCapabilities) ? [...kitPolicy.advancedCapabilities].sort() : null;
    if (!fromPolicy || canonical(fromPolicy) !== canonical(sortedLocked)) {
      throw new Error('공개 정책의 advancedCapabilities와 tools.lock.json의 목록이 다르다');
    }
  }
  return sortedLocked;
}

const ARTIFACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'versions', 'registration'],
  properties: {
    kind: { enum: ['module', 'pack'] },
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,127}$' },
    versions: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['bytes', 'sha256', 'capabilities'],
        properties: {
          bytes: { type: 'integer', minimum: 1, maximum: LIMITS.moduleArchiveBytes },
          sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          capabilities: ITEM_SCHEMA.$defs.version.properties.capabilities,
        },
      },
    },
    registration: ITEM_SCHEMA.$defs.registration,
  },
  $defs: ITEM_SCHEMA.$defs,
};

export function buildArtifact({ kind, id, results, toolVersion, runId, at }) {
  return {
    kind,
    id,
    versions: Object.fromEntries(results.map((result) => [result.version, { bytes: result.bytes, sha256: result.sha256, capabilities: result.capabilities }])),
    registration: { toolVersion, runId: String(runId), at },
  };
}

// commit job이 검사 job의 artifact를 받아들이기 전의 검증. 하나라도 어기면 아무것도 쓰지 않는다.
export function validateArtifact(artifact, { kind, id, newVersions, runId, toolVersion }) {
  const errors = validateSchema(ARTIFACT_SCHEMA, artifact).map((message) => `artifact ${message}`);
  if (errors.length) return errors;
  if (artifact.kind !== kind || artifact.id !== id) errors.push('artifact의 항목이 PR 항목과 다르다');
  const expected = newVersions.map((entry) => entry.version).sort();
  const actual = Object.keys(artifact.versions).sort();
  if (canonical(expected) !== canonical(actual)) errors.push(`artifact 버전 집합(${actual.join(', ')})이 PR의 새 버전(${expected.join(', ')})과 다르다`);
  for (const entry of newVersions) {
    const fixed = artifact.versions[entry.version];
    if (!fixed) continue;
    if (canonical(fixed.capabilities) !== canonical(entry.capabilities)) errors.push(`${entry.version}: artifact capabilities가 PR 선언과 다르다`);
    const limit = kind === 'pack' ? LIMITS.packArchiveBytes : LIMITS.moduleArchiveBytes;
    if (fixed.bytes > limit) errors.push(`${entry.version}: bytes가 ${kind} 상한을 넘는다`);
  }
  if (artifact.registration.runId !== String(runId)) errors.push('artifact registration.runId가 이 실행과 다르다');
  if (toolVersion !== undefined && artifact.registration.toolVersion !== toolVersion) errors.push('artifact toolVersion이 tools.lock.json과 다르다');
  if (Number.isNaN(Date.parse(artifact.registration.at))) errors.push('artifact registration.at이 올바른 시각이 아니다');
  return errors;
}

// PR head의 item.json에 고정 값을 합친다. 다른 필드는 PR 그대로다.
export function mergeFixedValues(headItem, artifact) {
  const merged = structuredClone(headItem);
  for (const entry of merged.versions) {
    const fixed = artifact.versions[entry.version];
    if (!fixed) continue;
    entry.download = { url: entry.download.url, fileName: entry.download.fileName, bytes: fixed.bytes, sha256: fixed.sha256 };
    entry.registration = { ...artifact.registration };
  }
  return merged;
}

// commit 직전 `git status --porcelain` 경로 검사.
export function assertWritePaths(paths, dir) {
  const outside = paths.filter((path) => !path.startsWith(`${dir}/`));
  if (outside.length) throw new Error(`항목 폴더 밖 변경이 있어 commit하지 않는다: ${outside.join(', ')}`);
  if (!paths.length) throw new Error('바뀐 파일이 없다');
}
