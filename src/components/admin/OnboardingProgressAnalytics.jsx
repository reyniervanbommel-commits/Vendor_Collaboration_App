import React, { useMemo, useState } from 'react';
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { ArrowSync24Regular, Search20Regular } from '@fluentui/react-icons';
import { TOURS } from '../onboarding/tours';
import { useOnboardingProgress } from '../../hooks/useOnboardingProgress';
import { buildOnboardingOverview, matchesUserSearch } from '../../utils/onboardingAnalytics';
import OnboardingUserProgressTable from './OnboardingUserProgressTable';

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('16px'),
    ...shorthands.padding('16px'),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  header: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  muted: { color: tokens.colorNeutralForeground3 },
  filters: { display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', ...shorthands.gap('16px') },
  tourField: { minWidth: '220px', maxWidth: '320px' },
  searchField: { minWidth: '220px', maxWidth: '320px' },
  subTitle: { fontWeight: tokens.fontWeightSemibold },
});

/** Settings › Analytics: which users went through which guides and tours, and how far. */
export default function OnboardingProgressAnalytics() {
  const styles = useStyles();
  const { users, loading, error, refresh } = useOnboardingProgress();
  const [tourId, setTourId] = useState('');
  const [search, setSearch] = useState('');

  const overview = useMemo(() => buildOnboardingOverview(users, TOURS), [users]);
  const selectedTour = useMemo(() => TOURS.find((tour) => tour.id === tourId) || null, [tourId]);

  const rows = useMemo(() => overview.rows
    .filter((row) => matchesUserSearch(row.user, search))
    .map((row) => {
      if (!selectedTour) return { row };
      const entry = row.progress.find((item) => item.tour.id === selectedTour.id);
      return entry ? { row, entry } : null;
    })
    .filter(Boolean), [overview.rows, search, selectedTour]);

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <Text size={500} weight="semibold">Guides &amp; tours</Text>
        <Text className={styles.muted}>
          Who went through which product tours and how-to guides, and the furthest step they reached. Only guides available to a user’s role are counted.
        </Text>
      </div>

      <div className={styles.filters}>
        <Field label="Guide or tour" className={styles.tourField}>
          <Select value={tourId} onChange={(event) => setTourId(event.target.value)}>
            <option value="">All guides and tours</option>
            {TOURS.map((tour) => (
              <option key={tour.id} value={tour.id}>{tour.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="User" className={styles.searchField}>
          <Input
            value={search}
            onChange={(_, data) => setSearch(data.value)}
            contentBefore={<Search20Regular />}
            placeholder="Search name, email or vendor"
          />
        </Field>
        <Button
          appearance="subtle"
          icon={<ArrowSync24Regular />}
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh guide progress"
        />
      </div>

      {error ? <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar> : null}
      {loading && !users.length ? <Spinner size="small" label="Loading guide progress…" /> : null}

      {!loading || users.length ? (
        <>
          {selectedTour ? <Text className={styles.subTitle}>{selectedTour.title}</Text> : null}
          <OnboardingUserProgressTable rows={rows} selectedTourId={tourId} />
        </>
      ) : null}
    </div>
  );
}
