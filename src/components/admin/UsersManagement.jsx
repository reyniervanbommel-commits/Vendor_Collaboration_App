import React from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Text,
  MessageBar,
  MessageBarBody,
  Input,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHeader,
  TableHeaderCell,
  Badge,
  shorthands,
} from '@fluentui/react-components';
import {
  CheckmarkCircle24Regular,
  Circle24Regular,
  Search24Regular,
} from '@fluentui/react-icons';
import CreateUserDialog from './CreateUserDialog';
import EditPermissionsDialog from './EditPermissionsDialog';
import EditVendorAccountDialog from './EditVendorAccountDialog';
import EditRoleDialog from './EditRoleDialog';
import SupplierFilterColumnSelect from './SupplierFilterColumnSelect';
import { UserSecurityActions } from './UserSecurityActions';
import { useUsersManagement } from '../../hooks/useUsersManagement';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants/roles';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', ...shorthands.gap('16px') },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  table: { width: '100%' },
  permBadge: { cursor: 'default' },
  permissionStateCell: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px') },
  permissionOn: { color: tokens.colorPaletteGreenForeground1, display: 'inline-flex', alignItems: 'center' },
  permissionOff: { color: tokens.colorPaletteRedForeground1, display: 'inline-flex', alignItems: 'center' },
  permissionBadges: { display: 'flex', flexWrap: 'wrap', ...shorthands.gap('4px') },
  noPerms: { color: tokens.colorNeutralForeground3, fontStyle: 'italic' },
  permUpdated: {
    animationName: {
      from: { backgroundColor: tokens.colorPaletteGreenBackground1 },
      to: { backgroundColor: 'transparent' },
    },
    animationDuration: '1.5s',
    animationTimingFunction: 'ease-out',
  },
});

export default function UsersManagement() {
  const styles = useStyles();
  const {
    filteredUsers,
    userPermissions,
    loading,
    error,
    searchTerm,
    setSearchTerm,
    createDialogOpen,
    setCreateDialogOpen,
    permDialogUser,
    permDialogOpen,
    setPermDialogOpen,
    deleteDialogUser,
    deleteDialogOpen,
    setDeleteDialogOpen,
    vendorDialogUser,
    vendorDialogOpen,
    setVendorDialogOpen,
    roleDialogUser,
    roleDialogOpen,
    setRoleDialogOpen,
    recentlyUpdatedUserId,
    resetMessage,
    setResetMessage,
    loadUsers,
    handleLockToggle,
    handleMfaRequiredToggle,
    handleForceReset,
    handleDeleteClick,
    handleDeleteConfirm,
    handleEditPermissions,
    handleEditVendorAccount,
    handleVendorAccountSave,
    handleEditRole,
    handleRoleSave,
    handlePermissionsSaved,
    getDisplayPermissions,
  } = useUsersManagement();
  const { user: currentUser } = useAuth();

  if (loading) return <Text>Loading...</Text>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">User management</Text>
        <CreateUserDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onUserCreated={loadUsers}
        />
      </div>

      <SupplierFilterColumnSelect />

      <Input
        placeholder="Search by email or role..."
        value={searchTerm}
        onChange={(_, d) => setSearchTerm(d.value)}
        contentBefore={<Search24Regular />}
        style={{ minWidth: '280px', maxWidth: '360px' }}
      />

      {error && (
        <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>
      )}
      {resetMessage && (
        <MessageBar intent="success">
          <MessageBarBody>{resetMessage}</MessageBarBody>
          <Button appearance="subtle" size="small" onClick={() => setResetMessage('')}>Close</Button>
        </MessageBar>
      )}

      <Table className={styles.table}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Email</TableHeaderCell>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Vendor</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Permissions</TableHeaderCell>
            <TableHeaderCell>Page access</TableHeaderCell>
            <TableHeaderCell>Actions</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredUsers.map((user) => {
            const rawPermissions = userPermissions[user.id] || [];
            const displayPermissions = getDisplayPermissions(rawPermissions);
            const isUpdated = recentlyUpdatedUserId === user.id;

            return (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge appearance={user.role === ROLES.ADMIN ? 'filled' : 'outline'}>{user.role}</Badge>
                </TableCell>
                <TableCell>
                  {user.role === ROLES.SUPPLIER ? (
                    <Text size={200} className={user.vendor_account ? undefined : styles.noPerms}>
                      {user.vendor_account || 'email prefix'}
                    </Text>
                  ) : (
                    <Text size={200} className={styles.noPerms}>—</Text>
                  )}
                </TableCell>
                <TableCell>
                  {user.is_locked && <Badge appearance="filled" color="danger">Locked</Badge>}
                  {!user.is_locked && <Badge appearance="outline" color="success">Active</Badge>}
                  {user.must_set_password && <Badge appearance="outline" color="warning">Set password</Badge>}
                  {user.mfa_required && <Badge appearance="filled" color="brand">MFA required</Badge>}
                  {user.mfa_enabled && <Badge appearance="outline" color="success">MFA active</Badge>}
                </TableCell>
                <TableCell className={isUpdated ? styles.permUpdated : undefined}>
                  <div className={styles.permissionStateCell}>
                    {displayPermissions.length > 0 ? (
                      <>
                        <span className={styles.permissionOn}><CheckmarkCircle24Regular /></span>
                        <Text size={200}>Enabled</Text>
                      </>
                    ) : (
                      <>
                        <span className={styles.permissionOff}><Circle24Regular /></span>
                        <Text size={200}>No permissions</Text>
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell className={isUpdated ? styles.permUpdated : undefined}>
                  {displayPermissions.length > 0 ? (
                    <div className={styles.permissionBadges}>
                      {displayPermissions.map((label) => (
                        <Badge key={label} appearance="tint" color="brand" size="small" className={styles.permBadge}>
                          {label}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Text size={200} className={styles.noPerms}>No page permissions</Text>
                  )}
                </TableCell>
                <TableCell>
                  <UserSecurityActions
                    user={user}
                    currentUserId={currentUser?.id}
                    onEditPermissions={handleEditPermissions}
                    onEditVendorAccount={handleEditVendorAccount}
                    onEditRole={handleEditRole}
                    onLockToggle={handleLockToggle}
                    onMfaRequiredToggle={handleMfaRequiredToggle}
                    onForceReset={handleForceReset}
                    onDeleteClick={handleDeleteClick}
                  />
                </TableCell>
              </TableRow>
            );
          })}
          {filteredUsers.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <Text className={styles.noPerms}>No users found</Text>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <EditPermissionsDialog
        user={permDialogUser}
        open={permDialogOpen}
        onOpenChange={setPermDialogOpen}
        onSaved={handlePermissionsSaved}
      />

      <EditVendorAccountDialog
        user={vendorDialogUser}
        open={vendorDialogOpen}
        onOpenChange={setVendorDialogOpen}
        onSave={handleVendorAccountSave}
      />

      <EditRoleDialog
        user={roleDialogUser}
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        onSave={handleRoleSave}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={(_, d) => setDeleteDialogOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete user</DialogTitle>
            <DialogContent>
              Are you sure you want to delete <strong>{deleteDialogUser?.email}</strong>?
              This cannot be undone.
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">Cancel</Button>
              </DialogTrigger>
              <Button appearance="primary" onClick={handleDeleteConfirm} style={{ backgroundColor: tokens.colorPaletteRedBackground3 }}>
                Delete
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}