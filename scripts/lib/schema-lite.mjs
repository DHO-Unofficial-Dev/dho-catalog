// 이 저장소의 schema가 쓰는 JSON Schema(draft 2020-12) 부분 집합만 해석하는 검증기.
// 모르는 키워드가 schema에 있으면 조용히 무시하지 않고 오류로 멈춘다.

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', '$defs', 'examples']);
const KEYWORDS = new Set([
  '$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
  'allOf', 'anyOf', 'oneOf', 'not',
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`지원하지 않는 $ref: ${ref}`);
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  if (node === undefined) throw new Error(`찾을 수 없는 $ref: ${ref}`);
  return node;
}

function codePointLength(value) {
  return [...value].length;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateSchema(rootSchema, value) {
  const errors = [];
  const visit = (schema, data, path) => {
    if (schema === true) return;
    if (schema === false) {
      errors.push(`${path}: 허용되지 않는 값`);
      return;
    }
    for (const key of Object.keys(schema)) {
      if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) throw new Error(`지원하지 않는 schema 키워드: ${key}`);
    }
    if (schema.$ref) visit(resolveRef(rootSchema, schema.$ref), data, path);
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => matchesType(data, type))) {
        errors.push(`${path}: 형식은 ${types.join('|')}이어야 한다`);
        return;
      }
    }
    if ('const' in schema && canonical(schema.const) !== canonical(data)) errors.push(`${path}: 값은 ${JSON.stringify(schema.const)}이어야 한다`);
    if (schema.enum && !schema.enum.some((item) => canonical(item) === canonical(data))) {
      errors.push(`${path}: 허용 값 ${JSON.stringify(schema.enum)} 밖`);
    }
    if (typeof data === 'string') {
      const length = codePointLength(data);
      if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${path}: ${schema.minLength}자 이상이어야 한다`);
      if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${path}: ${schema.maxLength}자 이하여야 한다`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) errors.push(`${path}: 형식이 맞지 않는다`);
    }
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${path}: ${schema.minimum} 이상이어야 한다`);
      if (schema.maximum !== undefined && data > schema.maximum) errors.push(`${path}: ${schema.maximum} 이하여야 한다`);
    }
    if (Array.isArray(data)) {
      if (schema.minItems !== undefined && data.length < schema.minItems) errors.push(`${path}: 항목 ${schema.minItems}개 이상이어야 한다`);
      if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push(`${path}: 항목 ${schema.maxItems}개 이하여야 한다`);
      if (schema.uniqueItems && new Set(data.map(canonical)).size !== data.length) errors.push(`${path}: 중복 항목`);
      if (schema.items !== undefined) data.forEach((item, index) => visit(schema.items, item, `${path}[${index}]`));
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(data, key)) errors.push(`${path}: 필수 필드 ${key} 없음`);
      }
      const properties = schema.properties ?? {};
      for (const [key, child] of Object.entries(data)) {
        if (Object.hasOwn(properties, key)) {
          visit(properties[key], child, `${path}.${key}`);
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}: 모르는 필드 ${key}`);
        } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          visit(schema.additionalProperties, child, `${path}.${key}`);
        }
      }
    }
    const sub = (child) => {
      const before = errors.length;
      visit(child, data, path);
      const failed = errors.length > before;
      errors.length = before;
      return !failed;
    };
    for (const child of schema.allOf ?? []) visit(child, data, path);
    if (schema.anyOf && !schema.anyOf.some(sub)) errors.push(`${path}: 어느 형식에도 맞지 않는다`);
    if (schema.oneOf && schema.oneOf.filter(sub).length !== 1) errors.push(`${path}: 정확히 한 형식에 맞아야 한다`);
    if (schema.not && sub(schema.not)) errors.push(`${path}: 금지된 형식`);
  };
  visit(rootSchema, value, '$');
  return errors;
}
