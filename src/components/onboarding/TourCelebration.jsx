import React, { useEffect, useMemo } from 'react';
import { Portal, Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { Sparkle24Filled } from '@fluentui/react-icons';
import { brandColor } from '../../styles/brandTokens';
import { motion, prefersReducedMotion, tourLayers } from '../../styles/motionTokens';
import { enterAnimation, keyframes, reducedMotion } from './onboardingMotion';

const VISIBLE_MS = 2600;
const PIECES = 42;
const COLORS = [brandColor.navyMid, brandColor.navyLight, brandColor.accentGold, brandColor.accentGoldLight, brandColor.success];

const useStyles = makeStyles({
  root: {
    position: 'fixed',
    left: '50%',
    bottom: '48px',
    transform: 'translateX(-50%)',
    zIndex: tourLayers.card,
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('12px'),
    ...shorthands.padding('12px', '18px', '12px', '12px'),
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow28,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...enterAnimation(keyframes.riseIn, motion.durationSlow),
  },
  badge: {
    display: 'grid',
    placeItems: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundImage: `linear-gradient(135deg, ${brandColor.navyMid}, ${brandColor.accentGold})`,
    flexShrink: 0,
  },
  text: { display: 'flex', flexDirection: 'column' },
  sub: { color: tokens.colorNeutralForeground3 },
  burst: { position: 'absolute', left: '32px', top: '32px', width: 0, height: 0 },
  piece: {
    position: 'absolute',
    width: '8px',
    height: '12px',
    borderRadius: '2px',
    opacity: 0,
    animationName: keyframes.confetti,
    animationDuration: '1100ms',
    animationTimingFunction: 'cubic-bezier(0.15, 0.7, 0.3, 1)',
    animationFillMode: 'forwards',
    ...reducedMotion,
  },
});

/** "Nice work" toast with a short confetti burst after finishing a tour or guide. */
export default function TourCelebration({ title, onDone }) {
  const styles = useStyles();
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const pieces = useMemo(() => Array.from({ length: reduced ? 0 : PIECES }, (_, i) => {
    const angle = (Math.PI * 2 * i) / PIECES + (Math.random() - 0.5) * 0.4;
    const distance = 70 + Math.random() * 110;
    return {
      key: i,
      style: {
        backgroundColor: COLORS[i % COLORS.length],
        animationDelay: `${Math.round(Math.random() * 120)}ms`,
        '--tour-tx': `${Math.round(Math.cos(angle) * distance)}px`,
        '--tour-ty': `${Math.round(Math.sin(angle) * distance - 60)}px`,
        '--tour-r': `${Math.round(Math.random() * 720 - 360)}deg`,
      },
    };
  }), [reduced]);

  useEffect(() => {
    const timer = setTimeout(onDone, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <Portal>
      <div className={styles.root} role="status" aria-live="polite">
        <div className={styles.toast}>
          <span className={styles.badge}><Sparkle24Filled /></span>
          <span className={styles.text}>
            <Text weight="semibold">Nice work — you’re all set</Text>
            <Text size={200} className={styles.sub}>{title} completed</Text>
          </span>
        </div>
        <div className={styles.burst} aria-hidden="true">
          {pieces.map((piece) => <span key={piece.key} className={styles.piece} style={piece.style} />)}
        </div>
      </div>
    </Portal>
  );
}
