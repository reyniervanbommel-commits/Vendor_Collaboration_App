import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Field,
  Input,
  Button,
  MessageBar,
  MessageBarBody,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHeader,
  TableHeaderCell,
  Spinner,
  Select,
  shorthands,
} from '@fluentui/react-components';
import { ArrowSync24Regular } from '@fluentui/react-icons';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useAnalyticsData, formatDuration } from '../../hooks/useAnalyticsData';
import OnboardingProgressAnalytics from './OnboardingProgressAnalytics';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', ...shorthands.gap('24px') },
  filters: { display: 'flex', ...shorthands.gap('16px'), alignItems: 'flex-end', flexWrap: 'wrap' },
  section: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('16px'),
    ...shorthands.padding('16px'),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  chartContainer: { width: '100%', height: '300px', marginTop: '16px' },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    ...shorthands.gap('16px'),
    marginBottom: '16px',
  },
  statCard: {
    ...shorthands.padding('16px'),
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    boxShadow: tokens.shadow4,
  },
  tableContainer: { marginTop: '16px' },
});

export default function UserAnalytics() {
  const styles = useStyles();
  const {
    startDate, setStartDate, endDate, setEndDate,
    selectedUserId, setSelectedUserId,
    loading, error, users,
    loginStats, pageUsage, sessionStats, userLoginStats, clickStats,
    handleRefresh,
  } = useAnalyticsData();

  return (
    <div className={styles.container}>
      <Text size={600} weight="semibold">User analytics</Text>
      <MessageBar intent="info">
        <MessageBarBody>Activity data is retained for up to 90 days.</MessageBarBody>
      </MessageBar>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}

      <div className={styles.filters}>
        <Field label="Start date">
          <div lang="nl-NL">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </Field>
        <Field label="End date">
          <div lang="nl-NL">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </Field>
        <Field label="User">
          <Select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            style={{ minWidth: '200px' }}
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.email}</option>
            ))}
          </Select>
        </Field>
        <Button
          appearance="subtle"
          icon={<ArrowSync24Regular />}
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh"
        />
      </div>

      {loading && !loginStats && (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spinner size="large" />
          <Text style={{ display: 'block', marginTop: '16px' }}>Loading data...</Text>
        </div>
      )}

      {sessionStats && (
        <div className={styles.section}>
          <Text size={500} weight="semibold">Session statistics</Text>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Total sessions</Text>
              <Text size={600} weight="semibold">{sessionStats.total_sessions || 0}</Text>
            </div>
            <div className={styles.statCard}>
              <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Average duration</Text>
              <Text size={600} weight="semibold">{formatDuration(sessionStats.avg_duration_seconds)}</Text>
            </div>
            <div className={styles.statCard}>
              <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Min. duration</Text>
              <Text size={600} weight="semibold">{formatDuration(sessionStats.min_duration_seconds)}</Text>
            </div>
            <div className={styles.statCard}>
              <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Max. duration</Text>
              <Text size={600} weight="semibold">{formatDuration(sessionStats.max_duration_seconds)}</Text>
            </div>
          </div>
        </div>
      )}

      {loginStats?.by_day?.length > 0 && (
        <div className={styles.section}>
          <Text size={500} weight="semibold">Login statistics per day</Text>
          <div className={styles.chartContainer}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={loginStats.by_day}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                <Line type="monotone" dataKey="count" stroke="#2775CE" name="Login attempts" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {pageUsage.length > 0 && (
        <div className={styles.section}>
          <Text size={500} weight="semibold">Page usage</Text>
          <div className={styles.chartContainer}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pageUsage}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="page_name" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                <Bar dataKey="count" fill="#2775CE" name="Visits" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.tableContainer}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Page</TableHeaderCell>
                  <TableHeaderCell>Visits</TableHeaderCell>
                  <TableHeaderCell>Unique users</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageUsage.map((page, i) => (
                  <TableRow key={i}>
                    <TableCell>{page.page_name || 'Unknown'}</TableCell>
                    <TableCell>{page.count || 0}</TableCell>
                    <TableCell>{page.unique_users || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {userLoginStats.length > 0 && (
        <div className={styles.section}>
          <Text size={500} weight="semibold">Login statistics per user</Text>
          <div className={styles.tableContainer}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>User</TableHeaderCell>
                  <TableHeaderCell>Login attempts</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userLoginStats.map((stat, i) => (
                  <TableRow key={i}>
                    <TableCell>{stat.user_email}</TableCell>
                    <TableCell>{stat.login_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {clickStats.length > 0 && (
        <div className={styles.section}>
          <Text size={500} weight="semibold">Click statistics</Text>
          <div className={styles.tableContainer}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Page</TableHeaderCell>
                  <TableHeaderCell>Element</TableHeaderCell>
                  <TableHeaderCell>Clicks</TableHeaderCell>
                  <TableHeaderCell>Unique users</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clickStats.map((stat, i) => (
                  <TableRow key={i}>
                    <TableCell>{stat.page_name}</TableCell>
                    <TableCell>{stat.element_type}</TableCell>
                    <TableCell>{stat.count}</TableCell>
                    <TableCell>{stat.unique_users}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {!loading &&
        (!sessionStats || sessionStats.total_sessions === 0) &&
        (!loginStats || loginStats.by_day?.length === 0) &&
        pageUsage.length === 0 &&
        userLoginStats.length === 0 &&
        clickStats.length === 0 && (
          <MessageBar intent="info">
            <MessageBarBody>No analytics data found for the selected period.</MessageBarBody>
          </MessageBar>
      )}

      <OnboardingProgressAnalytics />
    </div>
  );
}
