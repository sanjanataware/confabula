import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, type DesignColorScheme } from './tokens';

export type BrandMarkProps = Omit<
  ViewProps,
  'accessible' | 'accessibilityLabel' | 'accessibilityRole' | 'children'
> & {
  size?: number;
  scheme?: DesignColorScheme;
  backgroundColor?: string;
  foregroundColor?: string;
  decorative?: boolean;
  accessibilityLabel?: string;
};

export function BrandMark({
  size = 32,
  scheme = 'light',
  backgroundColor,
  foregroundColor,
  decorative = false,
  accessibilityLabel = 'Conversation Language Coach',
  style,
  ...viewProps
}: BrandMarkProps) {
  const resolvedSize = Number.isFinite(size) ? Math.max(16, size) : 32;
  const markColors = colors[scheme];
  const barWidth = Math.max(2, resolvedSize * 0.095);
  const barRadius = barWidth / 2;

  return (
    <View
      {...viewProps}
      accessible={!decorative}
      accessibilityElementsHidden={decorative}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityRole={decorative ? undefined : 'image'}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      style={[
        styles.mark,
        {
          width: resolvedSize,
          height: resolvedSize,
          borderRadius: resolvedSize * 0.31,
          gap: resolvedSize * 0.085,
          backgroundColor: backgroundColor ?? markColors.accent,
        },
        style,
      ]}>
      <View
        style={{
          width: barWidth,
          height: resolvedSize * 0.27,
          borderRadius: barRadius,
          backgroundColor: foregroundColor ?? markColors.onAccent,
          opacity: 0.68,
        }}
      />
      <View
        style={{
          width: barWidth,
          height: resolvedSize * 0.52,
          borderRadius: barRadius,
          backgroundColor: foregroundColor ?? markColors.onAccent,
        }}
      />
      <View
        style={{
          width: barWidth,
          height: resolvedSize * 0.36,
          borderRadius: barRadius,
          backgroundColor: foregroundColor ?? markColors.onAccent,
          opacity: 0.82,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    overflow: 'hidden',
  },
});
