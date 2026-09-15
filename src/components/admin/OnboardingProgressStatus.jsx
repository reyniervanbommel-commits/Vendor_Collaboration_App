import React from 'react';
import { Badge, ProgressBar, Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';

const STATUS_BADGES = {
  completed: { label: 'Completed', color: 'success' },
  in_progress: { label: 'In progress', color: 'warning' },
  skipped: { label: 'Stopped', color: 'danger' },
  not_started: { label: 'Not started', color: 'subtle' },
};

const useStyles = makeStyles({
  progress: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px'), minWidth: '160px', maxWidth: '280px' },
  caption: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function formatProgressDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date);
}

export function ProgressStatusBadge({ status, outdated = false }) {
  const badge = STATUS_BADGES[status] || STATUS_BADGES.not_started;
  return (
    <Badge appearance="tint" color={badge.color} size="small">
      {badge.label}{outdated ? ' (older version)' : ''}
    </Badge>
  );
}

/** Bar + "Step 3 of 8 · Write the formula" for one user's progress on one tour. */
export function StepProgress({ progress }) {
  const styles = useStyles();
  if (progress.status === 'not_started') return <Text className={styles.caption}>—</Text>;
  if (!progress.step) return <Text className={styles.caption}>Declined before starting</Text>;
  const value = progress.steps ? progress.step / progress.steps : 0;
  return (
    <div className={styles.progress}>
      <ProgressBar
        value={value}
        thickness="medium"
        color={progress.status === 'completed' ? 'success' : 'brand'}
        aria-label={`Step ${progress.step} of ${progress.steps}`}
      />
      <Text className={styles.caption}>
        Step {progress.step} of {progress.steps}{progress.stepTitle ? ` · ${progress.stepTitle}` : ''}
      </Text>
    </div>
  );
}
