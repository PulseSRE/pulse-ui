/**
 * One page per group, together covering every component kind the agent can
 * emit (all 25 in pulse-agent's component_registry). Specs are in the shape
 * the agent saves them: run through pulse-agent's normalize_layout, so chart
 * series carry `name`, not `label`.
 *
 * Used by agent-widgets.spec.ts to check each kind renders without the
 * widget error boundary ("failed to render").
 */
export interface WidgetPage {
  title: string;
  layout: Array<Record<string, unknown>>;
}

export const AGENT_WIDGET_PAGES: WidgetPage[] = [
  {
    "title": "Widgets 1 - KPIs and data",
    "layout": [
      {
        "kind": "metric_card",
        "title": "Running Pods",
        "value": "42",
        "status": "healthy"
      },
      {
        "kind": "stat_card",
        "title": "Error Rate",
        "value": "2.3",
        "unit": "%",
        "trend": "down",
        "trendValue": "12%",
        "trendGood": "down"
      },
      {
        "kind": "info_card_grid",
        "title": "Cluster Health",
        "cards": [
          {
            "label": "Nodes Ready",
            "value": "5/5",
            "sub": "all healthy"
          },
          {
            "label": "Pods",
            "value": "187",
            "sub": "180 running"
          },
          {
            "label": "Alerts",
            "value": "2",
            "sub": "firing",
            "severity": "warning"
          },
          {
            "label": "Upgrades",
            "value": "None",
            "sub": "4.16.8"
          }
        ]
      },
      {
        "kind": "resource_counts",
        "title": "production Resources",
        "namespace": "production",
        "items": [
          {
            "resource": "pods",
            "count": 42,
            "gvr": "v1~pods",
            "status": "healthy"
          },
          {
            "resource": "deployments",
            "count": 9,
            "gvr": "apps~v1~deployments",
            "status": "warning"
          },
          {
            "resource": "services",
            "count": 11,
            "gvr": "v1~services",
            "status": "healthy"
          },
          {
            "resource": "configmaps",
            "count": 23,
            "gvr": "v1~configmaps",
            "status": "healthy"
          }
        ]
      },
      {
        "kind": "status_list",
        "title": "Firing Alerts",
        "items": [
          {
            "name": "KubePodCrashLooping",
            "status": "error",
            "detail": "pod/cache-7f9 · 14 restarts"
          },
          {
            "name": "CPUThrottlingHigh",
            "status": "warning",
            "detail": "deploy/checkout-api"
          }
        ]
      },
      {
        "kind": "badge_list",
        "title": "Labels on checkout-api",
        "badges": [
          {
            "text": "app=checkout",
            "variant": "info"
          },
          {
            "text": "tier=backend",
            "variant": "info"
          },
          {
            "text": "version=v2.4.1",
            "variant": "success"
          },
          {
            "text": "canary=false",
            "variant": "warning"
          }
        ]
      },
      {
        "kind": "key_value",
        "title": "Pod Details: cache-7f9",
        "pairs": [
          {
            "key": "Status",
            "value": "CrashLoopBackOff"
          },
          {
            "key": "Node",
            "value": "worker-0"
          },
          {
            "key": "Restarts",
            "value": "14"
          },
          {
            "key": "Last exit",
            "value": "OOMKilled (137)"
          },
          {
            "key": "Image",
            "value": "redis:7.2"
          }
        ]
      },
      {
        "kind": "data_table",
        "title": "Pods in production",
        "columns": [
          {
            "id": "name",
            "header": "Name"
          },
          {
            "id": "status",
            "header": "Status"
          },
          {
            "id": "restarts",
            "header": "Restarts",
            "type": "number"
          }
        ],
        "rows": [
          {
            "name": "checkout-api-x2k",
            "status": "Running",
            "restarts": 0,
            "_gvr": "v1~pods"
          },
          {
            "name": "cache-7f9-h3j",
            "status": "CrashLoopBackOff",
            "restarts": 14,
            "_gvr": "v1~pods"
          },
          {
            "name": "payments-zz1",
            "status": "Running",
            "restarts": 1,
            "_gvr": "v1~pods"
          }
        ]
      }
    ]
  },
  {
    "title": "Widgets 2 - Visualizations",
    "layout": [
      {
        "kind": "chart",
        "chartType": "line",
        "title": "CPU by Deployment",
        "series": [
          {
            "data": [
              [
                1792159437000,
                1.4
              ],
              [
                1792159497000,
                1.47
              ],
              [
                1792159557000,
                1.53
              ],
              [
                1792159617000,
                1.59
              ],
              [
                1792159677000,
                1.65
              ],
              [
                1792159737000,
                1.7
              ],
              [
                1792159797000,
                1.74
              ],
              [
                1792159857000,
                1.77
              ],
              [
                1792159917000,
                1.79
              ],
              [
                1792159977000,
                1.8
              ],
              [
                1792160037000,
                1.8
              ],
              [
                1792160097000,
                1.79
              ],
              [
                1792160157000,
                1.76
              ],
              [
                1792160217000,
                1.73
              ],
              [
                1792160277000,
                1.69
              ],
              [
                1792160337000,
                1.64
              ],
              [
                1792160397000,
                1.58
              ],
              [
                1792160457000,
                1.52
              ],
              [
                1792160517000,
                1.46
              ],
              [
                1792160577000,
                1.39
              ],
              [
                1792160637000,
                1.32
              ],
              [
                1792160697000,
                1.26
              ],
              [
                1792160757000,
                1.2
              ],
              [
                1792160817000,
                1.14
              ],
              [
                1792160877000,
                1.1
              ],
              [
                1792160937000,
                1.06
              ],
              [
                1792160997000,
                1.03
              ],
              [
                1792161057000,
                1.01
              ],
              [
                1792161117000,
                1.0
              ],
              [
                1792161177000,
                1.0
              ],
              [
                1792161237000,
                1.02
              ],
              [
                1792161297000,
                1.04
              ],
              [
                1792161357000,
                1.07
              ],
              [
                1792161417000,
                1.12
              ],
              [
                1792161477000,
                1.17
              ],
              [
                1792161537000,
                1.23
              ],
              [
                1792161597000,
                1.29
              ],
              [
                1792161657000,
                1.35
              ],
              [
                1792161717000,
                1.42
              ],
              [
                1792161777000,
                1.49
              ],
              [
                1792161837000,
                1.55
              ],
              [
                1792161897000,
                1.61
              ],
              [
                1792161957000,
                1.66
              ],
              [
                1792162017000,
                1.71
              ],
              [
                1792162077000,
                1.75
              ],
              [
                1792162137000,
                1.78
              ],
              [
                1792162197000,
                1.79
              ],
              [
                1792162257000,
                1.8
              ],
              [
                1792162317000,
                1.8
              ],
              [
                1792162377000,
                1.78
              ],
              [
                1792162437000,
                1.75
              ],
              [
                1792162497000,
                1.72
              ],
              [
                1792162557000,
                1.68
              ],
              [
                1792162617000,
                1.62
              ],
              [
                1792162677000,
                1.56
              ],
              [
                1792162737000,
                1.5
              ],
              [
                1792162797000,
                1.44
              ],
              [
                1792162857000,
                1.37
              ],
              [
                1792162917000,
                1.3
              ],
              [
                1792162977000,
                1.24
              ]
            ],
            "name": "checkout-api"
          },
          {
            "data": [
              [
                1792159437000,
                0.8
              ],
              [
                1792159497000,
                0.83
              ],
              [
                1792159557000,
                0.87
              ],
              [
                1792159617000,
                0.9
              ],
              [
                1792159677000,
                0.92
              ],
              [
                1792159737000,
                0.95
              ],
              [
                1792159797000,
                0.97
              ],
              [
                1792159857000,
                0.98
              ],
              [
                1792159917000,
                0.99
              ],
              [
                1792159977000,
                1.0
              ],
              [
                1792160037000,
                1.0
              ],
              [
                1792160097000,
                0.99
              ],
              [
                1792160157000,
                0.98
              ],
              [
                1792160217000,
                0.97
              ],
              [
                1792160277000,
                0.94
              ],
              [
                1792160337000,
                0.92
              ],
              [
                1792160397000,
                0.89
              ],
              [
                1792160457000,
                0.86
              ],
              [
                1792160517000,
                0.83
              ],
              [
                1792160577000,
                0.79
              ],
              [
                1792160637000,
                0.76
              ],
              [
                1792160697000,
                0.73
              ],
              [
                1792160757000,
                0.7
              ],
              [
                1792160817000,
                0.67
              ],
              [
                1792160877000,
                0.65
              ],
              [
                1792160937000,
                0.63
              ],
              [
                1792160997000,
                0.61
              ],
              [
                1792161057000,
                0.6
              ],
              [
                1792161117000,
                0.6
              ],
              [
                1792161177000,
                0.6
              ],
              [
                1792161237000,
                0.61
              ],
              [
                1792161297000,
                0.62
              ],
              [
                1792161357000,
                0.64
              ],
              [
                1792161417000,
                0.66
              ],
              [
                1792161477000,
                0.68
              ],
              [
                1792161537000,
                0.71
              ],
              [
                1792161597000,
                0.74
              ],
              [
                1792161657000,
                0.78
              ],
              [
                1792161717000,
                0.81
              ],
              [
                1792161777000,
                0.84
              ],
              [
                1792161837000,
                0.87
              ],
              [
                1792161897000,
                0.9
              ],
              [
                1792161957000,
                0.93
              ],
              [
                1792162017000,
                0.95
              ],
              [
                1792162077000,
                0.97
              ],
              [
                1792162137000,
                0.99
              ],
              [
                1792162197000,
                1.0
              ],
              [
                1792162257000,
                1.0
              ],
              [
                1792162317000,
                1.0
              ],
              [
                1792162377000,
                0.99
              ],
              [
                1792162437000,
                0.98
              ],
              [
                1792162497000,
                0.96
              ],
              [
                1792162557000,
                0.94
              ],
              [
                1792162617000,
                0.91
              ],
              [
                1792162677000,
                0.88
              ],
              [
                1792162737000,
                0.85
              ],
              [
                1792162797000,
                0.82
              ],
              [
                1792162857000,
                0.78
              ],
              [
                1792162917000,
                0.75
              ],
              [
                1792162977000,
                0.72
              ]
            ],
            "name": "payments"
          }
        ]
      },
      {
        "kind": "chart",
        "chartType": "donut",
        "title": "Pods by Phase",
        "series": [
          {
            "data": [
              [
                1792162977000,
                180
              ]
            ],
            "name": "Running"
          },
          {
            "data": [
              [
                1792162977000,
                4
              ]
            ],
            "name": "Pending"
          },
          {
            "data": [
              [
                1792162977000,
                3
              ]
            ],
            "name": "Failed"
          }
        ]
      },
      {
        "kind": "bar_list",
        "title": "Top Pods by Memory",
        "items": [
          {
            "label": "checkout-api-x2k",
            "value": 1900
          },
          {
            "label": "payments-zz1",
            "value": 1200
          },
          {
            "label": "frontend-k1m",
            "value": 640
          },
          {
            "label": "worker-qq8",
            "value": 310
          }
        ]
      },
      {
        "kind": "progress_list",
        "title": "Node CPU",
        "items": [
          {
            "label": "worker-0",
            "value": 82,
            "max": 100,
            "unit": "%"
          },
          {
            "label": "worker-1",
            "value": 57,
            "max": 100,
            "unit": "%"
          },
          {
            "label": "worker-2",
            "value": 31,
            "max": 100,
            "unit": "%"
          }
        ]
      },
      {
        "kind": "node_map",
        "title": "Cluster Nodes",
        "nodes": [
          {
            "name": "master-0",
            "status": "ready",
            "cpuPct": 38.1
          },
          {
            "name": "worker-0",
            "status": "pressure",
            "cpuPct": 82.4
          },
          {
            "name": "worker-1",
            "status": "ready",
            "cpuPct": 57.0
          },
          {
            "name": "worker-2",
            "status": "notready",
            "cpuPct": 0
          }
        ]
      },
      {
        "kind": "timeline",
        "title": "Incident Timeline",
        "lanes": [
          {
            "label": "Alerts",
            "category": "alert",
            "events": [
              {
                "timestamp": 1792160037000,
                "label": "CPU high"
              },
              {
                "timestamp": 1792161837000,
                "label": "CrashLooping"
              }
            ]
          },
          {
            "label": "Deploys",
            "category": "change",
            "events": [
              {
                "timestamp": 1792161537000,
                "label": "checkout-api v2.4.1"
              }
            ]
          }
        ]
      },
      {
        "kind": "relationship_tree",
        "title": "Owners of checkout-api",
        "nodes": [
          {
            "id": "1",
            "label": "Deployment/checkout-api",
            "kind": "Deployment",
            "name": "checkout-api"
          },
          {
            "id": "2",
            "label": "ReplicaSet/checkout-api-5d8f",
            "kind": "ReplicaSet",
            "name": "checkout-api-5d8f",
            "parentId": "1"
          },
          {
            "id": "3",
            "label": "Pod/checkout-api-x2k",
            "kind": "Pod",
            "name": "checkout-api-x2k",
            "parentId": "2"
          }
        ]
      },
      {
        "kind": "topology",
        "title": "Physical Topology — production",
        "layout_hint": "grouped",
        "group_by": "node",
        "nodes": [
          {
            "id": "n1",
            "kind": "Node",
            "name": "worker-0",
            "status": "healthy",
            "group": "worker-0"
          },
          {
            "id": "p1",
            "kind": "Pod",
            "name": "checkout-api-x2k",
            "namespace": "production",
            "status": "healthy",
            "group": "worker-0"
          },
          {
            "id": "p2",
            "kind": "Pod",
            "name": "cache-7f9",
            "namespace": "production",
            "status": "error",
            "group": "worker-0"
          }
        ],
        "edges": [
          {
            "source": "p1",
            "target": "n1",
            "type": "runs_on"
          },
          {
            "source": "p2",
            "target": "n1",
            "type": "runs_on"
          }
        ]
      }
    ]
  },
  {
    "title": "Widgets 3 - Layout and incident",
    "layout": [
      {
        "kind": "status_pipeline",
        "steps": [
          "Detected",
          "Investigated",
          "Action Taken",
          "Verifying",
          "Resolved"
        ],
        "current": 2
      },
      {
        "kind": "confidence_badge",
        "score": 0.85,
        "label": "Root cause confidence"
      },
      {
        "kind": "action_button",
        "label": "Restart Deployment",
        "action": "restart_deployment",
        "action_input": {
          "name": "checkout-api",
          "namespace": "production"
        },
        "style": "danger",
        "confirm_text": "This will restart all pods."
      },
      {
        "kind": "grid",
        "title": "Saturation",
        "columns": 2,
        "items": [
          {
            "kind": "metric_card",
            "title": "CPU Usage",
            "value": "63%",
            "status": "warning"
          },
          {
            "kind": "metric_card",
            "title": "Memory Usage",
            "value": "5.1 GiB",
            "status": "healthy"
          }
        ]
      },
      {
        "kind": "tabs",
        "tabs": [
          {
            "label": "Logs",
            "components": [
              {
                "kind": "log_viewer",
                "title": "cache-7f9 logs",
                "lines": [
                  {
                    "timestamp": "10:00:01",
                    "level": "info",
                    "message": "Ready to accept connections"
                  },
                  {
                    "timestamp": "10:02:13",
                    "level": "warn",
                    "message": "maxmemory reached"
                  },
                  {
                    "timestamp": "10:02:14",
                    "level": "error",
                    "message": "OOM command not allowed"
                  }
                ]
              }
            ]
          },
          {
            "label": "Config",
            "components": [
              {
                "kind": "yaml_viewer",
                "title": "Deployment spec",
                "content": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: cache\nspec:\n  replicas: 1"
              }
            ]
          }
        ]
      },
      {
        "kind": "section",
        "title": "Remediation",
        "defaultOpen": true,
        "components": [
          {
            "kind": "resolution_tracker",
            "title": "Recovery Steps",
            "steps": [
              {
                "title": "Identify root cause",
                "status": "done",
                "detail": "OOM kill"
              },
              {
                "title": "Raise memory limit",
                "status": "running",
                "detail": "512Mi → 1Gi"
              },
              {
                "title": "Verify",
                "status": "pending"
              }
            ]
          }
        ]
      },
      {
        "kind": "blast_radius",
        "title": "Blast Radius — cache",
        "items": [
          {
            "kind_abbrev": "Svc",
            "name": "cache",
            "relationship": "Service → cache (selector)",
            "status": "degraded",
            "status_detail": "0 endpoints"
          },
          {
            "kind_abbrev": "Deploy",
            "name": "checkout-api",
            "relationship": "depends on cache:6379",
            "status": "degraded",
            "status_detail": "timeouts"
          }
        ]
      }
    ]
  }
];
