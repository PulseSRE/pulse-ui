/** Chart types that plot values against time on the x-axis. */
const TIME_AXIS_TYPES = new Set(['line', 'area', 'bar', 'stacked_bar', 'stacked_area']);

/**
 * True when a time-axis chart has no time dimension to show: every series has
 * at most one sample, all at the same instant (a Prometheus instant query such
 * as topk(10, ...)). Drawn on a time axis that becomes a single tick with the
 * bars squeezed beside it, or a line chart of lone dots. Such data is a
 * comparison between series and reads correctly as one bar per series.
 */
export function isSnapshotData(chartType: string, series: Array<{ data: Array<[number, number]> }>): boolean {
  if (!TIME_AXIS_TYPES.has(chartType) || series.length === 0) return false;
  const timestamps = new Set<number>();
  for (const s of series) {
    if ((s.data || []).length > 1) return false;
    for (const [ts] of s.data || []) timestamps.add(ts);
  }
  return timestamps.size === 1;
}
