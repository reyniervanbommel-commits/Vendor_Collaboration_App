import React, { useMemo } from 'react';
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
  shorthands,
} from '@fluentui/react-components';
import { Search24Regular } from '@fluentui/react-icons';
import CreateUserDialog from './CreateUserDialog';
import EditPermissionsDialog from './EditPermissionsDialog';
import EditVendorAccountDialog from './EditVendorAccountDialog';
import EditRoleDialog from './EditRoleDialog';
import SupplierFilterColumnSelect from './SupplierFilterColumnSelect';
import UsersTableRow from './UsersTableRow';
import { useUsersManagement } from '../../hooks/useUsersManagement';
import { useAuth } from '../../context/AuthContext';
import { getUserAccessSummary } from '../../utils/userAccessSummary';
import { ROLES } from '../../constants/roles';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', ...shorthands.gap('16px') },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  table: { width: '100%' },
  search: { minWidth: '280px', maxWidth: '360px' },
  muted: { color: tokens.colorNeutralForeground3, fontStyle: 'italic' },
  deleteButton: { backgroundColor: tokens.colorPaletteRedBackground3 },
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
  } = useUsersManagement();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === ROLES.ADMIN;

  const accessByUserId = useMemo(() => {
    const map = {};
    filteredUsers.forEach((user) => {
      map[user.id] = getUserAccessSummary(user.role, userPermissions[user.id] || []);
    });
    return map;
  }, [filteredUsers, userPermissions]);

  // Gebundeld en gememoizeerd, zodat de gememoizeerde rijen niet bij elke render hertekenen.
  const rowActions = useMemo(() => ({
    onEditPermissions: handleEditPermissions,
    onEditVendorAccount: handleEditVendorAccount,
    onEditRole: handleEditRole,
    onLockToggle: handleLockToggle,
    onMfaRequiredToggle: handleMfaRequiredToggle,
    onForceReset: handleForceReset,
    onDeleteClick: handleDeleteClick,
  }), [
    handleEditPermissions, handleEditVendorAccount, handleEditRole, handleLockToggle,
    handleMfaRequiredToggle, handleForceReset, handleDeleteClick,
  ]);

  if (loading) return <Text>Loading...</Text>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">User management</Text>
        <CreateUserDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onUserCreated={loadUsers}
          allowStaffRoles={isAdmin}
        />
      </div>

      {/* De bijbehorende PUT is admin-only; voor een employee zou dit veld altijd falen. */}
      {isAdmin && <SupplierFilterColumnSelect />}

      <Input
        placeholder="Search by email or role..."
        value={searchTerm}
        onChange={(_, d) => setSearchTerm(d.value)}
        contentBefore={<Search24Regular />}
        className={styles.search}
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
          {filteredUsers.map((user) => (
            <UsersTableRow
              key={user.id}
              user={user}
              access={accessByUserId[user.id]}
              isUpdated={recentlyUpdatedUserId === user.id}
              isAdmin={isAdmin}
              currentUserId={currentUser?.id}
              actions={rowActions}
            />
          ))}
          {filteredUsers.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <Text className={styles.muted}>No users found</Text>
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
              <Button appearance="primary" onClick={handleDeleteConfirm} className={styles.deleteButton}>
                Delete
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}