import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Page,
  Masthead,
  MastheadToggle,
  MastheadMain,
  MastheadBrand,
  MastheadContent,
  PageSidebar,
  PageSidebarBody,
  Nav,
  NavList,
  NavItem,
  NavExpandable,
  PageToggleButton,
  Button,
  Avatar,
  Badge,
  Select,
  SelectOption,
  MenuToggle,
  Tooltip,
} from '@patternfly/react-core';
import {
  BarsIcon,
  BellIcon,
  CogIcon,
  SearchIcon,
  MoonIcon,
  SunIcon,
  HomeIcon,
  CubeIcon,
  MonitoringIcon,
  ServerIcon,
  UsersIcon,
  CodeIcon,
  SecurityIcon,
} from '@patternfly/react-icons';
import type { ThemeName } from './ThemePicker';
import ThemePicker from './ThemePicker';
import CommandPalette from './CommandPalette';
import ToastProvider from './ToastProvider';
import PageTransition from './PageTransition';
import QuickStartGuide from './QuickStartGuide';
import WebTerminal from './WebTerminal';
import { useUIStore } from '@/store/useUIStore';
import { useClusterStore } from '@/store/useClusterStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

const sectionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: HomeIcon,
  applications: CubeIcon,
  observe: MonitoringIcon,
  cluster: ServerIcon,
  security: SecurityIcon,
  access: UsersIcon,
};

const navigation = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    children: [
      { id: 'overview', name: 'Overview', href: '/home/overview' },
      { id: 'topology', name: 'Topology', href: '/home/topology' },
      { id: 'search', name: 'Search', href: '/home/search' },
      { id: 'troubleshoot', name: 'Troubleshoot', href: '/home/troubleshoot' },
    ],
  },
  {
    id: 'applications',
    name: 'Applications',
    children: [
      { id: 'dev-add', name: 'Deploy New', href: '/developer/add' },
      { id: 'deployments', name: 'Deployments', href: '/workloads/deployments' },
      { id: 'pods', name: 'Pods', href: '/workloads/pods' },
      { id: 'statefulsets', name: 'StatefulSets', href: '/workloads/statefulsets' },
      { id: 'daemonsets', name: 'DaemonSets', href: '/workloads/daemonsets' },
      { id: 'jobs', name: 'Jobs', href: '/workloads/jobs' },
      { id: 'cronjobs', name: 'CronJobs', href: '/workloads/cronjobs' },
      { id: 'services', name: 'Services', href: '/networking/services' },
      { id: 'routes', name: 'Routes', href: '/networking/routes' },
      { id: 'ingress', name: 'Ingress', href: '/networking/ingress' },
      { id: 'pvcs', name: 'PVCs', href: '/storage/persistentvolumeclaims' },
      { id: 'pvs', name: 'Persistent Volumes', href: '/storage/persistentvolumes' },
      { id: 'storageclasses', name: 'Storage Classes', href: '/storage/storageclasses' },
      { id: 'secrets', name: 'Secrets', href: '/workloads/secrets' },
      { id: 'configmaps', name: 'ConfigMaps', href: '/workloads/configmaps' },
      { id: 'helm', name: 'Helm Releases', href: '/helm/releases' },
      { id: 'pipelines', name: 'Pipelines', href: '/pipelines/pipelines' },
    ],
  },
  {
    id: 'observe',
    name: 'Observe',
    children: [
      { id: 'alerts', name: 'Alerts', href: '/observe/alerts' },
      { id: 'metrics', name: 'Metrics', href: '/observe/metrics' },
      { id: 'dashboards', name: 'Dashboards', href: '/observe/dashboards' },
      { id: 'events', name: 'Events', href: '/home/events' },
      { id: 'pod-resources', name: 'Resource Usage', href: '/observe/pod-resources' },
    ],
  },
  {
    id: 'security',
    name: 'Security',
    children: [
      { id: 'security-overview', name: 'Overview', href: '/security/overview' },
      { id: 'rbac-audit', name: 'RBAC Audit', href: '/security/rbac-audit' },
      { id: 'network-policies', name: 'Network Policies', href: '/security/network-policies' },
      { id: 'pod-security', name: 'Pod Security', href: '/security/pod-security' },
      { id: 'secret-rotation', name: 'Secret Rotation', href: '/security/secret-rotation' },
      { id: 'certificates', name: 'Certificates', href: '/operations/certificates' },
    ],
  },
  {
    id: 'cluster',
    name: 'Cluster',
    children: [
      { id: 'nodes', name: 'Nodes', href: '/compute/nodes' },
      { id: 'machines', name: 'Machines', href: '/compute/machines' },
      { id: 'operators', name: 'Operators', href: '/operators/installed' },
      { id: 'operatorhub', name: 'OperatorHub', href: '/operators/operatorhub' },
      { id: 'cluster-settings', name: 'Settings & Updates', href: '/administration/cluster-settings' },
    ],
  },
  {
    id: 'access',
    name: 'Access Control',
    children: [
      { id: 'namespaces', name: 'Namespaces', href: '/administration/namespaces' },
      { id: 'roles', name: 'Roles', href: '/administration/roles' },
      { id: 'rolebindings', name: 'Role Bindings', href: '/administration/rolebindings' },
      { id: 'serviceaccounts', name: 'Service Accounts', href: '/administration/serviceaccounts' },
      { id: 'oauth', name: 'OAuth', href: '/administration/oauth' },
      { id: 'crds', name: 'Custom Resources', href: '/administration/crds' },
    ],
  },
];

// Resource count map (section id -> store field)
function useResourceCounts() {
  const pods = useClusterStore((s) => s.pods.length);
  const deployments = useClusterStore((s) => s.deployments.length);
  const services = useClusterStore((s) => s.services.length);
  const nodes = useClusterStore((s) => s.nodes.length);
  const namespaces = useClusterStore((s) => s.namespaces.length);
  const events = useClusterStore((s) => s.events.length);

  return {
    pods, deployments, services, nodes, namespaces, events,
  } as Record<string, number>;
}

function NotificationsDropdown() {
  const navigate = useNavigate();
  const events = useClusterStore((s) => s.events);
  const warningCount = events.filter((e) => e.type === 'Warning' || e.type === 'Error').length;
  const [open, setOpen] = React.useState(false);

  return (
    <span className="os-notifications__wrapper">
      <Button
        aria-label="Notifications"
        variant="plain"
        icon={<BellIcon />}
        onClick={() => setOpen(!open)}
      />
      {warningCount > 0 && (
        <Badge className="compass-notification-badge">{warningCount}</Badge>
      )}
      {open && (
        <>
          <div className="os-notifications__backdrop" onClick={() => setOpen(false)} />
          <div className="os-notifications__dropdown">
            <div className="os-notifications__header">
              <strong className="os-notifications__title">Notifications</strong>
              <span
                className="os-notifications__view-all"
                onClick={() => { setOpen(false); navigate('/home/events'); }}
              >
                View all
              </span>
            </div>
            {events.length === 0 ? (
              <div className="os-notifications__empty">
                No recent notifications
              </div>
            ) : (
              events.slice(0, 10).map((event, i) => {
                const dotColor = event.type === 'Warning' ? '#f0ab00' : event.type === 'Error' ? '#c9190b' : '#3e8635';
                return (
                  <div
                    key={`${event.timestamp}-${i}`}
                    className="os-notifications__item"
                    onClick={() => { setOpen(false); navigate('/home/events'); }}
                  >
                    <span className="os-notifications__dot" style={{ '--os-dot-color': dotColor, background: 'var(--os-dot-color)' } as React.CSSProperties} />
                    <div className="os-notifications__item-body">
                      <div className="os-notifications__item-header">
                        <strong className="os-notifications__item-reason">{event.reason}</strong>
                        <span className="os-notifications__item-time">
                          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="os-notifications__item-message">
                        {event.message}
                      </div>
                      <div className="os-notifications__item-namespace">
                        {event.namespace}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </span>
  );
}

export default function CompassLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [expandedItems, setExpandedItems] = React.useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = React.useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) return saved === 'true';
    return true; // Default to dark mode
  });
  const [currentTheme, setCurrentTheme] = React.useState<ThemeName>(() => {
    const saved = localStorage.getItem('theme') as ThemeName;
    return saved || 'sunset';
  });

  // Namespace selector
  const storeNamespaces = useClusterStore((s) => s.namespaces);
  const selectedNamespace = useClusterStore((s) => s.selectedNamespace);
  const setSelectedNamespace = useClusterStore((s) => s.setSelectedNamespace);
  const [nsSelectOpen, setNsSelectOpen] = React.useState(false);
  const [terminalOpen, setTerminalOpen] = React.useState(false);
  const [terminalHeight, setTerminalHeight] = React.useState(350);
  const [guideOpen, setGuideOpen] = React.useState(false);

  const counts = useResourceCounts();

  useKeyboardShortcuts();

  React.useEffect(() => {
    const currentSection = navigation.find((section) =>
      section.children?.some((child) => location.pathname.startsWith(child.href))
    );
    if (currentSection && !expandedItems.includes(currentSection.id)) {
      setExpandedItems([...expandedItems, currentSection.id]);
    }
  }, [location.pathname]);

  React.useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', String(isDarkMode));
  }, [isDarkMode]);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
  }, [currentTheme]);

  const onNavSelect = (
    _event: React.FormEvent<HTMLInputElement>,
    result: { itemId: string | number }
  ) => {
    const itemId = result.itemId.toString();
    for (const section of navigation) {
      const child = section.children?.find((item) => item.id === itemId);
      if (child) {
        navigate(child.href);
        return;
      }
    }
  };

  const onToggle = (groupId: string) => {
    setExpandedItems((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const isItemActive = (href: string) => location.pathname.startsWith(href);

  const Header = (
    <Masthead>
      <MastheadToggle>
        <PageToggleButton
          variant="plain"
          aria-label="Global navigation"
          onSidebarToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          isSidebarOpen={isSidebarOpen}
        >
          <BarsIcon />
        </PageToggleButton>
      </MastheadToggle>
      <MastheadMain>
        <MastheadBrand>
          <div className="os-masthead__brand">
            <div className="os-masthead__logo">
              O
            </div>
            <span className="os-masthead__product-name">
              <span className="os-masthead__product-name--vendor">Red Hat</span> OpenShift
            </span>
          </div>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <span className="os-masthead__actions">
          {/* Namespace Selector */}
          <Select
            id="namespace-select"
            isOpen={nsSelectOpen}
            selected={selectedNamespace}
            onSelect={(_event, selection) => {
              setSelectedNamespace(selection as string);
              setNsSelectOpen(false);
            }}
            onOpenChange={(isOpen) => setNsSelectOpen(isOpen)}
            toggle={(toggleRef) => (
              <MenuToggle ref={toggleRef} onClick={() => setNsSelectOpen(!nsSelectOpen)} className="os-masthead__ns-toggle">
                {selectedNamespace === 'all' ? 'All Namespaces' : selectedNamespace}
              </MenuToggle>
            )}
          >
            <SelectOption value="all">All Namespaces</SelectOption>
            {storeNamespaces.map((ns) => (
              <SelectOption key={ns.name} value={ns.name}>{ns.name}</SelectOption>
            ))}
          </Select>

          <Tooltip content="Search (⌘K)">
            <Button
              aria-label="Search (Cmd+K)"
              variant="plain"
              icon={<SearchIcon />}
              onClick={openCommandPalette}
            />
          </Tooltip>
          <NotificationsDropdown />
          <ThemePicker currentTheme={currentTheme} onThemeChange={(theme) => setCurrentTheme(theme)} />
          <Tooltip content={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            <Button
              aria-label="Toggle dark mode"
              variant="plain"
              icon={isDarkMode ? <SunIcon /> : <MoonIcon />}
              onClick={() => setIsDarkMode(!isDarkMode)}
            />
          </Tooltip>
          <Tooltip content="Web Terminal">
            <Button aria-label="Web Terminal" variant="plain" icon={<CodeIcon />} onClick={() => setTerminalOpen(!terminalOpen)} />
          </Tooltip>
          <Tooltip content="Quick Start Guide">
            <Button aria-label="Quick Start Guide" variant="plain" icon={<CogIcon />} onClick={() => setGuideOpen(true)} />
          </Tooltip>

          {/* Connection Status */}
          <span className="compass-connection-pill os-masthead__connection-pill">
            <span className="compass-connection-dot" />
            Connected
          </span>

          <Avatar alt="" className="os-masthead__avatar" />
        </span>
      </MastheadContent>
    </Masthead>
  );

  const Sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen} className={sidebarCollapsed ? 'compass-sidebar--collapsed' : ''}>
      <PageSidebarBody>
        <Nav onSelect={onNavSelect} aria-label="Global navigation">
          <NavList>
            {navigation.map((section) => {
              const SectionIcon = sectionIcons[section.id];
              return (
                <NavExpandable
                  key={section.id}
                  title={
                    <span className="os-nav__section-title">
                      {SectionIcon && <SectionIcon />}
                      <span className="os-nav__section-name">{section.name}</span>
                    </span>
                  }
                  groupId={section.id}
                  isExpanded={expandedItems.includes(section.id)}
                  onExpand={() => onToggle(section.id)}
                >
                  {section.children?.map((item) => (
                    <NavItem
                      key={item.id}
                      itemId={item.id}
                      isActive={isItemActive(item.href)}
                    >
                      <span className="os-nav__item-row">
                        <span>{item.name}</span>
                        {(counts[item.id] ?? 0) > 0 && (
                          <Badge isRead className="os-nav__item-badge">{counts[item.id] ?? 0}</Badge>
                        )}
                      </span>
                    </NavItem>
                  ))}
                </NavExpandable>
              );
            })}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page masthead={Header} sidebar={Sidebar} isManagedSidebar>
      <CommandPalette />
      <ToastProvider />
      <QuickStartGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <PageTransition>
          <Outlet />
        </PageTransition>
      </div>
      <WebTerminal open={terminalOpen} onClose={() => setTerminalOpen(false)} onHeightChange={setTerminalHeight} />
    </Page>
  );
}
