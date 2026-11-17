// workflow 정적 검사: runner 종류, 트리거, 권한, job 분리, action 고정.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const workflows = Object.fromEntries(
  readdirSync(DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, readFileSync(join(DIR, name), 'utf8')]),
);

// 들여쓰기 기준으로 jobs 아래 job 블록을 나눈다.
function jobs(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('jobs:');
  const result = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (match) {
      current = match[1];
      result[current] = [];
    } else if (current) {
      result[current].push(line);
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.join('\n')]));
}

test('workflow는 세 개다', () => {
  assert.deepEqual(Object.keys(workflows).sort(), ['pr-lint.yml', 'publish.yml', 'register.yml']);
});

test('모든 job은 GitHub 호스팅 ubuntu-latest만 쓴다', () => {
  for (const [name, text] of Object.entries(workflows)) {
    assert.doesNotMatch(text, /self-hosted/i, name);
    assert.doesNotMatch(text, /dho-local/i, name);
    const runsOn = [...text.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((match) => match[1].trim());
    assert.ok(runsOn.length > 0, name);
    for (const value of runsOn) assert.equal(value, 'ubuntu-latest', name);
    for (const [job, body] of Object.entries(jobs(text))) assert.match(body, /^\s{4}runs-on: ubuntu-latest$/m, `${name} ${job}`);
  }
});

test('pull_request_target과 workflow_call을 쓰지 않는다', () => {
  for (const [name, text] of Object.entries(workflows)) {
    assert.doesNotMatch(text, /pull_request_target/, name);
    assert.doesNotMatch(text, /workflow_call/, name);
  }
});

test('최상위 권한은 명시하고, 쓰기 권한은 필요한 job에만 둔다', () => {
  for (const [name, text] of Object.entries(workflows)) {
    assert.match(text, /^permissions:/m, name);
  }
  assert.match(workflows['register.yml'], /^permissions: \{\}$/m);
  assert.match(workflows['publish.yml'], /^permissions: \{\}$/m);
  assert.match(workflows['pr-lint.yml'], /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflows['pr-lint.yml'], /write/);
  assert.doesNotMatch(workflows['pr-lint.yml'], /secrets\./);
});

test('action은 commit SHA로 고정한다', () => {
  for (const [name, text] of Object.entries(workflows)) {
    for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
      assert.match(match[1], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${name}: ${match[1]}`);
    }
  }
});

test('register: dispatch 입력, 직렬화, 검사 job과 승인 commit job 분리', () => {
  const text = workflows['register.yml'];
  assert.match(text, /^on:\n {2}workflow_dispatch:/m);
  assert.match(text, /^ {6}pr:$/m);
  assert.match(text, /^ {6}headSha:$/m);
  assert.match(text, /^ {6}allowRepositoryTransfer:$/m);
  assert.match(text, /^concurrency:\n {2}group: catalog-register\n {2}cancel-in-progress: false$/m);
  const { inspect, commit } = jobs(text);
  assert.ok(inspect && commit);
  assert.doesNotMatch(inspect, /environment:/);
  assert.doesNotMatch(inspect, /write/);
  assert.doesNotMatch(inspect, /secrets\./);
  assert.match(inspect, /persist-credentials: false/);
  assert.match(commit, /^ {4}environment: catalog-register$/m);
  assert.match(commit, /^ {4}needs: inspect$/m);
  assert.match(commit, /secrets\.CATALOG_APP_PRIVATE_KEY/);
  // 입력값은 env로만 넘기고 run 안에서 직접 펼치지 않는다.
  const inputLines = text.split('\n').filter((line) => /\$\{\{\s*inputs\./.test(line));
  for (const line of inputLines) assert.match(line.trim(), /^(PR|HEAD_SHA|ALLOW_TRANSFER): \$\{\{ inputs\.\w+ \}\}$/, line);
});

test('publish: main push 하나, 직렬화, 생성 job만 contents: write', () => {
  const text = workflows['publish.yml'];
  assert.match(text, /^on:\n {2}push:\n {4}branches: \[main\]/m);
  assert.doesNotMatch(text, /workflow_dispatch|schedule|pull_request/);
  assert.match(text, /^concurrency:\n {2}group: catalog-publish\n {2}cancel-in-progress: false$/m);
  assert.deepEqual(Object.keys(jobs(text)), ['publish']);
  assert.match(text, /^ {6}contents: write$/m);
});

test('pr-lint: pull_request로만 돈다', () => {
  assert.match(workflows['pr-lint.yml'], /^on:\n {2}pull_request:/m);
});
