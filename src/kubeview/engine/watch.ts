/**
 * WebSocket Watch Manager
 * Manages WebSocket connections to watch Kubernetes resources in real-time.
 */

import { K8S_BASE as BASE } from './gvr';
const HEARTBEAT_INTERVAL = 45000; // 45 seconds
const MAX_BACKOFF = 30000; // 30 seconds

export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';

export interface WatchEvent<T = unknown> {
  type: WatchEventType;
  object: T;
}

export type WatchCallback<T = unknown> = (event: WatchEvent<T>) => void;

export interface WatchSubscription {
  unsubscribe: () => void;
}

interface WatchConnection {
  ws: WebSocket | null;
  callbacks: Set<WatchCallback>;
  resourceVersion: string;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastEventTime: number;
}

export class WatchManager {
  private connections = new Map<string, WatchConnection>();
  private status: 'connected' | 'reconnecting' | 'disconnected' = 'disconnected';

  /**
   * Watch a resource type and receive real-time updates
   */
  watch<T>(
    apiPath: string,
    callback: WatchCallback<T>,
    resourceVersion?: string
  ): WatchSubscription {
    const key = this.normalizeAPIPath(apiPath);

    let connection = this.connections.get(key);

    if (!connection) {
      connection = {
        ws: null,
        callbacks: new Set(),
        resourceVersion: resourceVersion || '',
        reconnectAttempt: 0,
        reconnectTimer: null,
        heartbeatTimer: null,
        lastEventTime: Date.now(),
      };
      this.connections.set(key, connection);
    }

    // Add callback
    connection.callbacks.add(callback as WatchCallback);

    // Start watching if not already connected
    if (!connection.ws || connection.ws.readyState === WebSocket.CLOSED) {
      this.connect(key, apiPath, connection);
    }

    // Return subscription
    return {
      unsubscribe: () => {
        const conn = this.connections.get(key);
        if (conn) {
          conn.callbacks.delete(callback as WatchCallback);

          // If no more callbacks, close the connection
          if (conn.callbacks.size === 0) {
            this.disconnect(key);
          }
        }
      },
    };
  }

  /**
   * Stop all watches
   */
  stopAll(): void {
    for (const key of this.connections.keys()) {
      this.disconnect(key);
    }
  }

  /**
   * Get connection status
   */
  getStatus(): 'connected' | 'reconnecting' | 'disconnected' {
    return this.status;
  }

  /**
   * Get number of active watches
   */
  get watchCount(): number {
    return this.connections.size;
  }

  /**
   * Normalize API path to use as connection key
   */
  private normalizeAPIPath(apiPath: string): string {
    // Remove BASE prefix if present
    return apiPath.replace(BASE, '');
  }

  /**
   * Establish WebSocket connection
   */
  private connect(key: string, apiPath: string, connection: WatchConnection): void {
    const normalizedPath = this.normalizeAPIPath(apiPath);

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const separator = normalizedPath.includes('?') ? '&' : '?';
    let wsUrl = `${protocol}//${host}${BASE}${normalizedPath}${separator}watch=1`;

    if (connection.resourceVersion) {
      wsUrl += `&resourceVersion=${connection.resourceVersion}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      connection.ws = ws;

      ws.onopen = () => {
        connection.reconnectAttempt = 0;
        this.status = 'connected';
        this.startHeartbeat(key, connection);
      };

      ws.onmessage = (event) => {
        connection.lastEventTime = Date.now();

        try {
          const watchEvent: WatchEvent = JSON.parse(event.data);

          // Update resource version from BOOKMARK events
          if (watchEvent.type === 'BOOKMARK' && watchEvent.object) {
            const obj = watchEvent.object as { metadata?: { resourceVersion?: string } };
            if (obj.metadata?.resourceVersion) {
              connection.resourceVersion = obj.metadata.resourceVersion;
            }
          }

          // Update resource version from ADDED/MODIFIED events
          if ((watchEvent.type === 'ADDED' || watchEvent.type === 'MODIFIED') && watchEvent.object) {
            const obj = watchEvent.object as { metadata?: { resourceVersion?: string } };
            if (obj.metadata?.resourceVersion) {
              connection.resourceVersion = obj.metadata.resourceVersion;
            }
          }

          // Notify all callbacks
          for (const callback of connection.callbacks) {
            try {
              callback(watchEvent);
            } catch (error) {
              console.error('Watch callback error:', error);
            }
          }
        } catch (error) {
          console.error('Failed to parse watch event:', error);
        }
      };

      ws.onerror = () => {
        // WebSocket errors are expected when oc proxy doesn't support WS.
        // Polling fallback handles updates. Suppress to avoid console noise.
      };

      ws.onclose = (event) => {
        if (event.code !== 1006) console.log(`Watch closed: ${normalizedPath}`, event.code);
        this.stopHeartbeat(connection);

        // Handle 410 Gone (resourceVersion too old)
        if (event.code === 1008 || (event.reason && event.reason.includes('410'))) {
          console.log('Resource version too old, resetting');
          connection.resourceVersion = '';
        }

        // Reconnect if there are still callbacks
        if (connection.callbacks.size > 0) {
          this.scheduleReconnect(key, apiPath, connection);
        }
      };
    } catch (error) {
      console.error(`Failed to create WebSocket: ${normalizedPath}`, error);
      this.scheduleReconnect(key, apiPath, connection);
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(
    key: string,
    apiPath: string,
    connection: WatchConnection
  ): void {
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
    }

    // Calculate backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const backoff = Math.min(
      1000 * Math.pow(2, connection.reconnectAttempt),
      MAX_BACKOFF
    );

    connection.reconnectAttempt++;
    this.status = 'reconnecting';

    console.log(`Reconnecting in ${backoff}ms (attempt ${connection.reconnectAttempt})`);

    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      this.connect(key, apiPath, connection);
    }, backoff);
  }

  /**
   * Start heartbeat detection
   */
  private startHeartbeat(key: string, connection: WatchConnection): void {
    this.stopHeartbeat(connection);

    connection.heartbeatTimer = setInterval(() => {
      const timeSinceLastEvent = Date.now() - connection.lastEventTime;

      // If no event for 45 seconds, verify connection is still alive
      if (timeSinceLastEvent > HEARTBEAT_INTERVAL) {
        console.log('No watch events for 45s, checking connection');

        // Close and reconnect to verify
        if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close();
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat detection
   */
  private stopHeartbeat(connection: WatchConnection): void {
    if (connection.heartbeatTimer) {
      clearInterval(connection.heartbeatTimer);
      connection.heartbeatTimer = null;
    }
  }

  /**
   * Disconnect a watch
   */
  private disconnect(key: string): void {
    const connection = this.connections.get(key);

    if (!connection) {
      return;
    }

    // Clear timers
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
    }

    this.stopHeartbeat(connection);

    // Close WebSocket
    if (connection.ws) {
      connection.ws.close();
      connection.ws = null;
    }

    // Remove from connections
    this.connections.delete(key);

    // Update status
    if (this.connections.size === 0) {
      this.status = 'disconnected';
    }
  }

  /**
   * Force reconnect all watches (useful for testing or recovery)
   */
  reconnectAll(): void {
    for (const [key, connection] of this.connections) {
      if (connection.ws) {
        connection.ws.close();
      }
    }
  }

  /**
   * Get connection info for debugging
   */
  getConnections(): Array<{
    key: string;
    callbackCount: number;
    resourceVersion: string;
    reconnectAttempt: number;
    wsState: number | null;
  }> {
    const connections: Array<{
      key: string;
      callbackCount: number;
      resourceVersion: string;
      reconnectAttempt: number;
      wsState: number | null;
    }> = [];

    for (const [key, conn] of this.connections) {
      connections.push({
        key,
        callbackCount: conn.callbacks.size,
        resourceVersion: conn.resourceVersion,
        reconnectAttempt: conn.reconnectAttempt,
        wsState: conn.ws?.readyState ?? null,
      });
    }

    return connections;
  }
}

// Global instance
export const watchManager = new WatchManager();
