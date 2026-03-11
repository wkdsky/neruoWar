import { useCallback, useEffect } from 'react';

const DEFAULT_MESSAGE = '当前百科草稿还有未保存修改，确定离开吗？';

const useUnsavedChangesGuard = ({ enabled = false, message = DEFAULT_MESSAGE } = {}) => {
  useEffect(() => {
    if (!enabled) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled, message]);

  return useCallback(() => {
    if (!enabled) return true;
    return window.confirm(message);
  }, [enabled, message]);
};

export default useUnsavedChangesGuard;
