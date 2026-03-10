import {
  PageSection,
  Title,
  Card,
  CardBody,
  Gallery,
  GalleryItem,
  Button,
} from '@patternfly/react-core';
import { useUIStore } from '@/store/useUIStore';

interface AddOption {
  title: string;
  description: string;
}

const addOptions: AddOption[] = [
  { title: 'From Git', description: 'Import code from a Git repository to be built and deployed' },
  { title: 'Container Image', description: 'Deploy an existing image from an image registry' },
  { title: 'From Dockerfile', description: 'Import your Dockerfile from a Git repository to be built and deployed' },
  { title: 'From Catalog', description: 'Browse the developer catalog to deploy applications and services' },
  { title: 'YAML', description: 'Create resources from their YAML or JSON definitions' },
  { title: 'Helm Chart', description: 'Browse the catalog to discover and install Helm Charts' },
  { title: 'Operator Backed', description: 'Browse the catalog to discover and deploy operator managed services' },
];

export default function AddPage() {
  const addToast = useUIStore((s) => s.addToast);

  return (
    <>
      <PageSection variant="default">
        <Title headingLevel="h1" size="2xl">+Add</Title>
        <p className="os-list__description">
          Add resources to your project
        </p>
      </PageSection>

      <PageSection>
        <Gallery hasGutter minWidths={{ default: '100%', sm: '280px', md: '300px' }}>
          {addOptions.map((option) => (
            <GalleryItem key={option.title}>
              <Card isFullHeight className="os-operatorhub__card">
                <CardBody>
                  <div className="os-operatorhub__card-header">
                    <div className="os-operatorhub__icon">
                      {option.title.charAt(0).toUpperCase()}
                    </div>
                    <div className="os-operatorhub__info">
                      <div className="os-operatorhub__name">{option.title}</div>
                    </div>
                  </div>
                  <p className="os-operatorhub__card-desc">
                    {option.description}
                  </p>
                  <div className="os-operatorhub__card-footer">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => addToast({
                        type: 'info',
                        title: `${option.title} selected`,
                        description: `Opening ${option.title} workflow`,
                      })}
                    >
                      Select
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </GalleryItem>
          ))}
        </Gallery>
      </PageSection>
    </>
  );
}
