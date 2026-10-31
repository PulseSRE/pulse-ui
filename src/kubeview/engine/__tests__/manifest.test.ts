import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { parseManifest } from '../manifest';

const CM = `apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
data:
  release: 2024-01-15
  enabled: yes
  legacy: no
  mode: on
  other: off
`;

describe('parseManifest', () => {
  it('keeps unquoted dates and yes/no/on/off as the strings they were written as', () => {
    const { documents, errors } = parseManifest(CM, 'team-a');
    expect(errors).toEqual([]);
    expect(documents[0].object.data).toEqual({ release: '2024-01-15', enabled: 'yes', legacy: 'no', mode: 'on', other: 'off' });
    // What is POSTed is JSON of the object: no Date, no booleans.
    expect(JSON.parse(JSON.stringify(documents[0].object)).data.release).toBe('2024-01-15');
  });

  it('the YAML sent for a dry run reads back as the same strings under YAML 1.1 rules', () => {
    const { documents } = parseManifest(CM);
    const reread = load(documents[0].yaml) as { data: Record<string, unknown> };
    expect(reread.data).toEqual({ release: '2024-01-15', enabled: 'yes', legacy: 'no', mode: 'on', other: 'off' });
  });

  it('resolves cluster-scoped kinds without a namespace and namespaced ones with the default', () => {
    const { documents } = parseManifest('apiVersion: v1\nkind: Namespace\nmetadata:\n  name: a\n---\n' + CM, 'team-a');
    expect(documents.map((d) => d.createPath)).toEqual(['/api/v1/namespaces', '/api/v1/namespaces/team-a/configmaps']);
  });
});
