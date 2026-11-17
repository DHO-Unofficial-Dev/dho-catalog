// register.yml 각 단계가 공통으로 쓰는 등재 맥락: 범위, PR 항목 폴더(데이터), main 항목, 등재 계획, 변경 요약.
// 작업 트리(HEAD)는 신뢰된 main checkout이어야 한다.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assessItemFolder } from './catalog.mjs';
import { assertCommit, changedPathsSince, folderChangedSince, mergeBase, readFolderAtCommit } from './git.mjs';
import { describeChanges, planRegistration, scopeFromChangedPaths } from './registration.mjs';
import { readFolderFiles, readJsonFile } from './repo.mjs';

export function loadRegistrationContext({ headSha, advancedCapabilities, allowRepositoryTransfer = false }) {
  assertCommit(headSha);
  const base = mergeBase('HEAD', headSha);
  const scope = scopeFromChangedPaths(changedPathsSince(base, headSha));
  const errors = [];
  // PR이 갈라진 뒤 main의 같은 항목이 바뀌었으면, PR 폴더로 덮어쓸 때 main의 변경(새 버전 등)이 조용히 되돌아간다.
  if (folderChangedSince(base, scope.dir)) {
    errors.push('PR이 갈라진 뒤 main의 이 항목 폴더가 바뀌었다. 최신 main으로 rebase한 뒤 다시 신청한다');
  }
  const headFiles = readFolderAtCommit(headSha, scope.dir);
  const head = assessItemFolder({ kind: scope.kind, id: scope.id, files: headFiles }, { advancedCapabilities });
  errors.push(...head.errors);
  const mainFiles = existsSync(scope.dir) ? readFolderFiles(scope.dir) : [];
  const mainItemPath = join(scope.dir, 'item.json');
  const mainItem = existsSync(mainItemPath) ? readJsonFile(mainItemPath) : null;
  let plan = { errors: [], newVersions: [] };
  if (head.item && !head.errors.length) {
    plan = planRegistration({ mainItem, headItem: head.item, allowRepositoryTransfer });
    errors.push(...plan.errors);
  }
  const changes = head.item ? describeChanges({ mainItem, headItem: head.item, mainFiles, headFiles }) : null;
  return { scope, headFiles, head, mainItem, plan, changes, errors };
}
