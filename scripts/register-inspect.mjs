#!/usr/bin/env node
// register.yml 검사 job. PR commit의 항목 폴더를 데이터로 읽고, 새 버전마다 Release 자산을 한 번 받아
// 같은 byte로 공개 도구 검사·manifest 대조·해시 계산을 한다. 출력은 고정 값 artifact와 job summary뿐이다.
// 이 step에는 토큰을 넘기지 않는다(Release 상태 확인은 check-releases.mjs가 따로 한다).
//
// 사용: node scripts/register-inspect.mjs --head-sha <sha> --tools <키트 폴더> --run-id <id> --out <artifact.json>
//       --pr-author <login> [--allow-repository-transfer]

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadRegistrationContext } from './lib/context.mjs';
import { downloadReleaseAsset } from './lib/download.mjs';
import { parseStrictJson } from './lib/json-strict.mjs';
import { sha256Hex } from './lib/media.mjs';
import {
  buildArtifact,
  changesMarkdown,
  checkArchiveManifest,
  checkCompanionSha,
  codeSpan,
  oneLine,
  ownerMismatch,
  parseToolResult,
  resolveAdvancedCapabilities,
} from './lib/registration.mjs';
import { readJsonFile } from './lib/repo.mjs';
import { LIMITS } from './lib/rules.mjs';
import { readZip } from './lib/zip.mjs';

const { values } = parseArgs({
  options: {
    'head-sha': { type: 'string' },
    tools: { type: 'string' },
    'run-id': { type: 'string' },
    out: { type: 'string' },
    'pr-author': { type: 'string' },
    'allow-repository-transfer': { type: 'boolean', default: false },
  },
});
const headSha = values['head-sha'];
const runId = values['run-id'];
const prAuthor = values['pr-author'];
if (!headSha || !values.tools || !runId || !values.out || !prAuthor) {
  console.error('필수 인수: --head-sha --tools --run-id --out --pr-author');
  process.exit(1);
}

const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  console.log(text);
};
const fail = (messages) => {
  summary(`### 등재 검사 실패\n\n${messages.map((message) => `- ${oneLine(message)}`).join('\n')}`);
  process.exit(2);
};

const lock = readJsonFile('tools.lock.json');
const kitPolicyPath = join(values.tools, 'module', 'policy', 'module-policy-v1.json');
const kitPolicy = existsSync(kitPolicyPath) ? parseStrictJson(readFileSync(kitPolicyPath), { maxDepth: 32 }) : null;
const advancedCapabilities = resolveAdvancedCapabilities(lock, kitPolicy);

// 1·2. 범위, main 대비 갱신 여부, 소유 잠금
const context = loadRegistrationContext({ headSha, advancedCapabilities, allowRepositoryTransfer: values['allow-repository-transfer'] });
if (context.changes) summary(changesMarkdown(context.changes));
if (context.errors.length) fail(context.errors);
const { scope, head, plan } = context;
for (const warning of head.warnings) summary(`- 경고: ${oneLine(warning)}`);

const workDir = mkdtempSync(join(tmpdir(), 'catalog-register-'));
const results = [];
const errors = [];
try {
  for (const entry of plan.newVersions) {
    const where = `${entry.version}`;
    // 3. 한 번 받기. 아래 검사는 모두 이 byte로 한다.
    const maxBytes = scope.kind === 'pack' ? LIMITS.packArchiveBytes : LIMITS.moduleArchiveBytes;
    const { bytes } = await downloadReleaseAsset(entry.download.url, { maxBytes });
    const sha256 = sha256Hex(bytes);
    const companion = await downloadReleaseAsset(`${entry.download.url}.sha256`, { maxBytes: 4096, allowMissing: true });
    if (companion.status === 'missing') summary(`- 경고: ${where}: ${entry.download.fileName}.sha256 동반 자산이 없다`);
    else if (!checkCompanionSha(companion.bytes.toString('utf8'), sha256)) errors.push(`${where}: .sha256 동반 자산 값이 받은 파일과 다르다`);

    // 4. 공개 도구 검사. archive는 압축 해제·검사만 하고 실행하지 않는다.
    const archivePath = join(workDir, entry.download.fileName);
    writeFileSync(archivePath, bytes);
    const toolPath =
      scope.kind === 'module' ? join(values.tools, 'module', 'tools', 'verify-module.mjs') : join(values.tools, 'pack', 'tools', 'verify-archive.mjs');
    const run = spawnSync(process.execPath, [toolPath, archivePath], {
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
      cwd: workDir,
      env: { PATH: process.env.PATH ?? '' },
    });
    const tool = parseToolResult(run.stdout ?? '', run.status);
    if (!tool.valid) {
      const detail = parseToolResult(run.stderr ?? '', 0).result ?? { exit: run.status, error: run.error?.message };
      errors.push(`${where}: 공개 도구 검사 실패 ${codeSpan(JSON.stringify(detail), 300)}`);
      continue;
    }

    // archive manifest 대조와 팩 추가 조건
    let manifest = null;
    let zip = null;
    try {
      zip = readZip(bytes);
      manifest = parseStrictJson(zip.read('manifest.json') ?? Buffer.alloc(0), { maxDepth: 64 });
    } catch (error) {
      errors.push(`${where}: archive manifest를 읽을 수 없다: ${codeSpan(error.message)}`);
      continue;
    }
    const mismatch = checkArchiveManifest({ kind: scope.kind, item: head.item, entry, manifest, readArchiveFile: (name) => zip.read(name) });
    errors.push(...mismatch.map((message) => `${where}: ${message}`));
    results.push({ version: entry.version, bytes: bytes.length, sha256, capabilities: entry.capabilities });
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
if (errors.length) fail(errors);

const artifact = buildArtifact({
  kind: scope.kind,
  id: scope.id,
  results,
  toolVersion: lock.toolVersion,
  runId,
  at: new Date().toISOString(),
});
writeFileSync(values.out, `${JSON.stringify(artifact, null, 2)}\n`);

summary(`\n### 등재 검사 통과: ${scope.kind} ${codeSpan(scope.id)}\n`);
summary(`- PR commit ${codeSpan(headSha)}, 도구 ${codeSpan(lock.toolVersion)}, 실행 ${codeSpan(runId)}`);
summary(`- PR 작성자 ${codeSpan(prAuthor)}, repository ${codeSpan(head.item.repository)}`);
if (ownerMismatch(prAuthor, head.item.repository)) {
  summary('- **경고: PR 작성자가 repository owner와 다르다. 제작자 본인의 요청인지 확인한다.**');
}
summary('');
if (results.length) {
  summary('| 버전 | 크기(byte) | SHA-256 | capabilities |');
  summary('| --- | ---: | --- | --- |');
  for (const result of results) {
    summary(`| ${codeSpan(result.version)} | ${result.bytes} | ${codeSpan(result.sha256)} | ${codeSpan(result.capabilities.join(', ') || '(없음)', 400)} |`);
  }
} else {
  summary('새로 고정할 버전이 없다(소개 정보·자료만 바뀐다).');
}
summary('\n위 값과 main 대비 변경이 맞으면 commit job의 `catalog-register` 승인으로 고정한다.');
