import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export type DesignColorScheme = 'light' | 'dark';

export type ColorTokens = {
  readonly canvas: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly surfaceRaised: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textSubtle: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly accent: string;
  readonly accentPressed: string;
  readonly accentSoft: string;
  readonly onAccent: string;
  readonly positive: string;
  readonly caution: string;
  readonly critical: string;
  readonly focus: string;
  readonly ambientPrimary: string;
  readonly ambientSecondary: string;
  readonly ambientTertiary: string;
  readonly scrim: string;
};

export const colors = {
  light: {
    canvas: '#F5F4EF',
    surface: '#FFFEFA',
    surfaceMuted: '#EBEFEC',
    surfaceRaised: '#FAF9F5',
    text: '#18211F',
    textMuted: '#5E6B67',
    textSubtle: '#7A8782',
    border: '#DCE2DE',
    borderStrong: '#C6CFCA',
    accent: '#346B60',
    accentPressed: '#28574E',
    accentSoft: '#DDEBE6',
    onAccent: '#FAFCFB',
    positive: '#3D7059',
    caution: '#886536',
    critical: '#9A4845',
    focus: '#4B8176',
    ambientPrimary: '#DCEAE5',
    ambientSecondary: '#E8E2D5',
    ambientTertiary: '#DDE7EA',
    scrim: 'rgba(16, 24, 22, 0.42)',
  },
  dark: {
    canvas: '#111715',
    surface: '#18201E',
    surfaceMuted: '#202A27',
    surfaceRaised: '#222B28',
    text: '#F1F4F0',
    textMuted: '#B1BDB8',
    textSubtle: '#899792',
    border: '#303C38',
    borderStrong: '#43504B',
    accent: '#8FC3B2',
    accentPressed: '#A6D3C5',
    accentSoft: '#263B35',
    onAccent: '#10211C',
    positive: '#8BC2A1',
    caution: '#D1B47B',
    critical: '#E1A19D',
    focus: '#96CDBB',
    ambientPrimary: '#1D322D',
    ambientSecondary: '#302C24',
    ambientTertiary: '#1E2C32',
    scrim: 'rgba(4, 8, 7, 0.66)',
  },
} as const satisfies Record<DesignColorScheme, ColorTokens>;

export type ColorToken = keyof ColorTokens;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  giant: 64,
} as const;

export type SpacingToken = keyof typeof spacing;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 36,
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radii;

export const fontFamilies = {
  sans:
    Platform.select({
      android: 'sans-serif',
      web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      default: 'System',
    }) ?? 'System',
  mono:
    Platform.select({
      android: 'monospace',
      web: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      default: 'Menlo',
    }) ?? 'monospace',
} as const;

export const typography = {
  hero: {
    fontFamily: fontFamilies.sans,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '600',
    letterSpacing: -1.1,
  },
  heading: {
    fontFamily: fontFamilies.sans,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -0.55,
  },
  title: {
    fontFamily: fontFamilies.sans,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fontFamilies.sans,
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  bodyMedium: {
    fontFamily: fontFamilies.sans,
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  callout: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: 0,
  },
  label: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  caption: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  code: {
    fontFamily: fontFamilies.mono,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
    letterSpacing: 0,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;

function platformShadow(boxShadow: string, elevation: number, nativeShadow: ViewStyle): ViewStyle {
  return (
    Platform.select<ViewStyle>({
      web: { boxShadow },
      android: { elevation, shadowColor: nativeShadow.shadowColor },
      default: nativeShadow,
    }) ?? nativeShadow
  );
}

export const shadows = {
  none: platformShadow('none', 0, {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  }),
  soft: platformShadow('0 6px 20px rgba(24, 33, 31, 0.08)', 2, {
    shadowColor: '#18211F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  }),
  raised: platformShadow('0 12px 32px rgba(24, 33, 31, 0.12)', 5, {
    shadowColor: '#18211F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  }),
  floating: platformShadow('0 20px 48px rgba(24, 33, 31, 0.16)', 8, {
    shadowColor: '#18211F',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
  }),
} satisfies Readonly<Record<string, ViewStyle>>;

export type ShadowToken = keyof typeof shadows;

export const designTokens = {
  colors,
  spacing,
  radii,
  typography,
  shadows,
} as const;
