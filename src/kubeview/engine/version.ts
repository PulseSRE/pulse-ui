/** Compare dotted versions numerically (4.15.10 > 4.15.9); pre-release tags sort after numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = /^\d+$/.test(x) ? parseInt(x, 10) : NaN;
    const ny = /^\d+$/.test(y) ? parseInt(y, 10) : NaN;
    if (!isNaN(nx) && !isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x.localeCompare(y);
    }
  }
  return 0;
}
