import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  colors,
  radii,
  shadows,
  spacing,
  typography,
} from '../design';
import type { InterventionCardModel } from './model';

const palette = colors.light;

export type InterventionCardProps = {
  card: InterventionCardModel;
  onReplay: (card: InterventionCardModel) => void;
  onRetry: (card: InterventionCardModel) => void;
};

export function InterventionCard({ card, onReplay, onRetry }: InterventionCardProps) {
  const { width } = useWindowDimensions();
  const compact = width < 620;
  const stateLabel = {
    preview: 'Checking…',
    committed: 'Translation ready',
    audio_ready: 'Ready to speak',
    audio_failed: 'Speech unavailable',
    interrupted: 'Playback stopped',
  }[card.status];
  const stateColor = {
    preview: palette.caution,
    committed: palette.accent,
    audio_ready: palette.positive,
    audio_failed: palette.critical,
    interrupted: '#9B654B',
  }[card.status];
  const voiceLabel = card.playbackKind === 'audio_url'
    ? 'Local neural voice'
    : card.playbackKind === 'device_speech'
      ? 'Device voice'
      : 'Preparing voice';

  return (
    <View
      accessibilityLabel={`${card.sourceText} translates to ${card.targetText}. ${stateLabel}`}
      style={styles.card}
      testID={`intervention-${card.id}`}>
      <View style={[styles.accentRail, { backgroundColor: stateColor }]} />
      <View style={styles.content}>
        <View style={styles.metaRow}>
          <View style={[styles.statePill, { backgroundColor: `${stateColor}18` }]}>
            <View style={[styles.stateDot, { backgroundColor: stateColor }]} />
            <Text style={[styles.stateText, { color: stateColor }]}>{stateLabel}</Text>
          </View>
          <Text style={styles.participant}>
            {card.participantId.replace('_', ' ')}
          </Text>
        </View>

        <View style={[
          styles.translation,
          compact && styles.translationCompact,
        ]}>
          <View style={styles.phrase}>
            <Text style={styles.language}>{card.sourceLanguage.toUpperCase()}</Text>
            <Text style={styles.source}>{card.sourceText}</Text>
            <Text style={styles.phraseHint}>what was said</Text>
          </View>
          <View style={[
            styles.arrowDisc,
            compact && styles.arrowDiscCompact,
          ]}>
            <Text style={styles.arrow} accessibilityLabel="translates to">→</Text>
          </View>
          <View style={[styles.phrase, styles.targetPhrase]}>
            <Text style={[styles.language, styles.targetLanguage]}>
              {card.targetLanguage.toUpperCase()}
            </Text>
            <Text style={styles.target}>{card.targetText}</Text>
            <Text style={styles.phraseHint}>the phrase to keep</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.voiceMeta}>
            <View style={styles.voiceGlyph}>
              {[8, 14, 10].map((height, index) => (
                <View key={index} style={[styles.voiceBar, { height }]} />
              ))}
            </View>
            <Text style={styles.voiceText}>{voiceLabel}</Text>
          </View>
          <View style={styles.actions}>
            {card.retryAvailable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry speech"
                style={({ pressed }) => [
                  styles.secondaryAction,
                  pressed && styles.actionPressed,
                ]}
                onPress={() => onRetry(card)}>
                <Text style={styles.secondaryActionText}>Retry speech</Text>
              </Pressable>
            ) : null}
            {card.replayAvailable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Replay ${card.targetText}`}
                style={({ pressed }) => [
                  styles.primaryAction,
                  pressed && styles.primaryActionPressed,
                ]}
                onPress={() => onReplay(card)}>
                <Text style={styles.primaryActionText}>Replay</Text>
                <View style={styles.playDisc}>
                  <Text style={styles.playGlyph}>▶</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    flexDirection: 'row',
    borderRadius: radii.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    ...shadows.raised,
  },
  accentRail: { width: 4 },
  content: { flex: 1, minWidth: 0, padding: spacing.xl, gap: spacing.xl },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  statePill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
  },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  stateText: { ...typography.caption, textTransform: 'uppercase', letterSpacing: 0.8 },
  participant: {
    ...typography.caption,
    color: palette.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.75,
  },
  translation: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  translationCompact: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.md },
  phrase: { flex: 1, minWidth: 0, gap: spacing.xs },
  targetPhrase: { flex: 1.08 },
  language: {
    ...typography.caption,
    color: palette.textSubtle,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.25,
  },
  targetLanguage: { color: palette.accent },
  source: {
    ...typography.title,
    color: palette.text,
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '500',
  },
  target: {
    ...typography.heading,
    color: palette.accentPressed,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '600',
  },
  phraseHint: { ...typography.caption, color: palette.textSubtle, fontSize: 10 },
  arrowDisc: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  arrowDiscCompact: { alignSelf: 'flex-start', transform: [{ rotate: '90deg' }] },
  arrow: { color: palette.textMuted, fontSize: 22 },
  footer: {
    minHeight: 44,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  voiceMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  voiceGlyph: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 2 },
  voiceBar: { width: 2, borderRadius: 1, backgroundColor: palette.accent },
  voiceText: { ...typography.caption, color: palette.textSubtle },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primaryAction: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: palette.accent,
  },
  primaryActionPressed: { backgroundColor: palette.accentPressed, transform: [{ scale: 0.98 }] },
  primaryActionText: { ...typography.label, color: palette.onAccent },
  playDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  playGlyph: { color: palette.onAccent, fontSize: 10, marginLeft: 1 },
  secondaryAction: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceMuted,
  },
  secondaryActionText: { ...typography.label, color: palette.accentPressed },
  actionPressed: { opacity: 0.68 },
});
