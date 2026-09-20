import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { makeStyles, tokens, shorthands, Text } from '@fluentui/react-components';
import UsersManagement from './UsersManagement';
import UserAnalytics from './UserAnalytics';
import AdminODataSettings from './AdminODataSettings';
import { AdminDataModel } from './datamodel';
import ExcelLinkWizard from './datamodel/ExcelLinkWizard';
import PasswordResetEmailTemplateSettings from './PasswordResetEmailTemplateSettings';
import AdminTrackChangesSettings from './AdminTrackChangesSettings';
import AdminD365Refresh from './AdminD365Refresh';
import AdminGeneralSettings from './AdminGeneralSettings';
import AdminSettingsSidebar from './AdminSettingsSidebar';
import { useAuth } from '../../context/AuthContext';
import { getVisibleSettingsSections } from '../../utils/settingsAudience';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    height: '100%',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    ...shorthands.padding('28px', '32px'),
    backgroundColor: tokens.colorNeutralBackground1,
    overflowY: 'auto',
  },
});

export default function AdminPage() {
  const styles = useStyles();
  const { user, permissions } = useAuth();
  const userRole = user?.role;
  const [adminTab, setAdminTab] = useState('general');

  const visibleSections = useMemo(
    () => getVisibleSettingsSections(userRole, permissions),
    [userRole, permissions],
  );

  // Alleen een tab renderen die deze gebruiker ook mag zien; anders vuurt een net ingetrokken
  // tab nog één ronde API-calls af die de backend toch met 403 beantwoordt.
  const activeTab = useMemo(() => {
    const visible = visibleSections.flatMap((section) => section.items);
    return visible.some((item) => item.id === adminTab) ? adminTab : null;
  }, [adminTab, visibleSections]);

  useEffect(() => {
    if (activeTab) return;
    const visible = visibleSections.flatMap((section) => section.items);
    setAdminTab(visible[0]?.id || 'general');
  }, [activeTab, visibleSections]);

  const handleSelectTab = useCallback((tabId) => {
    setAdminTab(tabId);
  }, []);

  return (
    <div className={styles.page}>
      <AdminSettingsSidebar
        sections={visibleSections}
        activeTab={activeTab}
        onSelect={handleSelectTab}
      />

      <div className={styles.content}>
        {activeTab === 'general' && <AdminGeneralSettings />}
        {activeTab === 'users' && <UsersManagement />}
        {activeTab === 'analytics' && <UserAnalytics />}
        {activeTab === 'mail-template' && <PasswordResetEmailTemplateSettings />}
        {activeTab === 'odata' && <AdminODataSettings />}
        {activeTab === 'datamodel' && <AdminDataModel />}
        {activeTab === 'external-links' && <ExcelLinkWizard />}
        {activeTab === 'track-changes' && <AdminTrackChangesSettings />}
        {activeTab === 'd365-refresh' && <AdminD365Refresh />}
      </div>
    </div>
  );
}
