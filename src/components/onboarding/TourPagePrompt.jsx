import React from 'react';
import { Button, Portal, Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';
import { motion, tourLayers } from '../../styles/motionTokens';
import TourIcon from './TourIcon';
import { enterAnimation, keyframes } from './onboardingMotion';

const useStyles = makeStyles({
  root: {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: tourLayers.overlay,
    width: '320px',
    maxWidth: 'calc(100vw - 32px)',
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr)',
    columnGap: '12px',
    ...shorthands.padding('14px', '14px', '12px'),
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow28,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...enterAnimation(keyframes.riseIn, motion.durationSlow),
  },
  iconTile: {
    display: 'grid',
    placeItems: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundImage: `linear-gradient(135deg, ${tokens.colorBrandBackground}, ${tokens.colorBrandBackgroundPressed})`,
  },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', ...shorthands.gap('4px') },
  text: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  actions: { display: 'flex', justifyContent: 'flex-end', ...shorthands.gap('6px'), gridColumn: '1 / -1', marginTop: '10px' },
});

/** Unobtrusive "take a tour of this page" bubble, shown once per page until started or declined. */
export default function TourPagePrompt({ tour, onStart, onDecline, onClose }) {
  const styles = useStyles();
  return (
    <Portal>
      <div className={styles.root} role="dialog" aria-modal="false" aria-labelledby="tour-page-prompt-title">
        <span className={styles.iconTile}><TourIcon name={tour.icon} /></span>
        <div>
          <div className={styles.header}>
            <Text id="tour-page-prompt-title" weight="semibold">New here?</Text>
            <Button
              appearance="subtle"
              size="small"
              icon={<Dismiss16Regular />}
              aria-label="Close tour offer"
              onClick={onClose}
            />
          </div>
          <Text className={styles.text}>
            Take a quick tour of this page — {tour.steps.length} short steps. {tour.description}
          </Text>
        </div>
        <div className={styles.actions}>
          <Button appearance="subtle" size="small" onClick={onDecline}>Not now</Button>
          <Button appearance="primary" size="small" onClick={onStart}>Show me</Button>
        </div>
      </div>
    </Portal>
  );
}
