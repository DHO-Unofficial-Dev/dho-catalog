// catalog-base.json: 관리자가 PR로 바꾸는 목록 수준 값(schemaVersion, minimumManagerVersion, withdrawn).

import { CATALOG_SCHEMA, validateIsoTime } from './rules.mjs';
import { validateSchema } from './schema-lite.mjs';

const BASE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'minimumManagerVersion', 'withdrawn'],
  properties: {
    schemaVersion: CATALOG_SCHEMA.properties.schemaVersion,
    minimumManagerVersion: CATALOG_SCHEMA.properties.minimumManagerVersion,
    withdrawn: CATALOG_SCHEMA.properties.withdrawn,
  },
  $defs: CATALOG_SCHEMA.$defs,
};

export function checkBaseConfig(base) {
  const errors = validateSchema(BASE_SCHEMA, base);
  if (errors.length) return errors;
  const seen = new Set();
  for (const entry of base.withdrawn) {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) errors.push(`withdrawn ${key}가 중복된다`);
    seen.add(key);
    if (!validateIsoTime(entry.at)) errors.push(`withdrawn ${key}: at이 올바른 시각이 아니다`);
  }
  return errors;
}
