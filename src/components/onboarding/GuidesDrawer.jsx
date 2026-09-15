import React, { useCallback } from 'react';
import {
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkCircle16Filled, Dismiss24Regular, Play16Filled } from '@fluentui/react-icons';
import { ROLES } from '../../constants/roles';
import { motion } from '../../styles/motionTokens';
import { describeTourProgress } from '../../utils/tourSteps';
import TourIcon from './TourIcon';
import { enterAnimation, keyframes, reducedMotion } from './onboardingMotion';

const SECONDS_PER_STEP = 10;

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', ...shorthands.gap('20px'), paddingBottom: '24px' },
  intro: { color: tokens.colorNeutralForeground3 },
  section: { display: 'flex', flexDirection: 'column', ...shorthands.gap('8px') },
  sectionTitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  card: {
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: '12px',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
    ...shorthands.padding('12px'),
    borderRadius: tokens.borderRadiusLarge,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    transitionProperty: 'transform, box-shadow, border-color',
    transitionDuration: `${motion.durationFast}ms`,
    transitionTimingFunction: motion.easeOut,
    ...enterAnimation(keyframes.riseIn, motion.durationSlow),
    ':hover': {
      transform: 'translateY(-2px)',
      boxShadow: tokens.shadow8,
      ...shorthands.borderColor(tokens.colorBrandStroke2),
    },
    ':hover [data-guide-play]': { opacity: 1, transform: 'scale(1)' },
    ':focus-visible [data-guide-play]': { opacity: 1, transform: 'scale(1)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: tokens.colorStrokeFocus2,
    },
    ...reducedMotion,
  },
  iconTile: {
    display: 'grid',
    placeItems: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  text: { display: 'flex', flexDirection: 'column', ...shorthands.gap('2px'), minWidth: 0 },
  description: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  meta: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', ...shorthands.gap('6px'), marginTop: '4px' },
  metaText: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100 },
  done: { display: 'inline-flex', alignItems: 'center', ...shorthands.gap('4px'), color: tokens.colorPaletteGreenForeground1, fontSize: tokens.fontSizeBase100 },
  play: {
    display: 'grid',
    placeItems: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    opacity: 0.0,
    transform: 'scale(0.8)',
    transitionProperty: 'opacity, transform',
    transitionDuration: `${motion.durationFast}ms`,
    '@media (hover: none)': { opacity: 1, transform: 'scale(1)' },
    ...reducedMotion,
  },
});

function durationLabel(steps) {
  const minutes = Math.max(1, Math.round((steps * SECONDS_PER_STEP) / 60));
  return `~${minutes} min`;
}

/** progress: result of describeTourProgress() */
function GuideCard({ tour, progress, index, onStart }) {
  const { status } = progress;
  const isNew = status === 'not_started' || progress.outdated;
  const styles = useStyles();
  const handleClick = useCallback(() => onStart(tour.id), [onStart, tour.id]);
  const adminOnly = Array.isArray(tour.roles) && tour.roles.length === 1 && tour.roles[0] === ROLES.ADMIN;
  return (
    <button
      type="button"
      className={styles.card}
      style={{ animationDelay: `${60 + index * 50}ms` }}
      onClick={handleClick}
    >
      <span className={styles.iconTile}><TourIcon name={tour.icon} /></span>
      <span className={styles.text}>
        <Text weight="semibold">{tour.title}</Text>
        <span className={styles.description}>{tour.description}</span>
        <span className={styles.meta}>
          <span className={styles.metaText}>{tour.steps.length} steps · {durationLabel(tour.steps.length)}</span>
          {adminOnly ? <Badge size="small" appearance="tint" color="informative">Admin</Badge> : null}
          {!isNew && status === 'completed' ? (
            <span className={styles.done}><CheckmarkCircle16Filled /> Completed</span>
          ) : null}
          {!isNew && status === 'in_progress' && progress.step ? (
            <Badge size="small" appearance="tint" color="warning">Step {progress.step} of {tour.steps.length}</Badge>
          ) : null}
          {isNew ? <Badge size="small" appearance="tint" color="brand">New</Badge> : null}
        </span>
      </span>
      <span className={styles.play} data-guide-play aria-hidden="true"><Play16Filled /></span>
    </button>
  );
}

/** Library of page tours and how-to guides (filtered to the user's role). */
export default function GuidesDrawer({ open, tours, onboardingState, onStart, onClose }) {
  const styles = useStyles();
  const pageTours = tours.filter((tour) => tour.kind === 'tour');
  const guides = tours.filter((tour) => tour.kind === 'guide');
  const handleOpenChange = useCallback((_, data) => {
    if (!data.open) onClose();
  }, [onClose]);

  let cardIndex = 0;
  const renderCard = (tour) => (
    <GuideCard
      key={tour.id}
      tour={tour}
      index={cardIndex++}
      progress={describeTourProgress(onboardingState.tours[tour.id], tour)}
      onStart={onStart}
    />
  );

  return (
    <Drawer open={open} position="end" size="medium" onOpenChange={handleOpenChange}>
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Close guides" onClick={onClose} />}
        >
          Guides
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className={styles.body}>
        <Text className={styles.intro}>
          Short interactive walkthroughs. They point at the real screen and wait for you — nothing is changed unless you save it yourself.
        </Text>
        <section className={styles.section} aria-label="Page tours">
          <Text as="h3" className={styles.sectionTitle}>Get to know the app</Text>
          {pageTours.map(renderCard)}
        </section>
        {guides.length > 0 ? (
          <section className={styles.section} aria-label="How-to guides">
            <Text as="h3" className={styles.sectionTitle}>How-to guides</Text>
            {guides.map(renderCard)}
          </section>
        ) : null}
      </DrawerBody>
    </Drawer>
  );
}
