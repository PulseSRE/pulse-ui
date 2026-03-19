export function parseCpu(val: string): number {
  if (val.endsWith('m')) return parseInt(val, 10) / 1000;
  return parseFloat(val) || 0;
}

export function parseMem(val: string): number {
  const num = parseFloat(val);
  if (val.endsWith('Ki')) return num * 1024;
  if (val.endsWith('Mi')) return num * 1024 * 1024;
  if (val.endsWith('Gi')) return num * 1024 * 1024 * 1024;
  if (val.endsWith('Ti')) return num * 1024 * 1024 * 1024 * 1024;
  return num || 0;
}

export function formatMem(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} Gi`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} Mi`;
  return `${bytes}`;
}

export function parseResourceValue(val: string): number {
  if (!val) return 0;
  const num = parseFloat(val);
  if (val.endsWith('Ki')) return num * 1024;
  if (val.endsWith('Mi')) return num * 1024 * 1024;
  if (val.endsWith('Gi')) return num * 1024 * 1024 * 1024;
  if (val.endsWith('Ti')) return num * 1024 * 1024 * 1024 * 1024;
  if (val.endsWith('m')) return num / 1000;
  if (val.endsWith('k')) return num * 1000;
  if (val.endsWith('M')) return num * 1000000;
  if (val.endsWith('G')) return num * 1000000000;
  return num;
}

export function formatResourceValue(val: string, resource: string): string {
  if (!val) return '—';
  if (resource.includes('memory') || resource.includes('storage') || resource.includes('ephemeral')) {
    const bytes = parseResourceValue(val);
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Gi`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} Mi`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ki`;
    return val;
  }
  return val;
}
