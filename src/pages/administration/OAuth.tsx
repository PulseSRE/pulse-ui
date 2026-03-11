import { useState, useEffect } from 'react';
import {
  PageSection,
  Title,
  Card,
  CardBody,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Label,
} from '@patternfly/react-core';
import '@/openshift-components.css';

const BASE = '/api/kubernetes';

interface IdentityProvider {
  name: string;
  type: string;
  mappingMethod: string;
}

interface OAuthData {
  name: string;
  tokenMaxAge: string;
  tokenInactivityTimeout: string;
  identityProviders: IdentityProvider[];
  yaml: string;
}

export default function OAuth() {
  const [oauth, setOauth] = useState<OAuthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${BASE}/apis/config.openshift.io/v1/oauths/cluster`);
        if (!res.ok) throw new Error(`${res.status}`);
        const raw = await res.json() as Record<string, unknown>;
        const spec = (raw['spec'] ?? {}) as Record<string, unknown>;
        const tokenConfig = (spec['tokenConfig'] ?? {}) as Record<string, unknown>;
        const idps = ((spec['identityProviders'] ?? []) as Record<string, unknown>[]).map((idp) => ({
          name: String(idp['name'] ?? ''),
          type: String(idp['type'] ?? Object.keys(idp).find((k) => k !== 'name' && k !== 'mappingMethod') ?? 'Unknown'),
          mappingMethod: String(idp['mappingMethod'] ?? 'claim'),
        }));
        setOauth({
          name: String((raw['metadata'] as Record<string, unknown>)?.['name'] ?? 'cluster'),
          tokenMaxAge: String(tokenConfig['accessTokenMaxAgeSeconds'] ?? '-') + (tokenConfig['accessTokenMaxAgeSeconds'] ? 's' : ''),
          tokenInactivityTimeout: String(tokenConfig['accessTokenInactivityTimeout'] ?? '-'),
          identityProviders: idps,
          yaml: JSON.stringify(raw, null, 2),
        });
      } catch {
        // API may not be available
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="os-text-muted" role="status">Loading...</div>;

  return (
    <>
      <PageSection variant="default">
        <Title headingLevel="h1" size="2xl">OAuth</Title>
        <p className="os-list__description">
          Cluster OAuth configuration and identity providers
        </p>
      </PageSection>

      <PageSection>
        <Card className="pf-v5-u-mb-lg">
          <CardBody>
            <Title headingLevel="h3" size="lg" className="pf-v5-u-mb-md">OAuth Server Configuration</Title>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>API Version</DescriptionListTerm>
                <DescriptionListDescription>config.openshift.io/v1</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Kind</DescriptionListTerm>
                <DescriptionListDescription>OAuth</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Name</DescriptionListTerm>
                <DescriptionListDescription>{oauth?.name ?? 'cluster'}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Token Max Age</DescriptionListTerm>
                <DescriptionListDescription>{oauth?.tokenMaxAge ?? '-'}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Token Inactivity Timeout</DescriptionListTerm>
                <DescriptionListDescription>{oauth?.tokenInactivityTimeout ?? '-'}</DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </CardBody>
        </Card>

        <Card className="pf-v5-u-mb-lg">
          <CardBody>
            <Title headingLevel="h3" size="lg" className="pf-v5-u-mb-md">
              Identity Providers ({oauth?.identityProviders.length ?? 0})
            </Title>
            {(!oauth || oauth.identityProviders.length === 0) ? (
              <div className="os-text-muted">No identity providers configured.</div>
            ) : (
              oauth.identityProviders.map((idp) => (
                <Card key={idp.name} className="pf-v5-u-mb-sm" isPlain>
                  <CardBody>
                    <DescriptionList isHorizontal>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Name</DescriptionListTerm>
                        <DescriptionListDescription>
                          <strong>{idp.name}</strong>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Type</DescriptionListTerm>
                        <DescriptionListDescription>
                          <Label color="blue">{idp.type}</Label>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Mapping Method</DescriptionListTerm>
                        <DescriptionListDescription>{idp.mappingMethod}</DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              ))
            )}
          </CardBody>
        </Card>

        {oauth?.yaml && (
          <Card>
            <CardBody>
              <Title headingLevel="h3" size="lg" className="pf-v5-u-mb-md">YAML</Title>
              <pre className="os-yaml-editor__pre">{oauth.yaml}</pre>
            </CardBody>
          </Card>
        )}
      </PageSection>
    </>
  );
}
