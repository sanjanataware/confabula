import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, radii, type DesignColorScheme } from './tokens';

export type AmbientBackdropProps = Omit<
  ViewProps,
  | 'accessible'
  | 'accessibilityElementsHidden'
  | 'children'
  | 'importantForAccessibility'
  | 'pointerEvents'
> & {
  scheme?: DesignColorScheme;
};

export function AmbientBackdrop({ scheme = 'light', style, ...viewProps }: AmbientBackdropProps) {
  const backdropColors = colors[scheme];

  return (
    <View
      {...viewProps}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.backdrop, { backgroundColor: backdropColors.canvas }, style]}>
      <View
        style={[
          styles.aura,
          styles.primaryAura,
          { backgroundColor: backdropColors.ambientPrimary },
        ]}
      />
      <View
        style={[
          styles.aura,
          styles.secondaryAura,
          { backgroundColor: backdropColors.ambientSecondary },
        ]}
      />
      <View
        style={[
          styles.aura,
          styles.tertiaryAura,
          { backgroundColor: backdropColors.ambientTertiary },
        ]}
      />
      <View style={[styles.orbit, { borderColor: backdropColors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
    overflow: 'hidden',
  },
  aura: {
    position: 'absolute',
    borderRadius: radii.full,
  },
  primaryAura: {
    width: '96%',
    aspectRatio: 1.08,
    top: '-31%',
    right: '-34%',
    opacity: 0.72,
    transform: [{ rotate: '-10deg' }],
  },
  secondaryAura: {
    width: '88%',
    aspectRatio: 0.96,
    bottom: '-37%',
    left: '-32%',
    opacity: 0.56,
    transform: [{ rotate: '12deg' }],
  },
  tertiaryAura: {
    width: '54%',
    aspectRatio: 0.72,
    top: '28%',
    left: '-31%',
    opacity: 0.34,
    transform: [{ rotate: '-18deg' }],
  },
  orbit: {
    position: 'absolute',
    width: '68%',
    aspectRatio: 1,
    top: '8%',
    right: '-46%',
    borderWidth: 1,
    borderRadius: radii.full,
    opacity: 0.52,
  },
});
