import React from 'react';
import { Server, Shield, HeartPulse, Eye, Wrench, GitBranch, type LucideIcon } from 'lucide-react';
import { GateCard } from '../GateCard';
import type { CategoryView, ReadinessCategory, Waiver } from '../types';

const CATEGORY_ICON: Record<ReadinessCategory, LucideIcon> = {
  prerequisites: Server,
  security: Shield,
  reliability: HeartPulse,
  observability: Eye,
  operations: Wrench,
  gitops: GitBranch,
};

interface Props {
  category: CategoryView;
  onReVerify?: (gateId: string) => void;
  onWaive?: (gateId: string) => void;
  waivers?: Record<string, Waiver>;
  onUnwaive?: (gateId: string) => void | Promise<void>;
}

/** Generic step component that renders a category header + its gate cards. */
export function CategoryStep({ category, onReVerify, onWaive, waivers, onUnwaive }: Props) {
  const Icon = CATEGORY_ICON[category.id];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
          <Icon className="w-5 h-5 text-blue-400" />
          {category.label}
        </h3>
        <p className="text-sm text-slate-400 mt-1">{category.description}</p>
      </div>
      <div className="space-y-2">
        {category.gates.map((gate) => (
          <GateCard
            key={gate.id}
            gate={gate}
            result={category.results[gate.id]}
            onReVerify={onReVerify}
            onWaive={onWaive}
            waiver={waivers?.[gate.id]}
            onUnwaive={onUnwaive}
          />
        ))}
      </div>
    </div>
  );
}
