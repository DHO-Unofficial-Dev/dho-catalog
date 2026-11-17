#!/usr/bin/env node
// register.yml commit job. 검사 job의 출력은 신뢰하지 않는다.
// 항목 폴더는 PR commit에서 직접 다시 꺼내고, artifact에서는 schema로 검증한 고정 값만 받는다.
// 새 버전마다 같은 주소를 한 번 더 받아 크기·해시가 artifact와 같은지만 확인한다(새 고정 값은 만들지 않는다).
// 도구·PR 코드는 실행하지 않는다. 작업 트리의 항목 폴더만 바꾸고, commit 메시지를 파일로 남긴다.
//
// 사용: node scripts/register-commit.mjs --head-sha <sha> --artifact <artifact.json> --run-id <id>
//       --message-out <파일> [--allow-repository-transfer]

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { assessItemFolder } from './lib/catalog.mjs';
import { downloadReleaseAsset } from './lib/download.mjs';
import { assertCommit, changedPaths, porcelainPaths, readFolderAtCommit } from './lib/git.mjs';
import { parseStrictJson } from './lib/json-strict.mjs';
import { sha256Hex } from './lib/media.mjs';
import {
  assertWritePaths,
  mergeFixedValues,
  planRegistration,
  resolveAdvancedCapabilities,
  scopeFromChangedPaths,
  validateArtifact,
} from './lib/registration.mjs';
import { readJsonFile } from './lib/repo.mjs';
import { LIMITS, validateItemDocument } from './lib/rules.mjs';

const { values } = parseArgs({
  options: {
    'head-sha': { type: 'string' },
    artifact: { type: 'string' },
    'run-id': { type: 'string' },
    'message-out': { type: 'string' },
    'allow-repository-transfer': { type: 'boolean', default: false },
  },
});
const headSha = values['head-sha'];
const runId = values['run-id'];
if (!headSha || !values.artifact || !runId || !values['message-out']) {
  console.error('필수 인수: --head-sha --artifact --run-id --message-out');
  process.exit(1);
}
const fail = (messages) => {
  console.error(`commit하지 않는다:\n- ${messages.join('\n- ')}`);
  process.exit(2);
};

const lock = readJsonFile('tools.lock.json');
const advancedCapabilities = resolveAdvancedCapabilities(lock, null);

assertCommit(headSha);
const scope = scopeFromChangedPaths(changedPaths('HEAD', headSha));
const headFiles = readFolderAtCommit(headSha, scope.dir);
const head = assessItemFolder({ kind: scope.kind, id: scope.id, files: headFiles }, { advancedCapabilities });
if (head.errors.length) fail(head.errors);
const mainItemPath = join(scope.dir, 'item.json');
const mainItem = existsSync(mainItemPath) ? readJsonFile(mainItemPath) : null;
const plan = planRegistration({ mainItem, headItem: head.item, allowRepositoryTransfer: values['allow-repository-transfer'] });
if (plan.errors.length) fail(plan.errors);

let artifact;
try {
  artifact = parseStrictJson(readFileSync(values.artifact), { maxDepth: 8 });
} catch (error) {
  fail([`artifact를 읽을 수 없다: ${error.message}`]);
}
const artifactErrors = validateArtifact(artifact, { kind: scope.kind, id: scope.id, newVersions: plan.newVersions, runId, toolVersion: lock.toolVersion });
if (artifactErrors.length) fail(artifactErrors);

// 검사 job 출력 위조 방어: 같은 주소를 다시 받아 확인만 한다.
const maxBytes = scope.kind === 'pack' ? LIMITS.packArchiveBytes : LIMITS.moduleArchiveBytes;
const recheck = [];
for (const entry of plan.newVersions) {
  const { bytes } = await downloadReleaseAsset(entry.download.url, { maxBytes });
  const fixed = artifact.versions[entry.version];
  if (bytes.length !== fixed.bytes || sha256Hex(bytes) !== fixed.sha256) recheck.push(`${entry.version}: 다시 받은 파일이 검사 결과와 다르다`);
}
if (recheck.length) fail(recheck);

const merged = mergeFixedValues(head.item, artifact);
const mergedErrors = validateItemDocument(merged, { advancedCapabilities, requireFixed: true });
if (mergedErrors.length) fail(mergedErrors);

// 항목 폴더를 PR commit 그대로 바꾼다(삭제 포함). item.json만 고정 값을 합친 내용으로 쓴다.
rmSync(scope.dir, { recursive: true, force: true });
for (const file of headFiles) {
  const path = join(scope.dir, ...file.path.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.path === 'item.json' ? `${JSON.stringify(merged, null, 2)}\n` : file.bytes);
}
assertWritePaths(porcelainPaths(), scope.dir);

const versions = Object.keys(artifact.versions);
const lines = [
  versions.length ? `catalog: ${scope.kind} ${scope.id} ${versions.join(', ')} 등재` : `catalog: ${scope.kind} ${scope.id} 소개 갱신`,
  '',
  `PR commit: ${headSha}`,
  `등재 실행: ${artifact.registration.runId}, 도구 ${artifact.registration.toolVersion}, ${artifact.registration.at}`,
  ...versions.map((version) => `- ${version}: ${artifact.versions[version].bytes} byte, sha256 ${artifact.versions[version].sha256}`),
];
writeFileSync(values['message-out'], `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
