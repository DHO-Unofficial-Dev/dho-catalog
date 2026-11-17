// 등재 workflow가 PR commit을 데이터로만 읽기 위한 git 도우미. 작업 트리에 PR 파일을 checkout하지 않는다.

import { execFileSync } from 'node:child_process';
import { checkTreeEntries } from './registration.mjs';

export function git(args, { cwd = process.cwd(), encoding = 'utf8' } = {}) {
  return execFileSync('git', args, { cwd, encoding, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function assertCommit(sha, options) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('headSha는 40자 소문자 hex여야 한다');
  git(['cat-file', '-e', `${sha}^{commit}`], options);
}

// PR이 main에서 갈라진 뒤 바꾼 경로(삭제 포함).
export function changedPaths(baseRef, headSha, options) {
  const mergeBase = git(['merge-base', baseRef, headSha], options).trim();
  const output = git(['diff', '--name-only', '--no-renames', '-z', mergeBase, headSha], options);
  return output.split('\0').filter(Boolean);
}

export function readFolderAtCommit(sha, dir, options) {
  const lines = git(['ls-tree', '-r', '--full-tree', sha, '--', `${dir}/`], options).split('\n');
  const entries = checkTreeEntries(lines, dir);
  return entries.map(({ path, object }) => ({ path, bytes: git(['cat-file', 'blob', object], { ...options, encoding: 'buffer' }) }));
}

export function porcelainPaths(options) {
  const output = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], options);
  return output
    .split('\0')
    .filter(Boolean)
    .map((line) => line.slice(3));
}
