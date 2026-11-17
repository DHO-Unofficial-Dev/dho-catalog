// 항목 폴더의 상세 자료(썸네일·스크린샷·README·CHANGES) 검사.
// 형식은 확장자가 아니라 매직 넘버로 판정하고, 크기·해상도 상한을 지킨다.

import { createHash } from 'node:crypto';
import { LIMITS } from './rules.mjs';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function imageInfo(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buffer.toString('latin1', 12, 16) === 'IHDR') {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 30 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('latin1', 12, 16);
    if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { format: 'webp', width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    }
    return null;
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { format: 'jpg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      if (marker === 0xda || marker === 0xd9) return null;
      offset += 2 + length;
    }
  }
  return null;
}

const FILE_PATTERNS = [
  { pattern: /^item\.json$/, role: 'item' },
  { pattern: /^thumbnail\.(png|webp)$/, role: 'thumbnail' },
  { pattern: /^screenshots\/([1-4])\.(png|webp|jpg)$/, role: 'screenshot' },
  { pattern: /^README\.md$/, role: 'readme' },
  { pattern: /^CHANGES\.md$/, role: 'changes' },
];

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// Markdown 안의 링크 대상. 인라인 `[..](url)`, 이미지 `![..](url)`, 참조 정의 `[x]: url`, 자동 링크 `<url>`.
export function markdownLinkTargets(text) {
  const targets = [];
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const match of withoutCode.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g)) targets.push(match[1]);
  for (const match of withoutCode.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) targets.push(match[1]);
  for (const match of withoutCode.matchAll(/<([a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*)>/g)) targets.push(match[1]);
  return targets;
}

export function checkMarkdown(text, label) {
  const errors = [];
  const warnings = [];
  for (const target of markdownLinkTargets(text)) {
    if (!/^https:\/\/[^\s]+$/.test(target)) errors.push(`${label}: 링크는 https 절대 주소만 쓸 수 있다: ${target.slice(0, 80)}`);
  }
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  if (/<\/?[a-zA-Z][^>]*>/.test(withoutCode.replace(/<[a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*>/g, ''))) {
    warnings.push(`${label}: 원문 HTML은 앱에서 표시하지 않는다`);
  }
  if (/!\[[^\]\n]*\]\(/.test(withoutCode)) warnings.push(`${label}: 본문 이미지는 앱에서 표시하지 않는다. 썸네일·스크린샷을 쓴다`);
  return { errors, warnings };
}

// files: [{ path: 항목 폴더 기준 상대 경로, bytes: Buffer }]
// 결과 media는 catalog.json의 media 형식(path는 저장소 기준)이다.
export function checkItemFolder(files, { kind, id }) {
  const errors = [];
  const warnings = [];
  const base = `items/${kind}s/${id}/`;
  const media = { thumbnail: null, screenshots: [], readme: null, changes: null };
  const screenshots = new Map();
  let itemBytes = null;
  for (const { path, bytes } of files) {
    const rule = FILE_PATTERNS.find(({ pattern }) => pattern.test(path));
    if (!rule) {
      errors.push(`허용하지 않는 파일: ${path} (item.json, thumbnail.png|webp, screenshots/1~4.png|webp|jpg, README.md, CHANGES.md만)`);
      continue;
    }
    const entry = { path: `${base}${path}`, bytes: bytes.length, sha256: sha256Hex(bytes) };
    if (rule.role === 'item') {
      itemBytes = bytes;
    } else if (rule.role === 'thumbnail') {
      if (media.thumbnail) errors.push('썸네일은 하나만 둘 수 있다');
      const info = imageInfo(bytes);
      const extension = path.split('.').pop();
      if (!info || info.format !== extension) errors.push(`${path}: 확장자와 실제 형식이 다르다`);
      else if (info.width < 1 || info.height < 1 || info.width > LIMITS.thumbnailDimension || info.height > LIMITS.thumbnailDimension) errors.push(`${path}: 해상도는 1024×1024 이하여야 한다`);
      if (bytes.length > LIMITS.thumbnailBytes) errors.push(`${path}: 512 KiB 이하여야 한다`);
      media.thumbnail = entry;
    } else if (rule.role === 'screenshot') {
      const number = Number(rule.pattern.exec(path)[1]);
      if (screenshots.has(number)) errors.push(`스크린샷 ${number}번이 둘 이상이다`);
      const info = imageInfo(bytes);
      const extension = path.split('.').pop();
      if (!info || info.format !== extension) errors.push(`${path}: 확장자와 실제 형식이 다르다`);
      else if (info.width < 1 || info.height < 1 || info.width > LIMITS.screenshotWidth || info.height > LIMITS.screenshotHeight) errors.push(`${path}: 해상도는 2560×1600 이하여야 한다`);
      if (bytes.length > LIMITS.screenshotBytes) errors.push(`${path}: 1 MiB 이하여야 한다`);
      screenshots.set(number, entry);
    } else {
      const limit = rule.role === 'readme' ? LIMITS.readmeBytes : LIMITS.changesBytes;
      if (bytes.length === 0) errors.push(`${path}: 비어 있다`);
      if (bytes.length > limit) errors.push(`${path}: ${limit / 1024} KiB 이하여야 한다`);
      const text = decodeText(bytes);
      if (text === null) {
        errors.push(`${path}: UTF-8이 아니다`);
      } else {
        const result = checkMarkdown(text, path);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      }
      media[rule.role] = entry;
    }
  }
  const numbers = [...screenshots.keys()].sort((a, b) => a - b);
  numbers.forEach((number, index) => {
    if (number !== index + 1) errors.push('스크린샷 번호는 1부터 빈틈없이 이어져야 한다');
  });
  media.screenshots = numbers.map((number) => screenshots.get(number));
  if (!itemBytes) errors.push('item.json이 없다');
  if (!media.readme) errors.push('README.md가 없다');
  return { errors: [...new Set(errors)], warnings, media, itemBytes };
}
