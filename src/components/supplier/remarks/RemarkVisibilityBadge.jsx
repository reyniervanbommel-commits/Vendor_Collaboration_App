import React, { memo } from 'react';
import { Badge } from '@fluentui/react-components';
import { EyeRegular, LockClosedRegular } from '@fluentui/react-icons';

// Alleen admin/supply_chain krijgen `visibility` van de server; anders rendert dit niets.
function RemarkVisibilityBadge({ visibility }) {
  if (!visibility) return null;
  return visibility === 'internal' ? (
    <Badge appearance="filled" color="warning" icon={<LockClosedRegular />}>Internal</Badge>
  ) : (
    <Badge appearance="filled" color="brand" icon={<EyeRegular />}>Vendor</Badge>
  );
}

export default memo(RemarkVisibilityBadge);
