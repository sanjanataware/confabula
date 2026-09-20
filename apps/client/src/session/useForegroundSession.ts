import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

export function useForegroundSession(onLeaveForeground: () => void): void {
  const callback = useRef(onLeaveForeground);
  const ended = useRef(false);
  callback.current = onLeaveForeground;

  useEffect(() => {
    const leave = () => {
      if (!ended.current) {
        ended.current = true;
        callback.current();
      }
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        leave();
      }
    });
    const visibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        leave();
      }
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', visibility);
    }
    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibility);
      }
    };
  }, []);
}
