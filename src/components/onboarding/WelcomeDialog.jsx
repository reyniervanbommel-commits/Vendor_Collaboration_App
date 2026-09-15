import React, { useCallback } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { BookOpen24Regular, Sparkle16Filled } from '@fluentui/react-icons';
import { APP_DISPLAY_NAME } from '../../config/app';
import { brandColor } from '../../styles/brandTokens';
import { motion } from '../../styles/motionTokens';
import TourIcon from './TourIcon';
import { enterAnimation, keyframes, reducedMotion } from './onboardingMotion';

const useStyles = makeStyles({
  surface: {
    maxWidth: '560px',
    width: 'calc(100vw - 32px)',
    ...shorthands.padding(0),
    ...shorthands.overflow('hidden'),
    borderRadius: tokens.borderRadiusXLarge,
  },
  hero: {
    position: 'relative',
    ...shorthands.overflow('hidden'),
    ...shorthands.padding('28px', '28px', '24px'),
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundImage: `linear-gradient(135deg, ${brandColor.navyDeep} 0%, ${brandColor.navyMid} 62%, ${brandColor.navyLight} 100%)`,
  },
  blob: {
    position: 'absolute',
    borderRadius: '50%',
    filter: 'blur(2px)',
    animationName: keyframes.float,
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    ...reducedMotion,
  },
  blobGold: {
    width: '180px',
    height: '180px',
    right: '-40px',
    top: '-70px',
    backgroundImage: `radial-gradient(circle at 30% 30%, ${brandColor.accentGoldLight}, transparent 70%)`,
    opacity: 0.55,
    animationDuration: '9s',
  },
  blobBlue: {
    width: '140px',
    height: '140px',
    right: '120px',
    bottom: '-80px',
    backgroundImage: `radial-gradient(circle at 50% 50%, ${brandColor.navyLight}, transparent 70%)`,
    opacity: 0.7,
    animationDuration: '12s',
    animationDelay: '-3s',
  },
  heroContent: { position: 'relative', display: 'flex', flexDirection: 'column', ...shorthands.gap('6px') },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    ...shorthands.gap('6px'),
    ...shorthands.padding('2px', '10px'),
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    color: brandColor.accentGoldLight,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    ...enterAnimation(keyframes.riseIn, motion.durationSlow, 60),
  },
  heroTitle: {
    color: tokens.colorNeutralForegroundOnBrand,
    fontSize: tokens.fontSizeBase600,
    lineHeight: tokens.lineHeightBase600,
    fontWeight: tokens.fontWeightSemibold,
    ...enterAnimation(keyframes.riseIn, motion.durationSlow, 120),
  },
  heroText: {
    color: 'rgba(255, 255, 255, 0.85)',
    ...enterAnimation(keyframes.riseIn, motion.durationSlow, 180),
  },
  body: { ...shorthands.padding('20px', '28px', '8px') },
  features: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    ...shorthands.gap('12px'),
    '@media (max-width: 520px)': { gridTemplateColumns: '1fr' },
  },
  feature: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('6px'),
    ...shorthands.padding('14px'),
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke3),
    ...enterAnimation(keyframes.riseIn, motion.durationSlow),
  },
  featureIcon: {
    display: 'grid',
    placeItems: 'center',
    width: '36px',
    height: '36px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  featureText: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  powerTip: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    marginTop: '14px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    ...enterAnimation(keyframes.fadeIn, motion.durationSlow, 420),
  },
  actions: {
    ...shorthands.padding('12px', '28px', '24px'),
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
});

const FEATURES = [
  { icon: 'board', title: 'Master plan', text: 'All purchase orders with views, tabs and filters.' },
  { icon: 'chart', title: 'Performance & Planning', text: 'Load versus capacity per week, with KPIs.' },
  { icon: 'settings', title: 'Settings', text: 'Your preferences and, for admins, the app setup.' },
];

function firstName(user) {
  const name = String(user?.display_name || '').trim();
  return name ? name.split(/\s+/)[0] : '';
}

export default function WelcomeDialog({ open, user, showPowerTip, onStartTour, onBrowseGuides, onDismiss }) {
  const styles = useStyles();
  const name = firstName(user);
  const handleOpenChange = useCallback((_, data) => {
    if (!data.open) onDismiss();
  }, [onDismiss]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogSurface className={styles.surface} aria-labelledby="welcome-dialog-title">
        <div className={styles.hero}>
          <span className={mergeClasses(styles.blob, styles.blobGold)} aria-hidden="true" />
          <span className={mergeClasses(styles.blob, styles.blobBlue)} aria-hidden="true" />
          <div className={styles.heroContent}>
            <span className={styles.chip}><Sparkle16Filled /> Getting started</span>
            <Text as="h2" id="welcome-dialog-title" className={styles.heroTitle}>
              {name ? `Welcome, ${name}` : 'Welcome'}
            </Text>
            <Text className={styles.heroText}>
              {APP_DISPLAY_NAME} brings purchase orders and planning together. Take a one-minute tour to find your way around.
            </Text>
          </div>
        </div>
        <DialogBody>
          <DialogContent className={styles.body}>
            <div className={styles.features}>
              {FEATURES.map((feature, index) => (
                <div
                  key={feature.title}
                  className={styles.feature}
                  style={{ animationDelay: `${240 + index * 70}ms` }}
                >
                  <span className={styles.featureIcon}><TourIcon name={feature.icon} /></span>
                  <Text weight="semibold">{feature.title}</Text>
                  <Text className={styles.featureText}>{feature.text}</Text>
                </div>
              ))}
            </div>
            {showPowerTip ? (
              <div className={styles.powerTip}>
                <BookOpen24Regular />
                <span>Guides show you step by step how to create tabs, formula columns and more.</span>
              </div>
            ) : null}
          </DialogContent>
          <DialogActions className={styles.actions}>
            <Button appearance="subtle" onClick={onDismiss}>Maybe later</Button>
            <Button appearance="secondary" icon={<BookOpen24Regular />} onClick={onBrowseGuides}>Browse guides</Button>
            <Button appearance="primary" onClick={onStartTour}>Take the tour</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
