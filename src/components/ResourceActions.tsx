import React, { useState } from 'react';
import { Dropdown, DropdownList, DropdownItem, MenuToggle, Divider } from '@patternfly/react-core';
import { EllipsisVIcon } from '@patternfly/react-icons';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/useUIStore';
import ConfirmDialog from '@/components/ConfirmDialog';

const BASE = '/api/kubernetes';

interface ResourceActionsProps {
  /** Resource name */
  name: string;
  /** Resource namespace (omit for cluster-scoped) */
  namespace?: string;
  /** Full API path for DELETE, e.g. /apis/apps/v1 */
  apiBase: string;
  /** Plural resource type for the URL, e.g. "statefulsets" */
  resourceType: string;
  /** Human-readable kind, e.g. "StatefulSet" */
  kind: string;
  /** Path to detail page. If omitted, no "View Details" item is shown. */
  detailPath?: string;
  /** Callback after successful delete (e.g. to refetch the list) */
  onDelete?: () => void;
  /** Extra menu items to render above the divider */
  extraItems?: React.ReactNode;
}

export default function ResourceActions({
  name, namespace, apiBase, resourceType, kind, detailPath, onDelete, extraItems,
}: ResourceActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const addToast = useUIStore((s) => s.addToast);
  const navigate = useNavigate();

  const deletePath = namespace
    ? `${BASE}${apiBase}/namespaces/${encodeURIComponent(namespace)}/${resourceType}/${encodeURIComponent(name)}`
    : `${BASE}${apiBase}/${resourceType}/${encodeURIComponent(name)}`;

  const handleDelete = async () => {
    setDeleteOpen(false);
    try {
      const res = await fetch(deletePath, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      addToast({ type: 'success', title: `${kind} "${name}" deleted` });
      onDelete?.();
    } catch (err) {
      addToast({ type: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Dropdown
        isOpen={menuOpen}
        onOpenChange={setMenuOpen}
        toggle={(toggleRef) => (
          <MenuToggle ref={toggleRef} variant="plain" onClick={() => setMenuOpen(!menuOpen)} aria-label="Actions">
            <EllipsisVIcon />
          </MenuToggle>
        )}
        popperProps={{ position: 'right' }}
      >
        <DropdownList>
          {detailPath && (
            <DropdownItem onClick={() => { setMenuOpen(false); navigate(detailPath); }}>
              View Details
            </DropdownItem>
          )}
          {extraItems}
          <Divider />
          <DropdownItem
            onClick={() => { setMenuOpen(false); setDeleteOpen(true); }}
            className="os-namespaces__delete-action"
          >
            Delete {kind}
          </DropdownItem>
        </DropdownList>
      </Dropdown>
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title={`Delete ${kind}`}
        description={`Are you sure you want to delete ${kind} "${name}"${namespace ? ` in namespace "${namespace}"` : ''}? This action cannot be undone.`}
      />
    </span>
  );
}
