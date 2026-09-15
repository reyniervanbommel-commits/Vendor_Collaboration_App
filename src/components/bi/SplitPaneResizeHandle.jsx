import React, { memo, useCallback, useState } from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  handle: {
    height: '6px',
    cursor: 'ns-resize',
    touchAction: 'none',
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralStroke2,
    ':hover': {
      backgroundColor: tokens.colorBrandStroke1,
    },
  },
  dragging: {
    backgroundColor: tokens.colorBrandBackground2,
  },
});

function SplitPaneResizeHandle({ height, onResize }) {
  const styles = useStyles();
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback((event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setDragging(true);

    const handleMove = (moveEvent) => {
      onResize(startHeight + (startY - moveEvent.clientY));
    };
    const handleUp = () => {
      setDragging(false);
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerup', handleUp);
      target.removeEventListener('pointercancel', handleUp);
    };
    target.addEventListener('pointermove', handleMove);
    target.addEventListener('pointerup', handleUp);
    target.addEventListener('pointercancel', handleUp);
  }, [height, onResize]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onResize(height + 16);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onResize(height - 16);
    }
  }, [height, onResize]);

  return (
    <div
      className={mergeClasses(styles.handle, dragging && styles.dragging)}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panel"
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize"
      data-tour="board-split-resize"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}

export default memo(SplitPaneResizeHandle);
