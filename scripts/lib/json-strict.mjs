// 중복 키와 깊이를 검사하는 엄격한 JSON 파서.
// JSON.parse는 중복 키의 마지막 값만 남기므로 등재·목록 검증에는 쓰지 않는다.

export class StrictJsonError extends Error {}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

export function parseStrictJson(text, { maxDepth = 16 } = {}) {
  if (typeof text !== 'string') {
    text = decodeUtf8(text);
  }
  let index = 0;

  const fail = (message) => {
    throw new StrictJsonError(`${message} (위치 ${index})`);
  };
  const skip = () => {
    while (index < text.length && WHITESPACE.has(text.charCodeAt(index))) index += 1;
  };

  const parseString = () => {
    // 시작 따옴표 위치에서 호출된다.
    let end = index + 1;
    let escaped = false;
    for (; end < text.length; end += 1) {
      const code = text.charCodeAt(end);
      if (escaped) {
        escaped = false;
      } else if (code === 0x5c) {
        escaped = true;
      } else if (code === 0x22) {
        break;
      } else if (code < 0x20) {
        fail('문자열 안의 제어 문자');
      }
    }
    if (end >= text.length) fail('닫히지 않은 문자열');
    const raw = text.slice(index, end + 1);
    index = end + 1;
    try {
      return JSON.parse(raw);
    } catch {
      return fail('잘못된 문자열 escape');
    }
  };

  const parseValue = (depth) => {
    skip();
    const char = text[index];
    if (char === '{' || char === '[') {
      if (depth + 1 > maxDepth) fail(`깊이 ${maxDepth} 초과`);
    }
    if (char === '{') {
      index += 1;
      const result = {};
      const seen = new Set();
      skip();
      if (text[index] === '}') {
        index += 1;
        return result;
      }
      for (;;) {
        skip();
        if (text[index] !== '"') fail('키는 문자열이어야 한다');
        const key = parseString();
        if (seen.has(key)) fail(`중복 키 "${key}"`);
        seen.add(key);
        skip();
        if (text[index] !== ':') fail('":" 필요');
        index += 1;
        const value = parseValue(depth + 1);
        Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
        skip();
        if (text[index] === ',') {
          index += 1;
          continue;
        }
        if (text[index] === '}') {
          index += 1;
          return result;
        }
        fail('"," 또는 "}" 필요');
      }
    }
    if (char === '[') {
      index += 1;
      const result = [];
      skip();
      if (text[index] === ']') {
        index += 1;
        return result;
      }
      for (;;) {
        result.push(parseValue(depth + 1));
        skip();
        if (text[index] === ',') {
          index += 1;
          continue;
        }
        if (text[index] === ']') {
          index += 1;
          return result;
        }
        fail('"," 또는 "]" 필요');
      }
    }
    if (char === '"') return parseString();
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index, index + 64));
    if (!literal) fail('알 수 없는 값');
    index += literal[0].length;
    return JSON.parse(literal[0]);
  };

  const value = parseValue(0);
  skip();
  if (index !== text.length) fail('값 뒤에 남은 문자');
  return value;
}

export function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new StrictJsonError('UTF-8이 아니다');
  }
}

export function jsonDepth(value) {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(jsonDepth));
  if (value && typeof value === 'object') return 1 + Math.max(0, ...Object.values(value).map(jsonDepth));
  return 0;
}
