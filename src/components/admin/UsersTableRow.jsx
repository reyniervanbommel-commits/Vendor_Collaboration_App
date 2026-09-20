import React, { memo } from 'react';
import {
  Badge,
  Text,
  TableCell,
  TableRow,
  makeStyles,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import { CheckmarkCircle24Regular, Circle24Regular } from '@fluentui/react-icons';
import { UserSecurityActions } from './UserSecurityActions';
import { ROLES } from '../../constants/roles';

const useStyles = makeStyles({
  permBadge: { cursor: 'default' },
  permissionStateCell: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px') },
  permissionOn: { color: tokens.colorPaletteGreenForeground1, display: 'inline-flex', alignItems: 'center' },
  permissionOff: { color: tokens.colorPaletteRedForeground1, display: 'inline-flex', alignItems: 'center' },
  permissionBadges: { display: 'flex', flexWrap: 'wrap', ...shorthands.gap('4px') },
  muted: { color: tokens.colorNeutralForeground3, fontStyle: 'italic' },
  updated: {
    animationName: {
      from: { backgroundColor: tokens.colorPaletteGreenBackground1 },
      to: { backgroundColor: 'transparent' },
    },
    animationDuration: '1.5s',
    animationTimingFunction: 'ease-out',
  },
});

/**
 * Eén rij in de gebruikerstabel.
 *
 * @param {object} props
 * @param {object} props.user
 * @param {{ hasAccess: boolean, statusLabel: string, badges: string[], emptyLabel: string }} props.access
 * @param {boolean} props.isUpdated markeer de rij kort na een wijziging
 * @param {boolean} props.isAdmin is de kijkende gebruiker admin
 * @param {number} [props.currentUserId]
 * @param {object} props.actions gebundelde handlers, gememoizeerd door de parent
 */
function UsersTableRow({ user, access, isUpdated, isAdmin, currentUserId, actions }) {
  const styles = useStyles();
  const highlight = isUpdated ? styles.updated : undefined;

  return (
    <TableRow>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        <Badge appearance={user.role === ROLES.ADMIN ? 'filled' : 'outline'}>{user.role}</Badge>
      </TableCell>
      <TableCell>
        {user.role === ROLES.SUPPLIER ? (
          <Text size={200} className={user.vendor_account ? undefined : styles.muted}>
            {user.vendor_account || 'email prefix'}
          </Text>
        ) : (
          <Text size={200} className={styles.muted}>—</Text>
        )}
      </TableCell>
      <TableCell>
        {user.is_locked && <Badge appearance="filled" color="danger">Locked</Badge>}
        {!user.is_locked && <Badge appearance="outline" color="success">Active</Badge>}
        {user.must_set_password && <Badge appearance="outline" color="warning">Set password</Badge>}
        {user.mfa_required && <Badge appearance="filled" color="brand">MFA required</Badge>}
        {user.mfa_enabled && <Badge appearance="outline" color="success">MFA active</Badge>}
      </TableCell>
      <TableCell className={highlight}>
        <div className={styles.permissionStateCell}>
          <span className={access.hasAccess ? styles.permissionOn : styles.permissionOff}>
            {access.hasAccess ? <CheckmarkCircle24Regular /> : <Circle24Regular />}
          </span>
          <Text size={200}>{access.statusLabel}</Text>
        </div>
      </TableCell>
      <TableCell className={highlight}>
        {access.badges.length > 0 ? (
          <div className={styles.permissionBadges}>
            {access.badges.map((label) => (
              <Badge key={label} appearance="tint" color="brand" size="small" className={styles.permBadge}>
                {label}
              </Badge>
            ))}
          </div>
        ) : (
          <Text size={200} className={styles.muted}>{access.emptyLabel}</Text>
        )}
      </TableCell>
      <TableCell>
        <UserSecurityActions
          user={user}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onEditPermissions={actions.onEditPermissions}
          onEditVendorAccount={actions.onEditVendorAccount}
          onEditRole={actions.onEditRole}
          onLockToggle={actions.onLockToggle}
          onMfaRequiredToggle={actions.onMfaRequiredToggle}
          onForceReset={actions.onForceReset}
          onDeleteClick={actions.onDeleteClick}
        />
      </TableCell>
    </TableRow>
  );
}

export default memo(UsersTableRow);
