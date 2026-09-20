import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, type ViewProps } from 'react-native';

export type RevealProps = Omit<ViewProps, 'children'> & {
  children: ReactNode;
  delay?: number;
  duration?: number;
  distance?: number;
  reduceMotion?: boolean;
};

type RemovableSubscription = {
  remove: () => void;
};

const defaultDuration = 460;
const defaultDistance = 12;
const revealEasing = Easing.bezier(0.22, 1, 0.36, 1);

function useReducedMotion(override: boolean | undefined) {
  const [systemPreference, setSystemPreference] = useState<boolean | null>(null);

  useEffect(() => {
    if (override !== undefined) {
      return undefined;
    }

    let active = true;
    let receivedChange = false;

    const handlePreferenceChange = (enabled: boolean) => {
      receivedChange = true;
      if (active) {
        setSystemPreference(enabled);
      }
    };

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      handlePreferenceChange,
    ) as RemovableSubscription | undefined;

    void AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (active && !receivedChange) {
          setSystemPreference(enabled);
        }
      },
      () => {
        if (active && !receivedChange) {
          setSystemPreference(true);
        }
      },
    );

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [override]);

  return override ?? systemPreference;
}

export function Reveal({
  children,
  delay = 0,
  duration = defaultDuration,
  distance = defaultDistance,
  reduceMotion,
  style,
  ...viewProps
}: RevealProps) {
  const prefersReducedMotion = useReducedMotion(reduceMotion);
  const progress = useRef(new Animated.Value(reduceMotion === true ? 1 : 0)).current;
  const hasRevealed = useRef(reduceMotion === true);
  const resolvedDelay = Number.isFinite(delay) ? Math.max(0, delay) : 0;
  const resolvedDuration = Number.isFinite(duration) ? Math.max(0, duration) : defaultDuration;
  const resolvedDistance = Number.isFinite(distance) ? distance : defaultDistance;

  useEffect(() => {
    if (prefersReducedMotion === null) {
      return undefined;
    }

    progress.stopAnimation();

    if (prefersReducedMotion || hasRevealed.current) {
      progress.setValue(1);
      hasRevealed.current = true;
      return undefined;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: resolvedDelay,
      duration: resolvedDuration,
      easing: revealEasing,
      isInteraction: false,
      useNativeDriver: Platform.OS !== 'web',
    });

    animation.start(({ finished }) => {
      if (finished) {
        hasRevealed.current = true;
      }
    });

    return () => {
      animation.stop();
    };
  }, [prefersReducedMotion, progress, resolvedDelay, resolvedDuration]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [resolvedDistance, 0],
  });

  return (
    <Animated.View
      {...viewProps}
      style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
