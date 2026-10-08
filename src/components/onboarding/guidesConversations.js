import { ROLES } from '../../constants/roles';
import { STAFF, t } from './tourSelectors';

const OPEN_REMARKS_STEP = {
  id: 'open-remarks',
  anchor: t('row-remarks-badge'),
  placement: 'right',
  title: 'Open the remarks of an order',
  body: 'Click the speech bubble at the start of a row. The number shows how many remarks the order has.',
  action: true,
  hint: 'Click the highlighted speech bubble',
  advanceOn: { appears: t('remarks-panel') },
  missingText: 'No order rows are visible right now. Wait until the orders are loaded and start the guide again.',
};

const REPLY_STEP_BODY = 'Click Reply under a remark to answer it. Replies stay together in one conversation, which moves to the top when someone replies. Press Ctrl+Enter to send, Esc to cancel.';

/** How-to guides for remark conversations: (A) staff — visibility, @mentions, replies; (B) vendors. */
export const CONVERSATION_GUIDES = [
  {
    id: 'guideRemarksStaff',
    kind: 'guide',
    version: 1,
    route: '/',
    roles: STAFF,
    icon: 'remarks',
    title: 'Remarks: vendor or internal',
    description: 'Choose who sees a remark, reply in a conversation and post on many orders at once with @.',
    steps: [
      OPEN_REMARKS_STEP,
      {
        id: 'visibility',
        roles: [ROLES.ADMIN, ROLES.SUPPLY_CHAIN],
        anchor: t('remark-visibility-toggle'),
        placement: 'left',
        title: 'Vendor or Internal',
        bullets: [
          { term: 'All', text: 'shows every remark — you can reply, but not start a new remark' },
          { term: 'Vendor', text: 'shows only remarks the vendor can read; your new remark goes to the vendor' },
          { term: 'Internal', text: 'shows only internal remarks; your new remark stays hidden from the vendor' },
        ],
        body: 'The send button tells you where your remark goes: Send to vendor or Post internal note.',
        resumeTo: 'open-remarks',
      },
      {
        id: 'internal-only',
        roles: [ROLES.EMPLOYEE],
        anchor: t('remark-composer'),
        placement: 'left',
        title: 'Your remarks are internal',
        body: 'Remarks you post are visible to colleagues only — never to the vendor. You see internal remarks; remarks for the vendor are handled by Supply Chain.',
        resumeTo: 'open-remarks',
      },
      {
        id: 'mentions',
        anchor: t('remark-composer'),
        placement: 'left',
        title: 'Post on many orders with @',
        bullets: [
          { term: '@ + 2 characters', text: 'shows matching values, e.g. an item number — pick one from the list' },
          { term: 'Blue chip', text: 'a picked value turns blue; plain text after @ is not a mention' },
          { term: 'Reach', text: 'above the button you see how many orders (and vendors) get the remark' },
          { term: 'Combine', text: 'different columns narrow it down, e.g. @item @Open order = lines of that item that are still open' },
        ],
        body: 'The remark is placed on every order that has the value right now, up to 200 orders. Amber means a vendor remark reaches several vendors.',
        resumeTo: 'open-remarks',
      },
      {
        id: 'reply',
        anchor: t('remark-reply-button'),
        placement: 'left',
        title: 'Reply in the conversation',
        body: `${REPLY_STEP_BODY} A reply always has the same visibility as the remark it answers.`,
        optional: true,
      },
      {
        id: 'read',
        anchor: t('remarks-panel'),
        placement: 'left',
        title: 'Reading the conversation',
        bullets: [
          { term: 'Internal / Vendor badge', text: 'who can read the remark, also shown by the colored edge' },
          { term: 'Posted on … purchase orders', text: 'the remark was placed with @ on several orders' },
          { term: 'Delete', text: 'removes the remark everywhere it was posted' },
        ],
        body: 'Badges are shown to Admin and Supply Chain only.',
        resumeTo: 'open-remarks',
      },
    ],
  },
  {
    id: 'guideRemarksVendor',
    kind: 'guide',
    version: 1,
    route: '/',
    roles: [ROLES.SUPPLIER],
    icon: 'remarks',
    title: 'Remarks and replies',
    description: 'Ask a question about an order, reply to Van Bommel and post on several of your orders at once.',
    steps: [
      OPEN_REMARKS_STEP,
      {
        id: 'compose',
        anchor: t('remark-composer'),
        placement: 'left',
        title: 'Write a remark',
        body: 'Type your message and click Add remark. Your remarks are read by the purchasing team of Van Bommel. Other vendors never see them.',
        resumeTo: 'open-remarks',
      },
      {
        id: 'mentions',
        anchor: t('remark-composer'),
        placement: 'left',
        title: 'Same message on several orders',
        bullets: [
          { term: '@ + 2 characters', text: 'shows matching values, e.g. an item number — pick one from the list' },
          { term: 'Blue chip', text: 'a picked value turns blue' },
          { term: 'Reach', text: 'above the button you see on how many of your orders the remark is placed' },
        ],
        body: 'The remark is only placed on your own orders that have this value.',
        resumeTo: 'open-remarks',
      },
      {
        id: 'reply',
        anchor: t('remark-reply-button'),
        placement: 'left',
        title: 'Reply to a remark',
        body: REPLY_STEP_BODY,
        optional: true,
      },
    ],
  },
];
