/**
 * Declarative product tours ("kind: tour", one per page) and interactive how-to guides ("kind: guide").
 * Bump `version` when a tour changes meaningfully — users then get offered it again.
 * Ids must be whitelisted in server/utils/onboardingSettings.js. Guides also need a `group` (see GUIDE_GROUPS).
 *
 * Step fields:
 *   anchor       CSS selector of the element to spotlight (usually [data-tour="…"]); omit for a centered card
 *   title, body  English copy; optional `bullets` [{ term, text }], `cheatsheet` [[code, text]], `example`
 *   placement    preferred card side: bottom | top | right | left
 *   roles        limit the step to roles
 *   action       user must interact with the spotlighted element; `hint` explains what to do
 *   advanceOn    { appears: selector } | { click: selector } | { disappears: true } → go to the next step
 *   reveal       force hover-only controls inside the anchor's header cell to be visible
 *   activate     selector clicked by the engine when the step starts (e.g. a drawer tab)
 *   resumeTo     step id to go back to when the anchor disappears (menu or dialog closed)
 *   optional     skip the step when the anchor is not on screen
 *   missingText  shown when the anchor can't be found
 */

import { BOARD_GUIDES } from './guidesBoard';
import { CONVERSATION_GUIDES } from './guidesConversations';
import { INSIGHT_GUIDES } from './guidesInsights';
import { REMARKS_GUIDES } from './guidesRemarks';
import { TAB_GUIDES } from './guidesTabs';
import { VIEW_GUIDES } from './guidesViews';
import { PAGE_TOURS } from './pageTours';

/** Sections of the How-to guides list, in display order; each guide sets `group` to one of these keys. */
export const GUIDE_GROUPS = [
  { key: 'views', title: 'Views & tabs' },
  { key: 'remarks', title: 'Remarks' },
  { key: 'columns', title: 'Columns & formatting' },
  { key: 'table', title: 'Working with the table' },
];

export const TOURS = [
  ...PAGE_TOURS,
  ...REMARKS_GUIDES,
  ...CONVERSATION_GUIDES,
  ...VIEW_GUIDES,
  ...TAB_GUIDES,
  ...BOARD_GUIDES,
  ...INSIGHT_GUIDES,
];
