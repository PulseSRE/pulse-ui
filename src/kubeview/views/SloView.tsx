import { Activity } from 'lucide-react';
import { PageHeader } from '../components/primitives/PageHeader';
import { SLOTab } from './toolbox/SLOTab';

export default function SloView() {
  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader
          icon={<Activity className="w-6 h-6 text-teal-400" />}
          title="Service Level Objectives"
          subtitle="Define and track service health targets with live burn rate monitoring"
        />
        <SLOTab />
      </div>
    </div>
  );
}
