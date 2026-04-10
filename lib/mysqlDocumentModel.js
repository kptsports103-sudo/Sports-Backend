const crypto = require('crypto');

const { pool } = require('../src/config/mysql');
const { createObjectId } = require('./objectId');

const LEGACY_DOCUMENT_TABLE = process.env.MYSQL_DOCUMENT_TABLE || 'app_documents';
const TABLE_PREFIX = process.env.MYSQL_TABLE_PREFIX || 'kpt_';
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;

const tableInitPromises = new Map();

const isPlainObject = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof RegExp);

const clone = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const resolveDefaultValue = (value) => {
  if (typeof value === 'function') return value();
  if (Array.isArray(value)) return value.map((entry) => resolveDefaultValue(entry));
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((acc, [key, nested]) => {
      acc[key] = resolveDefaultValue(nested);
      return acc;
    }, {});
  }
  if (value instanceof Date) return value.toISOString();
  return clone(value);
};

const mergeWithDefaults = (input, defaults) => {
  const result = isPlainObject(input) ? clone(input) : {};

  Object.entries(defaults || {}).forEach(([key, defaultValue]) => {
    if (result[key] === undefined) {
      result[key] = resolveDefaultValue(defaultValue);
      return;
    }

    if (isPlainObject(result[key]) && isPlainObject(defaultValue)) {
      result[key] = mergeWithDefaults(result[key], defaultValue);
    }
  });

  return result;
};

const stripInternalFields = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => stripInternalFields(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce((acc, [key, entry]) => {
    if (key === '__persisted') return acc;
    acc[key] = stripInternalFields(entry);
    return acc;
  }, {});
};

const toIsoString = (value, fallback = new Date()) => {
  const date = value instanceof Date ? value : new Date(value || fallback);
  if (Number.isNaN(date.getTime())) {
    return fallback.toISOString();
  }
  return date.toISOString();
};

const toDateValue = (value) => {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildRegex = (pattern, options = '') => {
  if (pattern instanceof RegExp) return pattern;

  try {
    return new RegExp(String(pattern || ''), String(options || ''));
  } catch (error) {
    return null;
  }
};

const parseJsonValue = (value) => {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    return JSON.parse(value);
  }
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8');
    return text ? JSON.parse(text) : null;
  }
  return value;
};

const getPathValues = (source, path) => {
  const parts = Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean);

  if (parts.length === 0) {
    return [source];
  }

  const walk = (current, index) => {
    if (index >= parts.length) return [current];
    if (Array.isArray(current)) {
      return current.flatMap((entry) => walk(entry, index));
    }
    if (!current || typeof current !== 'object') {
      return [undefined];
    }
    return walk(current[parts[index]], index + 1);
  };

  return walk(source, 0);
};

const getPathValue = (source, path) => getPathValues(source, path)[0];

const setPathValue = (target, path, value) => {
  const parts = String(path || '').split('.').filter(Boolean);
  if (parts.length === 0) return;

  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }

    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  });
};

const normalizeComparable = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (ISO_DATE_REGEX.test(trimmed)) {
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return trimmed;
  }
  if (value == null) return value;
  return JSON.stringify(value);
};

const valuesEqual = (left, right) => {
  if (left instanceof RegExp || right instanceof RegExp) return false;
  return JSON.stringify(left) === JSON.stringify(right);
};

const matchOperatorCondition = (values, operator, operand) => {
  const safeValues = values.length ? values : [undefined];

  if (operator === '$ne') {
    return safeValues.every((value) => !valuesEqual(value, operand));
  }

  if (operator === '$in') {
    return safeValues.some((value) => (operand || []).some((entry) => valuesEqual(value, entry)));
  }

  if (operator === '$nin') {
    return safeValues.every((value) => !(operand || []).some((entry) => valuesEqual(value, entry)));
  }

  if (operator === '$gte') {
    return safeValues.some((value) => normalizeComparable(value) >= normalizeComparable(operand));
  }

  if (operator === '$lte') {
    return safeValues.some((value) => normalizeComparable(value) <= normalizeComparable(operand));
  }

  if (operator === '$gt') {
    return safeValues.some((value) => normalizeComparable(value) > normalizeComparable(operand));
  }

  if (operator === '$lt') {
    return safeValues.some((value) => normalizeComparable(value) < normalizeComparable(operand));
  }

  if (operator === '$regex') {
    const regex = buildRegex(operand);
    if (!regex) return false;
    return safeValues.some((value) => regex.test(String(value || '')));
  }

  if (operator === '$options') {
    return true;
  }

  return safeValues.some((value) => valuesEqual(value, operand));
};

const isOperatorObject = (value) =>
  isPlainObject(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => key.startsWith('$'));

const matchFieldCondition = (document, field, condition) => {
  const values = getPathValues(document, field).filter((value) => value !== undefined);

  if (condition instanceof RegExp) {
    return values.some((value) => condition.test(String(value || '')));
  }

  if (isOperatorObject(condition)) {
    if (Object.prototype.hasOwnProperty.call(condition, '$regex')) {
      const regex = buildRegex(condition.$regex, condition.$options);
      if (!regex) return false;

      const regexMatched = values.some((value) => regex.test(String(value || '')));
      if (!regexMatched) return false;

      return Object.entries(condition)
        .filter(([operator]) => operator !== '$regex' && operator !== '$options')
        .every(([operator, operand]) => matchOperatorCondition(values, operator, operand));
    }

    return Object.entries(condition).every(([operator, operand]) =>
      matchOperatorCondition(values, operator, operand)
    );
  }

  if (isPlainObject(condition)) {
    return values.some((value) => valuesEqual(value, condition));
  }

  return values.some((value) => valuesEqual(value, condition));
};

const matchDocument = (document, filter = {}) => {
  if (!filter || Object.keys(filter).length === 0) return true;

  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') {
      return Array.isArray(value) && value.some((entry) => matchDocument(document, entry));
    }
    if (key === '$and') {
      return Array.isArray(value) && value.every((entry) => matchDocument(document, entry));
    }
    return matchFieldCondition(document, key, value);
  });
};

const normalizeSelect = (projection) => {
  if (!projection) return null;

  if (typeof projection === 'string') {
    return projection
      .split(/\s+/)
      .filter(Boolean)
      .reduce((acc, key) => {
        if (key.startsWith('-')) {
          acc.exclude.add(key.slice(1));
        } else {
          acc.include.add(key);
        }
        return acc;
      }, { include: new Set(), exclude: new Set() });
  }

  if (isPlainObject(projection)) {
    return Object.entries(projection).reduce((acc, [key, value]) => {
      if (value) {
        acc.include.add(key);
      } else {
        acc.exclude.add(key);
      }
      return acc;
    }, { include: new Set(), exclude: new Set() });
  }

  return null;
};

const applyProjection = (document, projection) => {
  const normalized = normalizeSelect(projection);
  if (!normalized) return clone(document);

  const source = clone(document);
  const hasInclude = normalized.include.size > 0;

  if (hasInclude) {
    const result = {};
    normalized.include.forEach((field) => {
      const value = getPathValue(source, field);
      if (value !== undefined) {
        setPathValue(result, field, value);
      }
    });
    if (!normalized.exclude.has('_id') && source._id !== undefined) {
      result._id = source._id;
    }
    return result;
  }

  normalized.exclude.forEach((field) => {
    delete source[field];
  });

  return source;
};

const compareBySort = (left, right, sortSpec = {}) => {
  const entries = Object.entries(sortSpec);
  if (!entries.length) return 0;

  for (const [field, direction] of entries) {
    const leftValue = normalizeComparable(getPathValue(left, field));
    const rightValue = normalizeComparable(getPathValue(right, field));

    if (leftValue === rightValue) continue;
    if (leftValue == null) return direction >= 0 ? -1 : 1;
    if (rightValue == null) return direction >= 0 ? 1 : -1;
    if (leftValue > rightValue) return direction >= 0 ? 1 : -1;
    if (leftValue < rightValue) return direction >= 0 ? -1 : 1;
  }

  return 0;
};

const evaluateExpression = (expression, document) => {
  if (typeof expression === 'string' && expression.startsWith('$')) {
    return getPathValue(document, expression.slice(1));
  }

  if (expression instanceof Date) return expression.toISOString();
  if (Array.isArray(expression)) return expression.map((entry) => evaluateExpression(entry, document));
  if (!isPlainObject(expression)) return expression;

  if (Object.prototype.hasOwnProperty.call(expression, '$subtract')) {
    const parts = expression.$subtract || [];
    const values = parts.map((entry) => normalizeComparable(evaluateExpression(entry, document)));
    if (!values.length) return 0;
    return values.slice(1).reduce((acc, value) => acc - value, values[0]);
  }

  if (Object.prototype.hasOwnProperty.call(expression, '$dayOfWeek')) {
    const value = evaluateExpression(expression.$dayOfWeek, document);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getUTCDay() + 1;
  }

  if (Object.prototype.hasOwnProperty.call(expression, '$hour')) {
    const value = evaluateExpression(expression.$hour, document);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getUTCHours();
  }

  return Object.entries(expression).reduce((acc, [key, value]) => {
    acc[key] = evaluateExpression(value, document);
    return acc;
  }, {});
};

const applyAggregatePipeline = (documents, pipeline = []) => {
  return (pipeline || []).reduce((rows, stage) => {
    if (stage.$match) {
      return rows.filter((row) => matchDocument(row, stage.$match));
    }

    if (stage.$group) {
      const groups = new Map();

      rows.forEach((row) => {
        const groupId = evaluateExpression(stage.$group._id, row);
        const key = JSON.stringify(groupId);

        if (!groups.has(key)) {
          groups.set(key, { _id: groupId });
        }

        const aggregateRow = groups.get(key);
        Object.entries(stage.$group).forEach(([field, expression]) => {
          if (field === '_id') return;
          if (isPlainObject(expression) && Object.prototype.hasOwnProperty.call(expression, '$sum')) {
            const increment = expression.$sum === 1
              ? 1
              : Number(evaluateExpression(expression.$sum, row) || 0);
            aggregateRow[field] = Number(aggregateRow[field] || 0) + increment;
          }
        });
      });

      return Array.from(groups.values());
    }

    if (stage.$sort) {
      return [...rows].sort((left, right) => compareBySort(left, right, stage.$sort));
    }

    return rows;
  }, [...documents]);
};

const createDuplicateKeyError = (fields, document = {}) => {
  const error = new Error(`Duplicate key for fields: ${fields.join(', ')}`);
  error.code = 11000;
  error.name = 'MongoServerError';
  error.keyValue = fields.reduce((acc, field) => {
    acc[field] = getPathValue(document, field);
    return acc;
  }, {});
  return error;
};

const buildSeedFromFilter = (filter = {}) => {
  return Object.entries(filter).reduce((acc, [key, value]) => {
    if (key.startsWith('$')) return acc;
    if (value instanceof RegExp || isOperatorObject(value) || isPlainObject(value)) return acc;
    setPathValue(acc, key, value);
    return acc;
  }, {});
};

const applyUpdate = (document, update = {}) => {
  const next = clone(document || {});
  const hasOperators = Object.keys(update).some((key) => key.startsWith('$'));

  if (!hasOperators) {
    return { ...next, ...clone(update) };
  }

  Object.entries(update).forEach(([operator, value]) => {
    if (operator === '$set') {
      Object.entries(value || {}).forEach(([field, entry]) => {
        setPathValue(next, field, entry);
      });
      return;
    }

    if (operator === '$inc') {
      Object.entries(value || {}).forEach(([field, increment]) => {
        const current = Number(getPathValue(next, field) || 0);
        setPathValue(next, field, current + Number(increment || 0));
      });
    }
  });

  return next;
};

const normalizeFieldType = (fieldType) => {
  const normalized = String(fieldType || '').trim().toLowerCase();

  if (normalized === 'int') return 'integer';
  if (normalized === 'float' || normalized === 'decimal') return 'number';
  if (normalized === 'bool') return 'boolean';

  if (['string', 'text', 'integer', 'number', 'boolean', 'date', 'json'].includes(normalized)) {
    return normalized;
  }

  return null;
};

const inferFieldTypeFromValue = (fieldName, value) => {
  const safeFieldName = String(fieldName || '');

  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'json';
  if (isPlainObject(value)) return 'json';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';

  if (typeof value === 'string') {
    if (value.length > 255) return 'text';

    if (
      ISO_DATE_REGEX.test(value) &&
      (/(?:Date|At)$/.test(safeFieldName) || /(?:^|_)(?:date|at)$/.test(safeFieldName))
    ) {
      return 'date';
    }

    return 'string';
  }

  if (value == null) {
    if (
      /(?:Year|Count|Sequence|Order|Points|Code|Width|Height|Memory|Concurrency|Min|Max)$/.test(safeFieldName) ||
      /(?:^|_)(?:year|count|sequence|order|points|code|width|height|memory|concurrency|min|max)$/.test(safeFieldName)
    ) {
      return 'integer';
    }

    if (/^(?:is_|has_)/.test(safeFieldName) || /^(?:is[A-Z]|has[A-Z])/.test(safeFieldName)) {
      return 'boolean';
    }

    if (/(?:Date|At)$/.test(safeFieldName) || /(?:^|_)(?:date|at)$/.test(safeFieldName)) {
      return 'date';
    }
  }

  return 'string';
};

const flattenIndexedFields = (indexes = []) =>
  (indexes || []).flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));

const inferFieldType = (fieldName, defaultValue, config = {}) => {
  const explicit = normalizeFieldType(config.fieldTypes?.[fieldName]);
  if (explicit) return explicit;

  const resolvedDefault =
    typeof defaultValue === 'function'
      ? (() => {
          try {
            return defaultValue();
          } catch (error) {
            return undefined;
          }
        })()
      : defaultValue;

  return inferFieldTypeFromValue(fieldName, resolvedDefault);
};

const buildFieldDefinitions = (config = {}) => {
  const defaults = config.defaults || {};
  const fieldNames = Array.from(new Set([
    ...Object.keys(defaults),
    ...Object.keys(config.fieldTypes || {}),
    ...flattenIndexedFields(config.unique),
    ...flattenIndexedFields(config.indexes),
  ])).filter((fieldName) => fieldName !== '_id');

  return fieldNames.reduce((acc, fieldName) => {
    acc[fieldName] = { type: inferFieldType(fieldName, defaults[fieldName], config) };
    return acc;
  }, {});
};

const getColumnSql = (fieldType) => {
  switch (fieldType) {
    case 'text':
      return 'LONGTEXT NULL';
    case 'integer':
      return 'INT NULL';
    case 'number':
      return 'DOUBLE NULL';
    case 'boolean':
      return 'TINYINT(1) NULL';
    case 'date':
      return 'DATETIME(3) NULL';
    case 'json':
      return 'JSON NULL';
    case 'string':
    default:
      return 'VARCHAR(255) NULL';
  }
};

const normalizeColumnType = (columnType = '') => {
  const normalized = String(columnType || '').trim().toLowerCase();

  if (normalized.startsWith('tinyint(1)')) return 'boolean';
  if (
    normalized.startsWith('int') ||
    normalized.startsWith('bigint') ||
    normalized.startsWith('smallint') ||
    normalized.startsWith('mediumint')
  ) {
    return 'integer';
  }
  if (
    normalized.startsWith('double') ||
    normalized.startsWith('float') ||
    normalized.startsWith('decimal')
  ) {
    return 'number';
  }
  if (
    normalized.startsWith('datetime') ||
    normalized.startsWith('timestamp') ||
    normalized === 'date'
  ) {
    return 'date';
  }
  if (normalized === 'json') return 'json';
  if (normalized.includes('text')) return 'text';
  if (normalized.startsWith('varchar') || normalized.startsWith('char')) return 'string';

  return 'string';
};

const isColumnCompatible = (expected, actual) => {
  const normalizedExpected = normalizeFieldType(expected) || 'string';
  const normalizedActual = normalizeFieldType(actual) || 'string';

  if (normalizedExpected === 'string') {
    return normalizedActual === 'string' || normalizedActual === 'text';
  }

  if (normalizedExpected === 'text') {
    return normalizedActual === 'text';
  }

  if (normalizedExpected === 'number') {
    return normalizedActual === 'number' || normalizedActual === 'integer';
  }

  if (normalizedExpected === 'boolean') {
    return normalizedActual === 'boolean';
  }

  return normalizedExpected === normalizedActual;
};

const serializeFieldValue = (fieldType, value) => {
  if (value === undefined || value === null) return null;

  switch (fieldType) {
    case 'text':
    case 'string':
      return String(value);
    case 'integer': {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    case 'number': {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'boolean':
      return value ? 1 : 0;
    case 'date':
      return toDateValue(value);
    case 'json':
      return JSON.stringify(stripInternalFields(value));
    default:
      return value;
  }
};

const deserializeFieldValue = (fieldType, value) => {
  if (value == null) return null;

  switch (fieldType) {
    case 'integer':
    case 'number':
      return Number(value);
    case 'boolean':
      return Boolean(Number(value));
    case 'date':
      return toIsoString(value);
    case 'json':
      return parseJsonValue(value);
    case 'text':
    case 'string':
    default:
      return String(value);
  }
};

const getDatabaseName = () => process.env.MYSQL_DATABASE || process.env.DB_NAME;

const tableExists = async (tableName) => {
  const [rows] = await pool.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name = ?
      LIMIT 1
    `,
    [getDatabaseName(), tableName]
  );
  return rows.length > 0;
};

const buildIndexName = (tableName, fields, unique = false) => {
  const base = `${unique ? 'uq' : 'idx'}_${tableName}_${fields.join('_')}`;
  if (base.length <= 64) return base;
  return `${base.slice(0, 40)}_${crypto.createHash('sha1').update(base).digest('hex').slice(0, 12)}`;
};

const ensureIndexes = async (modelMeta) => {
  const [indexRows] = await pool.query(`SHOW INDEX FROM \`${modelMeta.tableName}\``);
  const existingIndexes = new Set(indexRows.map((row) => row.Key_name));
  const indexes = [
    ...(modelMeta.unique || []).map((fields) => ({ fields, unique: true })),
    ...(modelMeta.indexes || []).map((fields) => ({ fields, unique: false })),
  ];

  for (const index of indexes) {
    const fields = Array.isArray(index.fields) ? index.fields : [index.fields];
    const indexName = buildIndexName(modelMeta.tableName, fields, index.unique);
    if (existingIndexes.has(indexName)) continue;

    const uniqueSql = index.unique ? 'UNIQUE ' : '';
    const columnsSql = fields.map((field) => `\`${field}\``).join(', ');
    await pool.query(`CREATE ${uniqueSql}INDEX \`${indexName}\` ON \`${modelMeta.tableName}\` (${columnsSql})`);
  }
};

const ensureTableColumns = async (modelMeta) => {
  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS \`${modelMeta.tableName}\` (
        id VARCHAR(64) NOT NULL,
        created_at DATETIME(3) NULL,
        updated_at DATETIME(3) NULL,
        extra_data JSON NULL,
        PRIMARY KEY (id)
      )
    `
  );

  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${modelMeta.tableName}\``);
  const existingColumns = new Map(rows.map((row) => [row.Field, row]));

  for (const [fieldName, fieldMeta] of Object.entries(modelMeta.fields)) {
    if (!existingColumns.has(fieldName)) {
      await pool.query(`ALTER TABLE \`${modelMeta.tableName}\` ADD COLUMN \`${fieldName}\` ${getColumnSql(fieldMeta.type)}`);
      continue;
    }

    const existingColumn = existingColumns.get(fieldName);
    const actualType = normalizeColumnType(existingColumn?.Type);
    if (isColumnCompatible(fieldMeta.type, actualType)) continue;

    await pool.query(`ALTER TABLE \`${modelMeta.tableName}\` MODIFY COLUMN \`${fieldName}\` ${getColumnSql(fieldMeta.type)}`);
  }
};

const syncDynamicFields = async (modelMeta, document = {}) => {
  let schemaChanged = false;

  Object.entries(stripInternalFields(document) || {}).forEach(([fieldName, value]) => {
    if (fieldName === '_id' || fieldName === '__persisted') return;
    if (modelMeta.timestamps && (fieldName === 'createdAt' || fieldName === 'updatedAt')) return;

    const inferredType = inferFieldTypeFromValue(fieldName, value);
    const existingType = modelMeta.fields[fieldName]?.type;

    if (!existingType) {
      modelMeta.fields[fieldName] = { type: inferredType };
      schemaChanged = true;
      return;
    }

    if (existingType === 'string' && inferredType === 'text') {
      modelMeta.fields[fieldName].type = 'text';
      schemaChanged = true;
    }
  });

  if (!schemaChanged) return;
  await ensureTableColumns(modelMeta);
};

const extractExtraData = (document, modelMeta) => {
  const extras = {};
  const knownFields = new Set(Object.keys(modelMeta.fields));

  Object.entries(document || {}).forEach(([key, value]) => {
    if (key === '_id' || key === '__persisted') return;
    if (knownFields.has(key)) return;
    if (modelMeta.timestamps && (key === 'createdAt' || key === 'updatedAt')) return;
    extras[key] = stripInternalFields(value);
  });

  return extras;
};

const normalizeDocumentForStorage = (modelMeta, document) => {
  const payload = mergeWithDefaults(stripInternalFields(document), modelMeta.defaults);
  const now = new Date().toISOString();

  if (!payload._id) {
    payload._id = typeof modelMeta.idDefault === 'function'
      ? modelMeta.idDefault(payload)
      : resolveDefaultValue(modelMeta.idDefault) || createObjectId();
  }

  if (modelMeta.timestamps) {
    payload.createdAt = payload.createdAt || now;
    payload.updatedAt = payload.updatedAt || now;
  }

  return payload;
};

const rowToDocument = (modelMeta, row) => {
  const extras = parseJsonValue(row.extra_data) || {};
  const document = isPlainObject(extras) ? { ...extras } : {};

  document._id = String(row.id);

  Object.entries(modelMeta.fields).forEach(([fieldName, fieldMeta]) => {
    if (row[fieldName] === undefined) return;
    document[fieldName] = deserializeFieldValue(fieldMeta.type, row[fieldName]);
  });

  if (modelMeta.timestamps) {
    if (row.created_at) document.createdAt = toIsoString(row.created_at);
    if (row.updated_at) document.updatedAt = toIsoString(row.updated_at);
  }

  return mergeWithDefaults(document, modelMeta.defaults);
};

const buildRowPayload = (modelMeta, document) => {
  const normalized = normalizeDocumentForStorage(modelMeta, document);
  const row = {
    id: String(normalized._id),
    created_at: modelMeta.timestamps ? toDateValue(normalized.createdAt) : null,
    updated_at: modelMeta.timestamps ? toDateValue(normalized.updatedAt) : null,
    extra_data: null,
  };

  Object.entries(modelMeta.fields).forEach(([fieldName, fieldMeta]) => {
    row[fieldName] = serializeFieldValue(fieldMeta.type, normalized[fieldName]);
  });

  const extras = extractExtraData(normalized, modelMeta);
  row.extra_data = Object.keys(extras).length ? JSON.stringify(extras) : null;

  return { row, normalized };
};

const upsertRow = async (modelMeta, document, options = {}) => {
  if (!options.skipReady) {
    await modelMeta.ensureReady();
  }

  await syncDynamicFields(modelMeta, document);

  const { row, normalized } = buildRowPayload(modelMeta, document);
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((column) => column !== 'id')
    .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
    .join(', ');

  await pool.query(
    `
      INSERT INTO \`${modelMeta.tableName}\` (${columns.map((column) => `\`${column}\``).join(', ')})
      VALUES (${placeholders})
      ON DUPLICATE KEY UPDATE ${updates}
    `,
    columns.map((column) => row[column])
  );

  return normalized;
};

const deleteRow = async (modelMeta, documentId) => {
  await modelMeta.ensureReady();
  const [result] = await pool.query(
    `DELETE FROM \`${modelMeta.tableName}\` WHERE id = ?`,
    [String(documentId)]
  );
  return result.affectedRows || 0;
};

const loadRows = async (modelMeta) => {
  await modelMeta.ensureReady();
  const [rows] = await pool.query(`SELECT * FROM \`${modelMeta.tableName}\``);
  return rows.map((row) => rowToDocument(modelMeta, row));
};

const migrateLegacyDocuments = async (modelMeta) => {
  const legacyCollectionNames = modelMeta.legacyCollectionNames || [];
  if (!legacyCollectionNames.length) return;

  if (!(await tableExists(LEGACY_DOCUMENT_TABLE))) {
    return;
  }

  const [existingRows] = await pool.query(`SELECT 1 FROM \`${modelMeta.tableName}\` LIMIT 1`);
  if (existingRows.length > 0) {
    return;
  }

  const placeholders = legacyCollectionNames.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `
      SELECT doc_id, data, created_at, updated_at
      FROM \`${LEGACY_DOCUMENT_TABLE}\`
      WHERE collection_name IN (${placeholders})
    `,
    legacyCollectionNames
  );

  for (const row of rows) {
    const parsed = parseJsonValue(row.data) || {};
    const document = isPlainObject(parsed) ? parsed : {};
    document._id = document._id || row.doc_id;

    if (modelMeta.timestamps) {
      document.createdAt = document.createdAt || (row.created_at ? toIsoString(row.created_at) : undefined);
      document.updatedAt = document.updatedAt || (row.updated_at ? toIsoString(row.updated_at) : undefined);
    }

    await upsertRow(modelMeta, document, { skipReady: true });
  }
};

class MySQLQuery {
  constructor(model, loader, options = {}) {
    this.model = model;
    this.loader = loader;
    this.single = Boolean(options.single);
    this.leanMode = false;
    this.sortSpec = null;
    this.limitValue = null;
    this.skipValue = 0;
    this.projection = options.projection || null;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  limit(value) {
    this.limitValue = Number(value);
    return this;
  }

  skip(value) {
    this.skipValue = Number(value);
    return this;
  }

  select(projection) {
    this.projection = projection;
    return this;
  }

  lean() {
    this.leanMode = true;
    return this;
  }

  async exec() {
    let documents = await this.loader();
    documents = Array.isArray(documents) ? documents.map((entry) => clone(entry)) : [];

    if (this.sortSpec) {
      documents.sort((left, right) => compareBySort(left, right, this.sortSpec));
    }

    if (this.skipValue > 0) {
      documents = documents.slice(this.skipValue);
    }

    if (Number.isFinite(this.limitValue) && this.limitValue >= 0) {
      documents = documents.slice(0, this.limitValue);
    }

    if (this.projection) {
      documents = documents.map((entry) => applyProjection(entry, this.projection));
    }

    if (this.single) {
      const document = documents[0] || null;
      if (!document) return null;
      return this.leanMode ? document : this.model._hydrate(document);
    }

    return this.leanMode ? documents : documents.map((entry) => this.model._hydrate(entry));
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(handler) {
    return this.exec().finally(handler);
  }
}

const createMySQLModel = (modelName, config = {}) => {
  const collectionName = config.collectionName || modelName.toLowerCase();
  const defaults = config.defaults || {};
  const fields = buildFieldDefinitions(config);
  const unique = config.unique || [];
  const indexes = config.indexes || [];
  const timestamps = Boolean(config.timestamps);
  const tableName = config.tableName || `${TABLE_PREFIX}${collectionName}`;
  const legacyCollectionNames = config.legacyCollectionNames || [collectionName];

  const modelMeta = {
    modelName,
    collectionName,
    tableName,
    defaults,
    fields,
    unique,
    indexes,
    timestamps,
    idDefault: config.idDefault,
    legacyCollectionNames,
    ensureReady: async () => {
      if (!tableInitPromises.has(tableName)) {
        tableInitPromises.set(tableName, (async () => {
          try {
            await ensureTableColumns(modelMeta);
            await ensureIndexes(modelMeta);
            await migrateLegacyDocuments(modelMeta);
          } catch (error) {
            tableInitPromises.delete(tableName);
            throw error;
          }
        })());
      }

      return tableInitPromises.get(tableName);
    },
  };

  class MySQLModel {
    constructor(data = {}, options = {}) {
      const base = options.skipDefaults ? clone(data) : mergeWithDefaults(data, defaults);
      const now = new Date().toISOString();

      if (!base._id) {
        base._id = typeof modelMeta.idDefault === 'function'
          ? modelMeta.idDefault(base)
          : resolveDefaultValue(modelMeta.idDefault) || createObjectId();
      }

      if (timestamps) {
        base.createdAt = base.createdAt || now;
        base.updatedAt = base.updatedAt || now;
      }

      Object.assign(this, base);
      Object.defineProperty(this, '__persisted', {
        value: Boolean(options.persisted),
        writable: true,
        enumerable: false,
      });
    }

    static _hydrate(document) {
      return new MySQLModel(document, { skipDefaults: true, persisted: true });
    }

    static async ensureTable() {
      await modelMeta.ensureReady();
      return tableName;
    }

    static async _all() {
      return loadRows(modelMeta);
    }

    static async _matched(filter = {}) {
      const documents = await MySQLModel._all();
      return documents.filter((document) => matchDocument(document, filter));
    }

    static async _assertUnique(document, excludeId = null) {
      if (!unique.length) return;

      const existingDocuments = await MySQLModel._all();
      unique.forEach((fieldSet) => {
        const conflict = existingDocuments.find((entry) => {
          if (excludeId && String(entry._id) === String(excludeId)) return false;
          return fieldSet.every((field) => valuesEqual(getPathValue(entry, field), getPathValue(document, field)));
        });

        if (conflict) {
          throw createDuplicateKeyError(fieldSet, document);
        }
      });
    }

    static async create(payload) {
      const document = new MySQLModel(payload);
      await document.save();
      return document;
    }

    static find(filter = {}, projection = null) {
      return new MySQLQuery(MySQLModel, () => MySQLModel._matched(filter), { projection });
    }

    static findOne(filter = {}, projection = null) {
      return new MySQLQuery(MySQLModel, () => MySQLModel._matched(filter), { single: true, projection });
    }

    static findById(id, projection = null) {
      return MySQLModel.findOne({ _id: String(id) }, projection);
    }

    static findOneAndUpdate(filter, update, options = {}) {
      return new MySQLQuery(
        MySQLModel,
        async () => {
          const matches = await MySQLModel._matched(filter);
          const original = matches[0] || null;

          if (!original && !options.upsert) {
            return [];
          }

          const seeded = original || mergeWithDefaults(buildSeedFromFilter(filter), defaults);
          const next = applyUpdate(seeded, update);
          const instance = new MySQLModel(next, { skipDefaults: false, persisted: Boolean(original) });

          if (original && timestamps) {
            instance.createdAt = original.createdAt || instance.createdAt;
          }

          if (timestamps) {
            instance.updatedAt = new Date().toISOString();
          }

          await MySQLModel._assertUnique(instance, original?._id || null);
          const stored = await upsertRow(modelMeta, instance);
          instance.__persisted = true;
          Object.assign(instance, stored);

          if (!options.new && original) {
            return [original];
          }

          return [instance.toObject()];
        },
        { single: true }
      );
    }

    static findByIdAndUpdate(id, update, options = {}) {
      return MySQLModel.findOneAndUpdate({ _id: String(id) }, update, options);
    }

    static async findByIdAndDelete(id) {
      const existing = await MySQLModel.findById(id).lean();
      if (!existing) return null;

      await deleteRow(modelMeta, existing._id);
      return MySQLModel._hydrate(existing);
    }

    static async deleteMany(filter = {}) {
      const documents = await MySQLModel._matched(filter);
      let deletedCount = 0;

      for (const document of documents) {
        deletedCount += await deleteRow(modelMeta, document._id);
      }

      return { deletedCount };
    }

    static async insertMany(payloads = []) {
      const results = [];
      for (const payload of payloads) {
        results.push(await MySQLModel.create(payload));
      }
      return results;
    }

    static async countDocuments(filter = {}) {
      const documents = await MySQLModel._matched(filter);
      return documents.length;
    }

    static async distinct(field, filter = {}) {
      const documents = await MySQLModel._matched(filter);
      const values = new Map();

      documents.forEach((document) => {
        getPathValues(document, field).forEach((value) => {
          const key = JSON.stringify(value);
          if (!values.has(key)) {
            values.set(key, value);
          }
        });
      });

      return Array.from(values.values());
    }

    static async aggregate(pipeline = []) {
      const documents = await MySQLModel._all();
      return applyAggregatePipeline(documents, pipeline);
    }

    static async bulkWrite(operations = []) {
      for (const operation of operations) {
        if (operation.updateOne) {
          await MySQLModel.findOneAndUpdate(
            operation.updateOne.filter || {},
            operation.updateOne.update || {},
            { upsert: Boolean(operation.updateOne.upsert), new: true }
          );
        }
      }

      return { ok: 1 };
    }

    async save() {
      const payload = stripInternalFields(this);
      const now = new Date().toISOString();

      if (timestamps) {
        payload.createdAt = payload.createdAt || now;
        payload.updatedAt = now;
      }

      await MySQLModel._assertUnique(payload, this.__persisted ? this._id : null);
      const stored = await upsertRow(modelMeta, payload);

      Object.assign(this, stored);
      this.__persisted = true;
      return this;
    }

    async deleteOne() {
      if (!this._id) {
        return { deletedCount: 0 };
      }

      const deletedCount = await deleteRow(modelMeta, this._id);
      this.__persisted = false;
      return { deletedCount };
    }

    toObject() {
      return stripInternalFields(this);
    }
  }

  Object.defineProperty(MySQLModel, 'modelName', {
    value: modelName,
    enumerable: true,
  });

  Object.defineProperty(MySQLModel, 'tableName', {
    value: tableName,
    enumerable: true,
  });

  return MySQLModel;
};

const ensureStoreReady = async () => true;

module.exports = {
  createMySQLModel,
  ensureStoreReady,
};
