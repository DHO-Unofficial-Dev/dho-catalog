// 임시 git 저장소로 등재 맥락을 검사한다: PR이 갈라진 뒤 main의 같은 항목이 바뀌면 거부.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { loadRegistrationContext } from '../scripts/lib/context.mjs';
import { ADVANCED, fixedModuleItem, folderFiles } from './helpers/fixtures.mjs';

const repo = mkdtempSync(join(tmpdir(), 'catalog-context-'));
const original = process.cwd();
after(() => {
  process.chdir(original);
  rmSync(repo, { recursive: true, force: true });
});

const git = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' }).trim();
const DIR = 'items/modules/dev.example.sample-tool';

function writeItem(item, readme = '# Sample\n') {
  for (const file of folderFiles(item)) {
    const path = join(repo, DIR, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.path === 'README.md' ? readme : file.bytes);
  }
}

function versionEntry(version) {
  return {
    version,
    releasedAt: '2026-11-17T00:00:00Z',
    compatibility: { minimumManagerVersion: '2.2.0' },
    capabilities: ['navigation.read', 'storage.local'],
    download: {
      url: `https://github.com/example-owner/sample-tool/releases/download/v${version}/sample-${version}.dho-module`,
      fileName: `sample-${version}.dho-module`,
      bytes: 10,
      sha256: 'a'.repeat(64),
    },
    registration: { toolVersion: 'v2.2.0', runId: '1', at: '2026-11-18T00:00:00Z' },
  };
}

git('init', '-q', '-b', 'main');
writeItem(fixedModuleItem({ versions: [versionEntry('1.0.1')] }));
git('add', '.');
git('commit', '-q', '-m', 'base');

// 오래된 PR: 1.0.1만 있는 상태에서 README만 고친다.
git('switch', '-q', '-c', 'stale');
writeItem(fixedModuleItem({ versions: [versionEntry('1.0.1')] }), '# Sample\n\n오타 수정\n');
git('commit', '-q', '-am', 'stale readme');
const staleSha = git('rev-parse', 'HEAD');

// 그 사이 main에 1.0.2가 등재된다.
git('switch', '-q', 'main');
writeItem(fixedModuleItem({ versions: [versionEntry('1.0.2'), versionEntry('1.0.1')] }));
git('commit', '-q', '-am', 'register 1.0.2');

// 최신 main 위의 PR
git('switch', '-q', '-c', 'fresh');
writeItem(fixedModuleItem({ versions: [versionEntry('1.0.2'), versionEntry('1.0.1')] }), '# Sample\n\n오타 수정\n');
git('commit', '-q', '-am', 'fresh readme');
const freshSha = git('rev-parse', 'HEAD');
git('switch', '-q', 'main');

test('PR이 갈라진 뒤 main의 같은 항목이 바뀌면 rebase를 요구한다', () => {
  process.chdir(repo);
  const context = loadRegistrationContext({ headSha: staleSha, advancedCapabilities: ADVANCED });
  assert.ok(context.errors.some((message) => message.includes('rebase')));
  // 승인 화면에는 되돌아가는 버전이 보인다.
  assert.deepEqual(context.changes.removedVersions, ['1.0.2']);
  assert.deepEqual(context.changes.modifiedFiles, ['README.md', 'item.json']);
});

test('최신 main 위의 PR은 통과하고 변경 요약에 README만 나온다', () => {
  process.chdir(repo);
  const context = loadRegistrationContext({ headSha: freshSha, advancedCapabilities: ADVANCED });
  assert.deepEqual(context.errors, []);
  assert.deepEqual(context.plan.newVersions, []);
  assert.deepEqual(context.changes.removedVersions, []);
  assert.deepEqual(context.changes.changedFields, []);
  assert.deepEqual(context.changes.modifiedFiles, ['README.md']);
});
