/**
 * Simple JSON to YAML converter (no external dependency)
 */
export function jsonToYaml(obj: unknown, indent: number = 0): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return String(obj);
  if (typeof obj === 'number') return String(obj);

  if (typeof obj === 'string') {
    // Multi-line strings
    if (obj.includes('\n')) {
      const lines = obj.split('\n');
      const prefix = ' '.repeat(indent);
      return '|\n' + lines.map((l) => prefix + '  ' + l).join('\n');
    }
    // Strings that need quoting
    if (obj === '' || obj === 'true' || obj === 'false' || obj === 'null' ||
        /^\d/.test(obj) || /[:{}\[\],&*#?|<>=!%@`]/.test(obj) || obj.includes(': ') || obj.includes(' #')) {
      return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  const prefix = ' '.repeat(indent);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map((item) => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (entries.length === 0) return `${prefix}- {}`;
        const first = entries[0];
        const rest = entries.slice(1);
        let result = `${prefix}- ${first[0]}: ${jsonToYaml(first[1], indent + 4)}`;
        for (const [k, v] of rest) {
          result += `\n${prefix}  ${k}: ${jsonToYaml(v, indent + 4)}`;
        }
        return result;
      }
      return `${prefix}- ${jsonToYaml(item, indent + 2)}`;
    }).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';

    return entries.map(([key, value]) => {
      if (value === null || value === undefined) {
        return `${prefix}${key}: null`;
      }
      if (typeof value === 'object') {
        if (Array.isArray(value) && value.length === 0) {
          return `${prefix}${key}: []`;
        }
        if (!Array.isArray(value) && Object.keys(value as object).length === 0) {
          return `${prefix}${key}: {}`;
        }
        return `${prefix}${key}:\n${jsonToYaml(value, indent + 2)}`;
      }
      return `${prefix}${key}: ${jsonToYaml(value, indent + 2)}`;
    }).join('\n');
  }

  return String(obj);
}

/**
 * Sanitize a K8s resource for GitOps export — strips runtime fields, redacts secrets
 */
export function sanitizeForGitOps(resource: Record<string, unknown>): Record<string, unknown> {
  const clean = JSON.parse(JSON.stringify(resource));

  delete clean.status;

  if (clean.metadata) {
    delete clean.metadata.resourceVersion;
    delete clean.metadata.uid;
    delete clean.metadata.creationTimestamp;
    delete clean.metadata.generation;
    delete clean.metadata.selfLink;
    delete clean.metadata.managedFields;
    delete clean.metadata.ownerReferences;

    if (clean.metadata.annotations) {
      const noisy = [
        'kubectl.kubernetes.io/last-applied-configuration',
        'openshift.io/generated-by',
        'deployment.kubernetes.io/revision',
      ];
      for (const key of noisy) delete clean.metadata.annotations[key];
      for (const key of Object.keys(clean.metadata.annotations)) {
        if (key.startsWith('pv.kubernetes.io/')) delete clean.metadata.annotations[key];
      }
      if (Object.keys(clean.metadata.annotations).length === 0) delete clean.metadata.annotations;
    }
  }

  if (clean.kind === 'Secret') {
    clean.data = {};
    delete clean.stringData;
    if (!clean.metadata.annotations) clean.metadata.annotations = {};
    clean.metadata.annotations['openshiftpulse.io/secret-data'] = 'redacted';
  }

  return clean;
}

/**
 * Convert a K8s resource to clean YAML (removes managed fields and other noise)
 */
export function resourceToYaml(resource: Record<string, unknown>): string {
  // Clean copy without noisy fields
  const clean: Record<string, unknown> = { ...resource };

  // Remove internal fields
  delete clean._gvrKey;

  // Clean metadata
  if (clean.metadata && typeof clean.metadata === 'object') {
    const meta = { ...(clean.metadata as Record<string, unknown>) };
    delete meta.managedFields;
    // Keep resourceVersion — required by K8s API for PUT updates
    delete meta.uid;
    delete meta.creationTimestamp;
    delete meta.generation;
    delete meta.selfLink;
    // Clean noisy annotations
    if (meta.annotations && typeof meta.annotations === 'object') {
      const annotations = { ...(meta.annotations as Record<string, unknown>) };
      delete annotations['kubectl.kubernetes.io/last-applied-configuration'];
      if (Object.keys(annotations).length === 0) {
        delete meta.annotations;
      } else {
        meta.annotations = annotations;
      }
    }
    clean.metadata = meta;
  }

  // Remove empty status
  if (clean.status && typeof clean.status === 'object' && Object.keys(clean.status as object).length === 0) {
    delete clean.status;
  }

  return jsonToYaml(clean);
}
