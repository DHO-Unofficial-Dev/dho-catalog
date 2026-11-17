// 저장소 작업 트리에서 항목 폴더와 설정 파일을 읽는다. 파일은 데이터로만 읽는다.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStrictJson } from './json-strict.mjs';
import { DIR_KINDS } from './rules.mjs';

export function readJsonFile(path) {
  return parseStrictJson(readFileSync(path), { maxDepth: 16 });
}

export function readFolderFiles(dir, prefix = '') {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`심볼릭 링크는 허용하지 않는다: ${relative}`);
    if (stat.isDirectory()) files.push(...readFolderFiles(full, relative));
    else if (stat.isFile()) files.push({ path: relative, bytes: readFileSync(full) });
    else throw new Error(`일반 파일이 아니다: ${relative}`);
  }
  return files;
}

// items/<modules|packs>/<id>/ 목록. 그 밖의 항목은 오류로 알린다.
export function listItemFolders(root) {
  const itemsDir = join(root, 'items');
  const folders = [];
  const errors = [];
  let kindDirs = [];
  try {
    kindDirs = readdirSync(itemsDir).sort();
  } catch {
    return { folders, errors };
  }
  for (const kindDir of kindDirs) {
    const kind = DIR_KINDS[kindDir];
    const full = join(itemsDir, kindDir);
    if (!kind || !lstatSync(full).isDirectory()) {
      if (kindDir !== '.gitkeep') errors.push(`items/${kindDir}: items 아래에는 modules/와 packs/만 둔다`);
      continue;
    }
    for (const id of readdirSync(full).sort()) {
      const dir = join(full, id);
      if (id === '.gitkeep') continue;
      if (!lstatSync(dir).isDirectory()) {
        errors.push(`items/${kindDir}/${id}: 항목은 폴더여야 한다`);
        continue;
      }
      folders.push({ kind, id, dir, path: `items/${kindDir}/${id}` });
    }
  }
  return { folders, errors };
}
