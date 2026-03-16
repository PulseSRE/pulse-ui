/**
 * OpenAPI Schema Fetcher
 * Fetches and caches OpenAPI schemas for Kubernetes resources.
 */

const BASE = '/api/kubernetes';

export interface FieldSchema {
  name: string;
  path: string;         // "spec.replicas"
  type: string;         // "integer", "string", "object", "array"
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  format?: string;      // "int32", "date-time", etc
  items?: FieldSchema;  // for arrays
  properties?: FieldSchema[];  // for objects
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface ResourceSchema {
  gvk: { group: string; version: string; kind: string };
  description: string;
  fields: FieldSchema[];
  required: string[];
}

interface OpenAPIV3Spec {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
  paths: Record<string, unknown>;
  components?: {
    schemas?: Record<string, SchemaObject>;
  };
}

interface SchemaObject {
  type?: string;
  description?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  default?: unknown;
  enum?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  $ref?: string;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  'x-kubernetes-group-version-kind'?: Array<{
    group: string;
    version: string;
    kind: string;
  }>;
}

interface OpenAPIV2Spec {
  swagger: string;
  definitions?: Record<string, SchemaObject>;
}

const schemaCache = new Map<string, ResourceSchema>();
const openAPICache = new Map<string, OpenAPIV3Spec | OpenAPIV2Spec>();

/**
 * Fetch OpenAPI schema for a resource type
 */
export async function fetchSchema(
  group: string,
  version: string,
  kind: string
): Promise<ResourceSchema> {
  const cacheKey = `${group}/${version}/${kind}`;

  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey)!;
  }

  try {
    // Try OpenAPI v3 first
    const schema = await fetchOpenAPIV3Schema(group, version, kind);
    schemaCache.set(cacheKey, schema);
    return schema;
  } catch (error) {
    console.warn('Failed to fetch OpenAPI v3, falling back to v2:', error);

    try {
      // Fall back to OpenAPI v2 (Swagger)
      const schema = await fetchOpenAPIV2Schema(group, version, kind);
      schemaCache.set(cacheKey, schema);
      return schema;
    } catch (v2Error) {
      console.error('Failed to fetch OpenAPI v2:', v2Error);
      throw new Error(`Failed to fetch schema for ${kind}`);
    }
  }
}

/**
 * Fetch schema from OpenAPI v3 endpoint
 */
async function fetchOpenAPIV3Schema(
  group: string,
  version: string,
  kind: string
): Promise<ResourceSchema> {
  const openAPIKey = group === '' ? 'core/v1' : `${group}/${version}`;

  let spec: OpenAPIV3Spec;

  if (openAPICache.has(openAPIKey)) {
    spec = openAPICache.get(openAPIKey) as OpenAPIV3Spec;
  } else {
    const url = group === ''
      ? `${BASE}/openapi/v3/api/v1`
      : `${BASE}/openapi/v3/apis/${group}/${version}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.statusText}`);
    }

    spec = await response.json();
    openAPICache.set(openAPIKey, spec);
  }

  // Find the schema definition for this kind
  const schemas = spec.components?.schemas || {};
  let schemaObj: SchemaObject | null = null;
  let schemaName = '';

  for (const [name, obj] of Object.entries(schemas)) {
    const gvks = obj['x-kubernetes-group-version-kind'];
    if (gvks) {
      const match = gvks.find(
        gvk => gvk.kind === kind && gvk.version === version && gvk.group === group
      );
      if (match) {
        schemaObj = obj;
        schemaName = name;
        break;
      }
    }
  }

  if (!schemaObj) {
    throw new Error(`Schema not found for ${kind}`);
  }

  // Parse the schema into our format
  const fields = parseSchemaObject(schemaObj, '', schemas, 0, new Set());

  return {
    gvk: { group, version, kind },
    description: schemaObj.description || '',
    fields,
    required: schemaObj.required || [],
  };
}

/**
 * Fetch schema from OpenAPI v2 endpoint (Swagger)
 */
async function fetchOpenAPIV2Schema(
  group: string,
  version: string,
  kind: string
): Promise<ResourceSchema> {
  const openAPIKey = 'swagger';

  let spec: OpenAPIV2Spec;

  if (openAPICache.has(openAPIKey)) {
    spec = openAPICache.get(openAPIKey) as OpenAPIV2Spec;
  } else {
    const response = await fetch(`${BASE}/openapi/v2`);
    if (!response.ok) {
      throw new Error(`Failed to fetch Swagger spec: ${response.statusText}`);
    }

    spec = await response.json();
    openAPICache.set(openAPIKey, spec);
  }

  const definitions = spec.definitions || {};
  let schemaObj: SchemaObject | null = null;

  for (const [name, obj] of Object.entries(definitions)) {
    const gvks = obj['x-kubernetes-group-version-kind'];
    if (gvks) {
      const match = gvks.find(
        gvk => gvk.kind === kind && gvk.version === version && gvk.group === group
      );
      if (match) {
        schemaObj = obj;
        break;
      }
    }
  }

  if (!schemaObj) {
    throw new Error(`Schema not found for ${kind} in Swagger`);
  }

  const fields = parseSchemaObject(schemaObj, '', definitions, 0, new Set());

  return {
    gvk: { group, version, kind },
    description: schemaObj.description || '',
    fields,
    required: schemaObj.required || [],
  };
}

/**
 * Parse a schema object into field schemas
 */
/**
 * Resolve $ref, allOf, oneOf, anyOf into a concrete schema object
 */
function resolveSchemaRef(obj: SchemaObject, definitions: Record<string, SchemaObject>): SchemaObject {
  // Direct $ref
  if (obj.$ref) {
    const refName = obj.$ref.split('/').pop();
    if (refName && definitions[refName]) {
      return { ...definitions[refName], description: obj.description || definitions[refName].description };
    }
    return obj;
  }

  // allOf: merge all schemas together
  if (obj.allOf && obj.allOf.length > 0) {
    let merged: SchemaObject = { description: obj.description };
    for (const item of obj.allOf) {
      const resolved = resolveSchemaRef(item, definitions);
      merged = {
        ...merged,
        ...resolved,
        description: merged.description || resolved.description,
        properties: { ...(merged.properties || {}), ...(resolved.properties || {}) },
        required: [...(merged.required || []), ...(resolved.required || [])],
      };
    }
    return merged;
  }

  // oneOf/anyOf: use first option
  if (obj.oneOf && obj.oneOf.length > 0) {
    return resolveSchemaRef(obj.oneOf[0], definitions);
  }
  if (obj.anyOf && obj.anyOf.length > 0) {
    return resolveSchemaRef(obj.anyOf[0], definitions);
  }

  return obj;
}

function parseSchemaObject(
  obj: SchemaObject,
  basePath: string,
  definitions: Record<string, SchemaObject>,
  depth: number = 0,
  visited: Set<string> = new Set()
): FieldSchema[] {
  const fields: FieldSchema[] = [];

  // Prevent infinite recursion from circular $refs
  if (depth > 8) return fields;

  // Resolve $ref / allOf if present
  if (obj.$ref || obj.allOf) {
    const resolved = resolveSchemaRef(obj, definitions);
    if (resolved !== obj) {
      const refName = obj.$ref?.split('/').pop() || '';
      if (refName && visited.has(refName)) return fields;
      if (refName) visited.add(refName);
      return parseSchemaObject(resolved, basePath, definitions, depth + 1, visited);
    }
    return fields;
  }

  if (!obj.properties) {
    return fields;
  }

  for (const [name, prop] of Object.entries(obj.properties)) {
    const path = basePath ? `${basePath}.${name}` : name;
    const isRequired = obj.required?.includes(name) || false;

    // Resolve $ref, allOf, oneOf, anyOf
    let resolvedProp = resolveSchemaRef(prop, definitions);

    const field: FieldSchema = {
      name,
      path,
      type: resolvedProp.type || 'object',
      description: resolvedProp.description || '',
      required: isRequired,
      default: resolvedProp.default,
      enum: resolvedProp.enum,
      format: resolvedProp.format,
      minimum: resolvedProp.minimum,
      maximum: resolvedProp.maximum,
      pattern: resolvedProp.pattern,
    };

    // Handle array items
    if (field.type === 'array' && resolvedProp.items) {
      let itemsProp = resolveSchemaRef(resolvedProp.items, definitions);

      field.items = {
        name: 'items',
        path: `${path}[]`,
        type: itemsProp.type || 'object',
        description: itemsProp.description || '',
        required: false,
        format: itemsProp.format,
      };

      // If array items are objects, parse their properties
      if (itemsProp.properties) {
        field.items.properties = parseSchemaObject(itemsProp, `${path}[]`, definitions, depth + 1, new Set(visited));
      }
    }

    // Handle object properties (but don't recurse too deep)
    if (field.type === 'object' && resolvedProp.properties) {
      field.properties = parseSchemaObject(resolvedProp, path, definitions, depth + 1, new Set(visited));
    }

    fields.push(field);
  }

  return fields;
}

/**
 * Get field schema by path (e.g., "spec.replicas")
 */
export function getFieldSchema(
  schema: ResourceSchema,
  path: string
): FieldSchema | undefined {
  const parts = path.split('.');
  let currentFields = schema.fields;
  let field: FieldSchema | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    field = currentFields.find(f => f.name === part);

    if (!field) {
      return undefined;
    }

    if (i < parts.length - 1) {
      // Navigate deeper
      if (field.properties) {
        currentFields = field.properties;
      } else if (field.items?.properties) {
        currentFields = field.items.properties;
      } else {
        return undefined;
      }
    }
  }

  return field;
}

/**
 * Get top-level fields (metadata, spec, status, etc.)
 */
export function getTopLevelFields(schema: ResourceSchema): FieldSchema[] {
  return schema.fields.filter(f => !f.path.includes('.'));
}

/**
 * Get spec fields
 */
export function getSpecFields(schema: ResourceSchema): FieldSchema[] {
  const specField = schema.fields.find(f => f.name === 'spec');
  return specField?.properties || [];
}

/**
 * Get status fields
 */
export function getStatusFields(schema: ResourceSchema): FieldSchema[] {
  const statusField = schema.fields.find(f => f.name === 'status');
  return statusField?.properties || [];
}

/**
 * Clear schema cache (useful for testing)
 */
export function clearSchemaCache(): void {
  schemaCache.clear();
  openAPICache.clear();
}

/**
 * Get validation errors for a field value
 */
export function validateField(
  field: FieldSchema,
  value: unknown
): string[] {
  const errors: string[] = [];

  if (field.required && (value === undefined || value === null)) {
    errors.push(`${field.path} is required`);
    return errors;
  }

  if (value === undefined || value === null) {
    return errors;
  }

  // Type validation
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (field.type === 'integer' || field.type === 'number') {
    if (typeof value !== 'number') {
      errors.push(`${field.path} must be a number`);
    } else {
      if (field.minimum !== undefined && value < field.minimum) {
        errors.push(`${field.path} must be >= ${field.minimum}`);
      }
      if (field.maximum !== undefined && value > field.maximum) {
        errors.push(`${field.path} must be <= ${field.maximum}`);
      }
    }
  } else if (field.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${field.path} must be a string`);
    } else {
      if (field.enum && !field.enum.includes(value)) {
        errors.push(`${field.path} must be one of: ${field.enum.join(', ')}`);
      }
      if (field.pattern && !new RegExp(field.pattern).test(value)) {
        errors.push(`${field.path} must match pattern: ${field.pattern}`);
      }
    }
  } else if (field.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${field.path} must be a boolean`);
  } else if (field.type === 'array' && !Array.isArray(value)) {
    errors.push(`${field.path} must be an array`);
  } else if (field.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
    errors.push(`${field.path} must be an object`);
  }

  return errors;
}
