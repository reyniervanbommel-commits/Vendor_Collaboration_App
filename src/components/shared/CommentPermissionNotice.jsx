import { useEffect, useState } from 'react';
import { MessageBar, MessageBarBody } from '@fluentui/react-components';
import { COMMENT_PERMISSION_CHANGED_EVENT } from '../../utils/commentPermissionNotice';

export default function CommentPermissionNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(COMMENT_PERMISSION_CHANGED_EVENT, show);
    return () => window.removeEventListener(COMMENT_PERMISSION_CHANGED_EVENT, show);
  }, []);

  if (!visible) return null;

  return (
    <MessageBar intent="warning">
      <MessageBarBody>Your permissions have changed. Reload the page to continue.</MessageBarBody>
    </MessageBar>
  );
}
