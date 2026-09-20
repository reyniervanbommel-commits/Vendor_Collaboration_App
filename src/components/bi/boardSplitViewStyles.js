import { makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { PO_TABLE_ZOOM_CSS_VAR, PO_TABLE_ZOOM_DEFAULT } from '../../utils/poTableZoom';

export const useBoardSplitViewStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    [PO_TABLE_ZOOM_CSS_VAR]: String(PO_TABLE_ZOOM_DEFAULT),
  },
  tableRegion: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    overflow: 'hidden',
    '& > *': {
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      overflow: 'hidden',
      scrollbarGutter: 'stable',
    },
  },
  toggleBar: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalS),
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
    backgroundColor: tokens.colorNeutralBackground2,
    flexWrap: 'wrap',
  },
  toggleBarCollapsed: {
    ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke2),
  },
  pane: {
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS, tokens.spacingVerticalXS),
    backgroundColor: tokens.colorNeutralBackground2,
    minHeight: 0,
    overflow: 'auto',
  },
  paneCollapsed: {
    height: 0,
    overflow: 'hidden',
    padding: 0,
    borderTopWidth: 0,
    minHeight: 0,
  },
});
