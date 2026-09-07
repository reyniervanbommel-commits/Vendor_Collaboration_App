import React, { useCallback } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  Navigation24Regular,
  Settings24Regular,
  WeatherMoon24Regular,
  WeatherSunny24Regular,
} from '@fluentui/react-icons';
import { APP_DISPLAY_NAME } from '../../config/app';
import { APP_VERSION } from '../../config/version';
import { ROLES } from '../../constants/roles';

const useStyles = makeStyles({
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.padding('12px', '20px'),
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: tokens.shadow4,
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke1),
    position: 'sticky',
    top: 0,
    zIndex: 1000,
  },
  headerLeft: { display: 'flex', alignItems: 'center', ...shorthands.gap('12px') },
  headerCenter: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 },
  headerRight: { display: 'flex', alignItems: 'center', ...shorthands.gap('16px') },
  userMenuAnchor: { position: 'relative' },
  avatarButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  menuBackdrop: { position: 'fixed', inset: 0, zIndex: 2999 },
  menu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '8px',
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    borderRadius: '8px',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    ...shorthands.padding('16px'),
    minWidth: '240px',
    zIndex: 3000,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('4px'),
  },
  menuUserRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('12px'),
    marginBottom: '12px',
  },
  menuDivider: {
    ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke1),
    paddingTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('4px'),
  },
  menuButton: { justifyContent: 'flex-start' },
  menuVersion: {
    marginTop: '8px',
    paddingTop: '8px',
    ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke2),
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
  vendorDivider: {
    color: tokens.colorNeutralForeground4,
    userSelect: 'none',
  },
  vendorName: {
    color: tokens.colorNeutralForeground1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '260px',
  },
});

export default function AppShellHeader({
  vendorCompanyName = null,
  sidebarOpen,
  onToggleSidebar,
  isDarkMode,
  onToggleTheme,
  user,
  userMenuOpen,
  onToggleUserMenu,
  onCloseUserMenu,
  canAccessAdmin,
  onNavigateAdmin,
  onLogout,
  endSlot = null,
}) {
  const styles = useStyles();
  const avatarName = user?.display_name || user?.email || 'User';
  const isSupplier = user?.role === ROLES.SUPPLIER;
  const vendorLabel = vendorCompanyName || user?.vendor_account || null;

  const handleAdminClick = useCallback(() => {
    onNavigateAdmin();
    onCloseUserMenu();
  }, [onCloseUserMenu, onNavigateAdmin]);

  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Button
          appearance="subtle"
          icon={<Navigation24Regular />}
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
        />
        <Text size={500} weight="semibold" style={{ userSelect: 'none', whiteSpace: 'nowrap' }}>
          {APP_DISPLAY_NAME}
        </Text>
        {isSupplier && vendorLabel && (
          <>
            <Text size={400} className={styles.vendorDivider} aria-hidden="true">—</Text>
            <Text size={500} weight="semibold" className={styles.vendorName}>
              {vendorLabel}
            </Text>
          </>
        )}
      </div>

      <div className={styles.headerCenter} />

      <div className={styles.headerRight}>
        {endSlot}
        <Button
          appearance="subtle"
          icon={isDarkMode ? <WeatherSunny24Regular /> : <WeatherMoon24Regular />}
          onClick={onToggleTheme}
          aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
        />

        {user && (
          <div className={styles.userMenuAnchor}>
            <button
              type="button"
              onClick={onToggleUserMenu}
              className={styles.avatarButton}
              aria-label="User menu"
            >
              <Avatar name={avatarName} size={36} color="colorful" />
            </button>

            {userMenuOpen && (
              <>
                <div className={styles.menuBackdrop} onClick={onCloseUserMenu} />
                <div className={styles.menu}>
                  <div className={styles.menuUserRow}>
                    <Avatar name={avatarName} size={48} color="colorful" />
                    <div>
                      <Text weight="semibold" block>{avatarName}</Text>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{user.email}</Text>
                      {isSupplier && user.vendor_account && (
                        <Badge appearance="tint" color="informative" size="small" style={{ marginTop: '4px' }}>
                          {user.vendor_account}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className={styles.menuDivider}>
                    {canAccessAdmin && (
                      <Button
                        appearance="subtle"
                        icon={<Settings24Regular />}
                        className={styles.menuButton}
                        onClick={handleAdminClick}
                      >
                        Settings
                      </Button>
                    )}
                    <Button
                      appearance="subtle"
                      className={styles.menuButton}
                      onClick={onLogout}
                    >
                      Log out
                    </Button>
                  </div>
                  <Text size={200} className={styles.menuVersion}>
                    Version {APP_VERSION}
                  </Text>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
