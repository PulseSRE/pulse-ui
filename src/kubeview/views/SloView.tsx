import { useState } from 'react';
import { Activity, Plus } from 'lucide-react';
import { PageHeader } from '../components/primitives/PageHeader';
import { Button } from '../components/primitives/Button';
import { SLOTab } from './toolbox/SLOTab';

export default function SloView() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader
          icon={<Activity className="w-6 h-6 text-teal-400" />}
          title="Service Level Objectives"
          subtitle="Define and track service health targets with live burn rate monitoring"
          actions={<Button size="sm" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5" /> Add SLO</Button>}
        />
        <SLOTab showAdd={adding} onShowAddChange={setAdding} />
      </div>
    </div>
  );
}
