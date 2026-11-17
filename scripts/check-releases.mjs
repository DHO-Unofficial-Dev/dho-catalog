#!/usr/bin/env node
// register.yml: 새 버전의 Release가 공개 상태이고 draft·prerelease가 아닌지 GitHub API로 확인한다.
// 토큰(GH_TOKEN)은 이 step에만 넘긴다. 받은 archive를 다루거나 공개 도구를 실행하지 않는다.
//
// 사용: node scripts/check-releases.mjs --head-sha <sha> [--allow-repository-transfer]

import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadRegistrationContext } from './lib/context.mjs';
import { oneLine, resolveAdvancedCapabilities } from './lib/registration.mjs';
import { readJsonFile } from './lib/repo.mjs';

const { values } = parseArgs({
  options: {
    'head-sha': { type: 'string' },
    'allow-repository-transfer': { type: 'boolean', default: false },
  },
});
if (!values['head-sha']) {
  console.error('필수 인수: --head-sha');
  process.exit(1);
}

const advancedCapabilities = resolveAdvancedCapabilities(readJsonFile('tools.lock.json'), null);
const context = loadRegistrationContext({
  headSha: values['head-sha'],
  advancedCapabilities,
  allowRepositoryTransfer: values['allow-repository-transfer'],
});
const errors = [...context.errors];

if (!errors.length) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dho-catalog-register' };
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;
  for (const entry of context.plan.newVersions) {
    const tag = /\/releases\/download\/([^/]+)\//.exec(entry.download.url)[1];
    const response = await fetch(`https://api.github.com/repos/${context.head.item.repository}/releases/tags/${encodeURIComponent(tag)}`, { headers });
    if (response.status !== 200) {
      errors.push(`${entry.version}: 공개 Release ${tag}를 찾을 수 없다(${response.status})`);
      continue;
    }
    const release = await response.json();
    if (release.draft || release.prerelease) errors.push(`${entry.version}: draft·prerelease Release는 등재할 수 없다`);
  }
}

if (errors.length) {
  const text = `Release 확인 실패:\n- ${errors.map(oneLine).join('\n- ')}`;
  console.error(text);
  // rebase 필요 같은 문맥 오류도 소유자가 실행 요약에서 바로 보게 한다.
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${text}\n`);
  process.exit(2);
}
console.log(`Release 확인: 새 버전 ${context.plan.newVersions.length}개 모두 공개 Release`);
