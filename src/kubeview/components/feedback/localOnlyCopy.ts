/**
 * The one sentence for "the assistant cannot answer about this cluster".
 * Pulse AI runs beside the local cluster and reads only it, so every AI entry
 * point is disabled while a remote cluster is active and says this.
 * Re-exported by LocalClusterOnlyNotice; kept here, import-free, so
 * store-free components can use it.
 */
export const PULSE_AI_LOCAL_ONLY = 'Pulse AI answers about the local cluster only.';
