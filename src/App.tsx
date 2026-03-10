import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CompassLayout from './components/CompassLayout';
import ErrorBoundary from './components/ErrorBoundary';
import GenericResourceDetail from './pages/GenericResourceDetail';

// Home
import Overview from './pages/home/Overview';
import Search from './pages/home/Search';
import Events from './pages/home/Events';
import Topology from './pages/home/Topology';

// Operators
import OperatorHub from './pages/operators/OperatorHub';
import InstalledOperators from './pages/operators/InstalledOperators';

// Workloads
import Pods from './pages/workloads/Pods';
import PodDetail from './pages/workloads/PodDetail';
import Deployments from './pages/workloads/Deployments';
import DeploymentDetail from './pages/workloads/DeploymentDetail';
import StatefulSets from './pages/workloads/StatefulSets';
import DaemonSets from './pages/workloads/DaemonSets';
import ReplicaSets from './pages/workloads/ReplicaSets';
import Jobs from './pages/workloads/Jobs';
import CronJobs from './pages/workloads/CronJobs';
import Secrets from './pages/workloads/Secrets';
import ConfigMaps from './pages/workloads/ConfigMaps';
import HPA from './pages/workloads/HPA';
import PodDisruptionBudgets from './pages/workloads/PodDisruptionBudgets';

// Networking
import Services from './pages/networking/Services';
import RoutesPage from './pages/networking/Routes';
import Ingress from './pages/networking/Ingress';
import NetworkPolicies from './pages/networking/NetworkPolicies';
import Endpoints from './pages/networking/Endpoints';

// Storage
import PersistentVolumes from './pages/storage/PersistentVolumes';
import PersistentVolumeClaims from './pages/storage/PersistentVolumeClaims';
import StorageClasses from './pages/storage/StorageClasses';

// Builds
import Builds from './pages/builds/Builds';
import BuildConfigs from './pages/builds/BuildConfigs';
import ImageStreams from './pages/builds/ImageStreams';

// Observe
import Dashboards from './pages/observe/Dashboards';
import Metrics from './pages/observe/Metrics';
import Alerts from './pages/observe/Alerts';

// Compute
import Nodes from './pages/compute/Nodes';
import NodeDetail from './pages/workloads/NodeDetail';
import Machines from './pages/compute/Machines';

// Developer
import DeveloperOverview from './pages/developer/DeveloperOverview';
import AddPage from './pages/developer/AddPage';
import GitImport from './pages/developer/GitImport';

// Helm
import HelmReleases from './pages/helm/HelmReleases';
import HelmCharts from './pages/helm/HelmCharts';

// Pipelines
import Pipelines from './pages/pipelines/Pipelines';
import PipelineRuns from './pages/pipelines/PipelineRuns';
import TaskRuns from './pages/pipelines/TaskRuns';

// Serverless
import KnativeServices from './pages/serverless/KnativeServices';
import KnativeRevisions from './pages/serverless/KnativeRevisions';

// Security
import SecurityOverview from './pages/security/SecurityOverview';
import NetworkPolicyVisualization from './pages/security/NetworkPolicyVisualization';
import RBACAudit from './pages/security/RBACAudit';
import SecretRotation from './pages/security/SecretRotation';
import PodSecurityStandards from './pages/security/PodSecurityStandards';

// Operations
import NodeMaintenance from './pages/operations/NodeMaintenance';
import PVCResize from './pages/operations/PVCResize';
import HPARecommendations from './pages/operations/HPARecommendations';
import CertificateManagement from './pages/operations/CertificateManagement';
import NodeScaling from './pages/operations/NodeScaling';

// Observe (new)
import PodResources from './pages/observe/PodResources';
import NamespaceConsumption from './pages/observe/NamespaceConsumption';
import AlertRules from './pages/observe/AlertRules';
import ClusterHealth from './pages/observe/ClusterHealth';

// Administration
import ClusterSettings from './pages/administration/ClusterSettings';
import Namespaces from './pages/administration/Namespaces';
import CRDInstances from './pages/administration/CRDInstances';
import CRInstanceDetail from './pages/administration/CRInstanceDetail';
import Roles from './pages/administration/Roles';
import RoleBindings from './pages/administration/RoleBindings';
import ServiceAccounts from './pages/administration/ServiceAccounts';
import ResourceQuotas from './pages/administration/ResourceQuotas';
import LimitRanges from './pages/administration/LimitRanges';
import CustomResourceDefinitions from './pages/administration/CustomResourceDefinitions';
import ClusterOperators from './pages/administration/ClusterOperators';
import OAuth from './pages/administration/OAuth';

function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CompassLayout />}>
          <Route index element={<Navigate to="/home/overview" replace />} />

          {/* Home */}
          <Route path="home">
            <Route path="overview" element={<Overview />} />
            <Route path="search" element={<Search />} />
            <Route path="events" element={<Events />} />
            <Route path="topology" element={<Topology />} />
          </Route>

          {/* Operators */}
          <Route path="operators">
            <Route path="operatorhub" element={<OperatorHub />} />
            <Route path="installed" element={<InstalledOperators />} />
            <Route path="installed/:namespace/:name" element={
              <GenericResourceDetail
                kind="ClusterServiceVersion"
                apiPath={(p) => `/apis/operators.coreos.com/v1alpha1/namespaces/${p.namespace}/clusterserviceversions/${p.name}`}
                backPath="/operators/installed"
                backLabel="Installed Operators"
                statusField={['status', 'phase']}
              />
            } />
          </Route>

          {/* Workloads */}
          <Route path="workloads">
            <Route path="pods" element={<Pods />} />
            <Route path="pods/:namespace/:name" element={<PodDetail />} />
            <Route path="deployments" element={<Deployments />} />
            <Route path="deployments/:namespace/:name" element={<DeploymentDetail />} />
            <Route path="statefulsets" element={<StatefulSets />} />
            <Route path="statefulsets/:namespace/:name" element={
              <GenericResourceDetail
                kind="StatefulSet"
                apiPath={(p) => `/apis/apps/v1/namespaces/${p.namespace}/statefulsets/${p.name}`}
                backPath="/workloads/statefulsets"
                backLabel="StatefulSets"
                statusField={['status', 'readyReplicas']}
              />
            } />
            <Route path="replicasets" element={<ReplicaSets />} />
            <Route path="replicasets/:namespace/:name" element={
              <GenericResourceDetail
                kind="ReplicaSet"
                apiPath={(p) => `/apis/apps/v1/namespaces/${p.namespace}/replicasets/${p.name}`}
                backPath="/workloads/replicasets"
                backLabel="ReplicaSets"
              />
            } />
            <Route path="daemonsets" element={<DaemonSets />} />
            <Route path="daemonsets/:namespace/:name" element={
              <GenericResourceDetail
                kind="DaemonSet"
                apiPath={(p) => `/apis/apps/v1/namespaces/${p.namespace}/daemonsets/${p.name}`}
                backPath="/workloads/daemonsets"
                backLabel="DaemonSets"
              />
            } />
            <Route path="hpa" element={<HPA />} />
            <Route path="hpa/:namespace/:name" element={
              <GenericResourceDetail
                kind="HorizontalPodAutoscaler"
                apiPath={(p) => `/apis/autoscaling/v2/namespaces/${p.namespace}/horizontalpodautoscalers/${p.name}`}
                backPath="/workloads/hpa"
                backLabel="Horizontal Pod Autoscalers"
              />
            } />
            <Route path="poddisruptionbudgets" element={<PodDisruptionBudgets />} />
            <Route path="poddisruptionbudgets/:namespace/:name" element={
              <GenericResourceDetail
                kind="PodDisruptionBudget"
                apiPath={(p) => `/apis/policy/v1/namespaces/${p.namespace}/poddisruptionbudgets/${p.name}`}
                backPath="/workloads/poddisruptionbudgets"
                backLabel="Pod Disruption Budgets"
              />
            } />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:namespace/:name" element={
              <GenericResourceDetail
                kind="Job"
                apiPath={(p) => `/apis/batch/v1/namespaces/${p.namespace}/jobs/${p.name}`}
                backPath="/workloads/jobs"
                backLabel="Jobs"
                statusField={['status', 'conditions']}
              />
            } />
            <Route path="cronjobs" element={<CronJobs />} />
            <Route path="cronjobs/:namespace/:name" element={
              <GenericResourceDetail
                kind="CronJob"
                apiPath={(p) => `/apis/batch/v1/namespaces/${p.namespace}/cronjobs/${p.name}`}
                backPath="/workloads/cronjobs"
                backLabel="CronJobs"
              />
            } />
            <Route path="secrets" element={<Secrets />} />
            <Route path="secrets/:namespace/:name" element={
              <GenericResourceDetail
                kind="Secret"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/secrets/${p.name}`}
                backPath="/workloads/secrets"
                backLabel="Secrets"
              />
            } />
            <Route path="configmaps" element={<ConfigMaps />} />
            <Route path="configmaps/:namespace/:name" element={
              <GenericResourceDetail
                kind="ConfigMap"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/configmaps/${p.name}`}
                backPath="/workloads/configmaps"
                backLabel="ConfigMaps"
              />
            } />
          </Route>

          {/* Networking */}
          <Route path="networking">
            <Route path="services" element={<Services />} />
            <Route path="services/:namespace/:name" element={
              <GenericResourceDetail
                kind="Service"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/services/${p.name}`}
                backPath="/networking/services"
                backLabel="Services"
                statusField={['spec', 'type']}
              />
            } />
            <Route path="routes" element={<RoutesPage />} />
            <Route path="routes/:namespace/:name" element={
              <GenericResourceDetail
                kind="Route"
                apiPath={(p) => `/apis/route.openshift.io/v1/namespaces/${p.namespace}/routes/${p.name}`}
                backPath="/networking/routes"
                backLabel="Routes"
              />
            } />
            <Route path="ingress" element={<Ingress />} />
            <Route path="ingress/:namespace/:name" element={
              <GenericResourceDetail
                kind="Ingress"
                apiPath={(p) => `/apis/networking.k8s.io/v1/namespaces/${p.namespace}/ingresses/${p.name}`}
                backPath="/networking/ingress"
                backLabel="Ingress"
              />
            } />
            <Route path="networkpolicies" element={<NetworkPolicies />} />
            <Route path="networkpolicies/:namespace/:name" element={
              <GenericResourceDetail
                kind="NetworkPolicy"
                apiPath={(p) => `/apis/networking.k8s.io/v1/namespaces/${p.namespace}/networkpolicies/${p.name}`}
                backPath="/networking/networkpolicies"
                backLabel="Network Policies"
              />
            } />
            <Route path="endpoints" element={<Endpoints />} />
            <Route path="endpoints/:namespace/:name" element={
              <GenericResourceDetail
                kind="Endpoints"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/endpoints/${p.name}`}
                backPath="/networking/endpoints"
                backLabel="Endpoints"
              />
            } />
          </Route>

          {/* Storage */}
          <Route path="storage">
            <Route path="persistentvolumes" element={<PersistentVolumes />} />
            <Route path="persistentvolumes/:name" element={
              <GenericResourceDetail
                kind="PersistentVolume"
                apiPath={(p) => `/api/v1/persistentvolumes/${p.name}`}
                backPath="/storage/persistentvolumes"
                backLabel="Persistent Volumes"
                statusField={['status', 'phase']}
              />
            } />
            <Route path="persistentvolumeclaims" element={<PersistentVolumeClaims />} />
            <Route path="persistentvolumeclaims/:namespace/:name" element={
              <GenericResourceDetail
                kind="PersistentVolumeClaim"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/persistentvolumeclaims/${p.name}`}
                backPath="/storage/persistentvolumeclaims"
                backLabel="Persistent Volume Claims"
                statusField={['status', 'phase']}
              />
            } />
            <Route path="storageclasses" element={<StorageClasses />} />
            <Route path="storageclasses/:name" element={
              <GenericResourceDetail
                kind="StorageClass"
                apiPath={(p) => `/apis/storage.k8s.io/v1/storageclasses/${p.name}`}
                backPath="/storage/storageclasses"
                backLabel="Storage Classes"
              />
            } />
          </Route>

          {/* Builds */}
          <Route path="builds">
            <Route path="builds" element={<Builds />} />
            <Route path="builds/:namespace/:name" element={
              <GenericResourceDetail
                kind="Build"
                apiPath={(p) => `/apis/build.openshift.io/v1/namespaces/${p.namespace}/builds/${p.name}`}
                backPath="/builds/builds"
                backLabel="Builds"
                statusField={['status', 'phase']}
              />
            } />
            <Route path="buildconfigs" element={<BuildConfigs />} />
            <Route path="buildconfigs/:namespace/:name" element={
              <GenericResourceDetail
                kind="BuildConfig"
                apiPath={(p) => `/apis/build.openshift.io/v1/namespaces/${p.namespace}/buildconfigs/${p.name}`}
                backPath="/builds/buildconfigs"
                backLabel="Build Configs"
              />
            } />
            <Route path="imagestreams" element={<ImageStreams />} />
            <Route path="imagestreams/:namespace/:name" element={
              <GenericResourceDetail
                kind="ImageStream"
                apiPath={(p) => `/apis/image.openshift.io/v1/namespaces/${p.namespace}/imagestreams/${p.name}`}
                backPath="/builds/imagestreams"
                backLabel="Image Streams"
              />
            } />
          </Route>

          {/* Developer */}
          <Route path="developer">
            <Route path="overview" element={<DeveloperOverview />} />
            <Route path="add" element={<AddPage />} />
            <Route path="git-import" element={<GitImport />} />
          </Route>

          {/* Helm */}
          <Route path="helm">
            <Route path="releases" element={<HelmReleases />} />
            <Route path="charts" element={<HelmCharts />} />
          </Route>

          {/* Pipelines */}
          <Route path="pipelines">
            <Route path="pipelines" element={<Pipelines />} />
            <Route path="pipelineruns" element={<PipelineRuns />} />
            <Route path="taskruns" element={<TaskRuns />} />
          </Route>

          {/* Serverless */}
          <Route path="serverless">
            <Route path="services" element={<KnativeServices />} />
            <Route path="revisions" element={<KnativeRevisions />} />
          </Route>

          {/* Security */}
          <Route path="security">
            <Route path="overview" element={<SecurityOverview />} />
            <Route path="network-policies" element={<NetworkPolicyVisualization />} />
            <Route path="rbac-audit" element={<RBACAudit />} />
            <Route path="secret-rotation" element={<SecretRotation />} />
            <Route path="pod-security" element={<PodSecurityStandards />} />
          </Route>

          {/* Observe */}
          <Route path="observe">
            <Route path="dashboards" element={<Dashboards />} />
            <Route path="metrics" element={<Metrics />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="alert-rules" element={<AlertRules />} />
            <Route path="pod-resources" element={<PodResources />} />
            <Route path="namespace-consumption" element={<NamespaceConsumption />} />
            <Route path="cluster-health" element={<ClusterHealth />} />
          </Route>

          {/* Operations */}
          <Route path="operations">
            <Route path="node-maintenance" element={<NodeMaintenance />} />
            <Route path="pvc-resize" element={<PVCResize />} />
            <Route path="hpa-recommendations" element={<HPARecommendations />} />
            <Route path="certificates" element={<CertificateManagement />} />
            <Route path="node-scaling" element={<NodeScaling />} />
          </Route>

          {/* Compute */}
          <Route path="compute">
            <Route path="nodes" element={<Nodes />} />
            <Route path="nodes/:name" element={<NodeDetail />} />
            <Route path="machines" element={<Machines />} />
            <Route path="machines/:namespace/:name" element={
              <GenericResourceDetail
                kind="Machine"
                apiPath={(p) => `/apis/machine.openshift.io/v1beta1/namespaces/${p.namespace}/machines/${p.name}`}
                backPath="/compute/machines"
                backLabel="Machines"
                statusField={['status', 'phase']}
              />
            } />
          </Route>

          {/* Administration */}
          <Route path="administration">
            <Route path="cluster-settings" element={<ClusterSettings />} />
            <Route path="namespaces" element={<Namespaces />} />
            <Route path="namespaces/:name" element={
              <GenericResourceDetail
                kind="Namespace"
                apiPath={(p) => `/api/v1/namespaces/${p.name}`}
                backPath="/administration/namespaces"
                backLabel="Namespaces"
                statusField={['status', 'phase']}
              />
            } />
            <Route path="roles" element={<Roles />} />
            <Route path="roles/:namespace/:name" element={
              <GenericResourceDetail
                kind="Role"
                apiPath={(p) => `/apis/rbac.authorization.k8s.io/v1/namespaces/${p.namespace}/roles/${p.name}`}
                backPath="/administration/roles"
                backLabel="Roles"
              />
            } />
            <Route path="clusterroles/:name" element={
              <GenericResourceDetail
                kind="ClusterRole"
                apiPath={(p) => `/apis/rbac.authorization.k8s.io/v1/clusterroles/${p.name}`}
                backPath="/administration/roles"
                backLabel="Roles"
              />
            } />
            <Route path="rolebindings" element={<RoleBindings />} />
            <Route path="rolebindings/:namespace/:name" element={
              <GenericResourceDetail
                kind="RoleBinding"
                apiPath={(p) => `/apis/rbac.authorization.k8s.io/v1/namespaces/${p.namespace}/rolebindings/${p.name}`}
                backPath="/administration/rolebindings"
                backLabel="Role Bindings"
              />
            } />
            <Route path="serviceaccounts" element={<ServiceAccounts />} />
            <Route path="serviceaccounts/:namespace/:name" element={
              <GenericResourceDetail
                kind="ServiceAccount"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/serviceaccounts/${p.name}`}
                backPath="/administration/serviceaccounts"
                backLabel="Service Accounts"
              />
            } />
            <Route path="resourcequotas" element={<ResourceQuotas />} />
            <Route path="resourcequotas/:namespace/:name" element={
              <GenericResourceDetail
                kind="ResourceQuota"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/resourcequotas/${p.name}`}
                backPath="/administration/resourcequotas"
                backLabel="Resource Quotas"
              />
            } />
            <Route path="limitranges" element={<LimitRanges />} />
            <Route path="limitranges/:namespace/:name" element={
              <GenericResourceDetail
                kind="LimitRange"
                apiPath={(p) => `/api/v1/namespaces/${p.namespace}/limitranges/${p.name}`}
                backPath="/administration/limitranges"
                backLabel="Limit Ranges"
              />
            } />
            <Route path="crds" element={<CustomResourceDefinitions />} />
            <Route path="crds/:name/instances" element={<CRDInstances />} />
            <Route path="crds/:name/instances/:namespace/:instanceName" element={<CRInstanceDetail />} />
            <Route path="crds/:name" element={
              <GenericResourceDetail
                kind="CustomResourceDefinition"
                apiPath={(p) => `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${p.name}`}
                backPath="/administration/crds"
                backLabel="Custom Resource Definitions"
              />
            } />
            <Route path="clusteroperators" element={<ClusterOperators />} />
            <Route path="clusteroperators/:name" element={
              <GenericResourceDetail
                kind="ClusterOperator"
                apiPath={(p) => `/apis/config.openshift.io/v1/clusteroperators/${p.name}`}
                backPath="/administration/clusteroperators"
                backLabel="Cluster Operators"
                statusField={['status', 'conditions']}
              />
            } />
            <Route path="oauth" element={<OAuth />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
