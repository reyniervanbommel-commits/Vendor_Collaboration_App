import React, { createContext, memo, useCallback, useContext } from 'react';
import {
  isReceivedPairHighlight,
  poSegmentStroke,
  stackRectLayout,
  weekBarBox,
  RCCP_OUTLINE_STROKE_WIDTH,
} from './rccpPoStack';
import { groupStackLayoutByStatus, poStackSegmentFill } from './rccpPoStackFill';

export const RccpSegmentHoverContext = createContext(null);

/** Segment list, bar width, x-offset and open-color for one stack. */
function stackShape(payload, side, overlay) {
  if (side === 'below') {
    return {
      segments: payload?.segmentsBelow || [],
      barWidth: Number(payload?.__barWidthBelow),
      offset: 0,
      openColor: payload?.__openColor,
    };
  }
  return {
    segments: (overlay ? payload?.segmentsAboveAlt : payload?.segmentsAbove) || [],
    barWidth: Number(payload?.__barWidthAbove),
    offset: Number(overlay ? payload?.__barOffsetAboveAlt : payload?.__barOffsetAbove) || 0,
    openColor: overlay ? payload?.__openColorAlt : payload?.__openColor,
  };
}

function RccpPoStackBar({
  y, height, payload, side, index, overlay = false,
}) {
  const hover = useContext(RccpSegmentHoverContext);
  const highlightItem = hover?.highlightItem || '';
  const { segments, barWidth, offset, openColor } = stackShape(payload, side, overlay);
  const layout = stackRectLayout(segments, y, height, side);
  const box = weekBarBox(index, barWidth, offset);
  if (!box.width || !layout.length) return null;
  const statusGroups = groupStackLayoutByStatus(layout);
  return (
    <g>
      {/* Eén vlak per status-band: losse vakjes per item laten anders witte naden zien.
          Boven de as krijgt "open" de volle kleur (requested- of confirmed-kleur, per
          instellingen) en "ordered" (al ontvangen deel van dezelfde order) de received-kleur
          op 30% opacity; onder de as is het altijd received op volle opacity. */}
      {statusGroups.map((group, groupIndex) => {
        const { fill, opacity } = poStackSegmentFill(group.status, {
          openColor,
          receivedColor: payload.__receivedColor,
          side,
        });
        return (
          <rect
            key={`fill-${groupIndex}`}
            x={box.x}
            y={group.top}
            width={box.width}
            height={Math.max(0, group.bottom - group.top)}
            fill={fill}
            fillOpacity={opacity}
            pointerEvents="none"
          />
        );
      })}
      {layout.map(({ y: rectY, height: rectH, segment }, segIndex) => (
        <RccpPoSegmentRect
          key={`${segment.itemNumber}-${segment.status}-${segIndex}`}
          x={box.x}
          y={rectY}
          width={box.width}
          height={rectH}
          segment={segment}
          weekLabel={payload?.key}
          highlighted={isReceivedPairHighlight(segment, highlightItem)}
        />
      ))}
      {/* Rand per status-band, in de eigen kleur. Het vervaagde "al ontvangen"-deel krijgt
          geen rand: anders tekent de open-kleur een lijn rondom dat stuk. */}
      {statusGroups.map((group, groupIndex) => {
        const { fill, opacity } = poStackSegmentFill(group.status, {
          openColor,
          receivedColor: payload.__receivedColor,
          side,
        });
        if (opacity < 1) return null;
        return (
          <rect
            key={`border-${groupIndex}`}
            x={box.x}
            y={group.top}
            width={box.width}
            height={Math.max(0, group.bottom - group.top)}
            fill="none"
            stroke={fill}
            strokeWidth={RCCP_OUTLINE_STROKE_WIDTH}
            pointerEvents="none"
          />
        );
      })}
    </g>
  );
}

/** Transparent hit area per item: the stack itself is painted as one rect. */
function RccpPoSegmentRect({
  x, y, width, height, segment, weekLabel, highlighted,
}) {
  const hover = useContext(RccpSegmentHoverContext);
  const handleEnter = useCallback((event) => {
    hover?.onHover?.({
      segment,
      label: weekLabel,
      x: event.clientX,
      y: event.clientY,
    });
  }, [hover, segment, weekLabel]);
  const handleLeave = useCallback(() => hover?.onHover?.(null), [hover]);
  const handleClick = useCallback((event) => {
    event.stopPropagation();
    const sku = String(segment?.itemNumber || '').trim();
    if (sku) hover?.onClick?.(sku);
  }, [hover, segment]);
  const handleMouseDown = useCallback((event) => {
    event.preventDefault();
  }, []);
  const { stroke, strokeWidth } = poSegmentStroke(segment, highlighted);
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="none"
      stroke={highlighted ? stroke : 'none'}
      strokeWidth={highlighted ? strokeWidth : 0}
      pointerEvents="all"
      cursor="pointer"
      onMouseEnter={handleEnter}
      onMouseMove={handleEnter}
      onMouseLeave={handleLeave}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    />
  );
}

export const RccpPoStackBarAbove = memo(function RccpPoStackBarAbove(props) {
  return <RccpPoStackBar {...props} side="above" />;
});

/** Second load-date series above the axis (confirmed next to requested). */
export const RccpPoStackBarAboveAlt = memo(function RccpPoStackBarAboveAlt(props) {
  return <RccpPoStackBar {...props} side="above" overlay />;
});

export const RccpPoStackBarBelow = memo(function RccpPoStackBarBelow(props) {
  return <RccpPoStackBar {...props} side="below" />;
});
