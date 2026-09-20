import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  AmbientBackdrop,
  BrandMark,
  colors,
  radii,
  Reveal,
  shadows,
  spacing,
  typography,
} from '../design';
import { useSession } from '../session/SessionProvider';
import { useForegroundSession } from '../session/useForegroundSession';
import { InterventionCard } from './InterventionCard';
import type { InterventionCardModel } from './model';

const palette = colors.light;

export function ConversationScreen() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const session = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const compact = width < 600;
  const narrow = width < 360;
  const routeMounted = useRef(false);
  const endConversation = session.endConversation;
  const end = useCallback(() => {
    endConversation();
    router.replace('/');
  }, [router, endConversation]);
  useForegroundSession(end);

  useEffect(() => {
    routeMounted.current = true;
    return () => {
      routeMounted.current = false;
      queueMicrotask(() => { if (!routeMounted.current) endConversation(); });
    };
  }, [endConversation]);

  useEffect(() => {
    if (!session.setup && session.state.connectionState === 'idle' && !session.starting) {
      router.replace('/');
    }
  }, [router, session.setup, session.state.connectionState, session.starting]);

  const cards = useMemo(
    () =>
      session.state.interventionOrder
        .map((id) => session.state.interventions[id])
        .filter((card): card is InterventionCardModel => Boolean(card)),
    [session.state.interventionOrder, session.state.interventions],
  );

  const replay = (card: InterventionCardModel) => session.replay(card.id);
  const retry = (card: InterventionCardModel) => {
    session.sendControl({
      type: 'intervention.audio_retry',
      protocol_version: 1,
      intervention_id: card.id,
    });
  };
  const ended = session.state.connectionState === 'ended' || session.state.restartRequired;
  const canSwap = Object.values(session.state.speakers).filter((speaker) =>
    speaker.participantId === 'learner_1' || speaker.participantId === 'learner_2',
  ).length === 2;
  const visualState = getVisualState(session.state.connectionState, session.state.activities, ended);

  return (
    <View style={styles.screen}>
      <AmbientBackdrop />
      <View style={[styles.header, compact && styles.headerCompact]}>
        <View style={styles.headerInner}>
          <View style={styles.brandRow}>
            <BrandMark size={34} decorative />
            <View>
              <Text style={styles.brandName}>Conversation coach</Text>
              {!narrow ? <Text style={styles.brandMeta}>SESSION IN PROGRESS</Text> : null}
            </View>
          </View>
          <View style={styles.headerActions}>
            {!compact ? (
              <View
                accessibilityLabel={`Coach is ${visualState.label}`}
                style={styles.livePill}>
                <View style={[styles.liveDot, { backgroundColor: visualState.color }]} />
                <Text style={styles.liveText}>{visualState.label}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ended ? 'Start a new conversation' : 'End'}
              accessibilityHint="Ends and clears the current conversation"
              style={({ pressed }) => [
                styles.endButton,
                pressed && styles.endButtonPressed,
              ]}
              onPress={end}>
              <Text style={styles.endText}>
                {ended ? 'Start a new conversation' : 'End'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.page,
          compact && styles.pageCompact,
        ]}>
        {session.state.secondsRemaining !== null ? (
          <View style={styles.expiryBanner} accessibilityLiveRegion="polite">
            <Text style={styles.expiryLabel}>SESSION LIMIT</Text>
            <Text style={styles.expiryCopy}>
              This conversation ends in {session.state.secondsRemaining} seconds.
            </Text>
          </View>
        ) : null}
        {session.error || session.state.degradedCode ? (
          <View style={styles.warningPanel} accessibilityLiveRegion="assertive">
            <View style={styles.warningMark}>!</View>
            <View style={styles.warningBody}>
              <Text style={styles.warningTitle}>Conversation needs attention</Text>
              <Text style={styles.warningCopy}>
                {session.error ?? 'A provider is temporarily unavailable. Listening can continue.'}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.workspace, wide && styles.workspaceWide]}>
          <Reveal style={[styles.sessionRail, wide && styles.sessionRailWide]}>
            <View style={[styles.sessionCard, compact && styles.sessionCardCompact]}>
              <Text style={styles.railEyebrow}>{ended ? 'SESSION COMPLETE' : 'LIVE COACH'}</Text>
              <ConversationPulse
                active={!ended && session.state.connectionState === 'active'}
                color={visualState.color}
                activity={visualState.label}
                compact={compact}
              />
              <Text
                accessibilityLiveRegion="polite"
                style={styles.status}
                testID="conversation-status">
                {visualState.title}
              </Text>
              <Text style={styles.statusCopy}>{visualState.copy}</Text>

              <View style={styles.signalLine}>
                <View style={styles.signalItem}>
                  <Text style={styles.signalValue}>{cards.length}</Text>
                  <Text style={styles.signalLabel}>helpful moments</Text>
                </View>
                <View style={styles.signalDivider} />
                <View style={styles.signalItem}>
                  <Text style={styles.signalValue}>{session.captureEnabled ? 'On' : 'Off'}</Text>
                  <Text style={styles.signalLabel}>microphone</Text>
                </View>
              </View>

              <View style={styles.speakerSection}>
                <View style={styles.speakerHeader}>
                  <Text style={styles.speakerTitle}>Voices in this session</Text>
                  {session.setup?.mode === 'two_learners' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Swap speakers"
                      accessibilityHint="Reverses Learner 1 and Learner 2 assignments"
                      style={({ pressed }) => [
                        styles.swapButton,
                        (!canSwap || ended) && styles.swapButtonDisabled,
                        pressed && canSwap && !ended && styles.buttonPressed,
                      ]}
                      disabled={!canSwap || ended}
                      onPress={() =>
                        session.sendControl({ type: 'speakers.swap', protocol_version: 1 })
                      }>
                      <Text style={styles.swapText}>Swap speakers</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.mappingList}>
                  {Object.values(session.state.speakers).length ? (
                    Object.values(session.state.speakers).map((speaker, index) => (
                      <View key={speaker.providerLabel} style={styles.mappingPill}>
                        <View style={[
                          styles.speakerDot,
                          { backgroundColor: index % 2 ? '#C99270' : palette.accent },
                        ]} />
                        <Text style={styles.mappingText}>{speaker.displayLabel}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.waitingSpeaker}>The first voice becomes the learner.</Text>
                  )}
                </View>
              </View>
            </View>
          </Reveal>

          <View style={styles.feed}>
            <View style={styles.feedHeader}>
              <View>
                <Text style={styles.feedEyebrow}>INTERVENTION-ONLY VIEW</Text>
                <Text style={styles.feedTitle}>Helpful moments</Text>
              </View>
              <View style={styles.countPill}>
                <Text style={styles.countText}>{cards.length}</Text>
              </View>
            </View>

            {cards.length === 0 ? (
              <Reveal delay={100} style={styles.empty}>
                <View style={styles.emptyWave} accessibilityElementsHidden>
                  {[18, 34, 52, 30, 42, 22].map((height, index) => (
                    <View key={index} style={[styles.waveBar, { height }]} />
                  ))}
                </View>
                <Text style={styles.emptyTitle}>
                  {ended ? 'This conversation is over' : 'Listening for useful moments'}
                </Text>
                <Text style={styles.emptyCopy}>
                  {ended
                    ? 'Session audio and conversation state have been cleared.'
                    : 'Keep talking naturally. Help appears only when a learner reaches for a native-language fallback.'}
                </Text>
                {!ended ? (
                  <View style={styles.emptyHint}>
                    <View style={styles.emptyHintDot} />
                    <Text style={styles.emptyHintText}>No transcript is shown or saved</Text>
                  </View>
                ) : null}
              </Reveal>
            ) : (
              <View style={styles.cards}>
                {cards.map((card, index) => (
                  <Reveal key={card.id} delay={Math.min(index * 55, 220)}>
                    <InterventionCard
                      card={card}
                      onReplay={replay}
                      onRetry={retry}
                    />
                  </Reveal>
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

type VisualState = {
  label: string;
  title: string;
  copy: string;
  color: string;
};

function getVisualState(
  connectionState: string,
  activities: string[],
  ended: boolean,
): VisualState {
  if (ended) return {
    label: 'ended',
    title: 'Session ended',
    copy: 'Everything from this conversation has been cleared.',
    color: palette.textSubtle,
  };
  if (connectionState === 'connecting') return {
    label: 'connecting',
    title: 'Connecting',
    copy: 'Opening a private session with the local coach.',
    color: palette.caution,
  };
  if (connectionState === 'degraded') return {
    label: 'attention',
    title: 'Needs attention',
    copy: 'The card remains available while the coach recovers.',
    color: palette.critical,
  };
  if (activities.includes('speaking')) return {
    label: 'speaking',
    title: 'Speaking',
    copy: 'Sharing the learning-language phrase now.',
    color: '#C99270',
  };
  if (activities.includes('analyzing')) return {
    label: 'analyzing',
    title: 'Finding the phrase',
    copy: 'Checking whether this moment needs a little help.',
    color: palette.caution,
  };
  if (activities.includes('audio_pending')) return {
    label: 'preparing',
    title: 'Preparing the voice',
    copy: 'The translation is ready; speech is being prepared locally.',
    color: palette.caution,
  };
  if (activities.includes('listening')) return {
    label: 'listening',
    title: 'Listening',
    copy: 'Speak naturally. The coach stays quiet until it can help.',
    color: palette.positive,
  };
  return {
    label: connectionState,
    title: 'Ready',
    copy: 'The coach is ready for the learner to speak first.',
    color: palette.accent,
  };
}

function ConversationPulse({
  active,
  color,
  activity,
  compact,
}: {
  active: boolean;
  color: string;
  activity: string;
  compact: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    progress.stopAnimation();
    if (!active || reducedMotion) {
      progress.setValue(active ? 0.35 : 0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, progress, reducedMotion]);

  return (
    <View
      accessibilityLabel={`Coach is ${activity}`}
      accessibilityRole="image"
      style={[styles.pulseFrame, compact && styles.pulseFrameCompact]}>
      <Animated.View style={[
        styles.pulseHalo,
        compact && styles.pulseHaloCompact,
        {
          borderColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.52] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.08] }) }],
        },
      ]} />
      <View style={[
        styles.pulseCore,
        compact && styles.pulseCoreCompact,
        { backgroundColor: color },
      ]}>
        <View style={styles.pulseBars}>
          {[18, 34, 25].map((height, index) => (
            <View key={index} style={[styles.pulseBar, { height }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  header: {
    minHeight: 84,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: 'rgba(245,244,239,0.86)',
    paddingHorizontal: spacing.xxxl,
    justifyContent: 'center',
  },
  headerCompact: { minHeight: 74, paddingHorizontal: spacing.lg },
  headerInner: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: spacing.md },
  brandName: { ...typography.label, color: palette.text, fontSize: 14 },
  brandMeta: { ...typography.caption, color: palette.textSubtle, fontSize: 9, letterSpacing: 1.1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  livePill: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { ...typography.caption, color: palette.textMuted, textTransform: 'capitalize' },
  endButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: '#D9C7C3',
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,254,250,0.78)',
  },
  endButtonPressed: { backgroundColor: '#F3E3E0', transform: [{ scale: 0.98 }] },
  endText: { ...typography.label, color: palette.critical },
  page: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.giant,
    gap: spacing.lg,
  },
  pageCompact: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  workspace: { gap: spacing.xl },
  workspaceWide: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxxl },
  sessionRail: { width: '100%' },
  sessionRailWide: { width: 330, flexShrink: 0 },
  sessionCard: {
    padding: spacing.xxl,
    gap: spacing.md,
    borderRadius: radii.xxl,
    backgroundColor: 'rgba(255,254,250,0.94)',
    borderWidth: 1,
    borderColor: palette.border,
    ...shadows.raised,
  },
  sessionCardCompact: { padding: spacing.xl },
  railEyebrow: { ...typography.caption, color: palette.accent, letterSpacing: 1.4 },
  pulseFrame: { height: 164, alignItems: 'center', justifyContent: 'center' },
  pulseFrameCompact: { height: 132 },
  pulseHalo: {
    position: 'absolute',
    width: 146,
    height: 146,
    borderRadius: 73,
    borderWidth: 1,
  },
  pulseHaloCompact: { width: 116, height: 116, borderRadius: 58 },
  pulseCore: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  pulseCoreCompact: { width: 88, height: 88, borderRadius: 44 },
  pulseBars: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pulseBar: { width: 5, borderRadius: 3, backgroundColor: '#F8FCFA' },
  status: { ...typography.heading, color: palette.text, textAlign: 'center', textTransform: 'capitalize' },
  statusCopy: { ...typography.callout, color: palette.textMuted, textAlign: 'center', minHeight: 44 },
  signalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.border,
  },
  signalItem: { flex: 1, alignItems: 'center', gap: spacing.xs },
  signalValue: { ...typography.title, color: palette.text, fontSize: 18 },
  signalLabel: { ...typography.caption, color: palette.textSubtle },
  signalDivider: { width: 1, height: 34, backgroundColor: palette.border },
  speakerSection: { gap: spacing.md, paddingTop: spacing.sm },
  speakerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  speakerTitle: { ...typography.label, color: palette.text },
  mappingList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mappingPill: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceMuted,
  },
  speakerDot: { width: 7, height: 7, borderRadius: 4 },
  mappingText: { ...typography.caption, color: palette.textMuted },
  waitingSpeaker: { ...typography.caption, color: palette.textSubtle },
  swapButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.sm },
  swapButtonDisabled: { opacity: 0.4 },
  swapText: { ...typography.caption, color: palette.accent, fontWeight: '600' },
  buttonPressed: { opacity: 0.68 },
  feed: { flex: 1, minWidth: 0, gap: spacing.xl },
  feedHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  feedEyebrow: { ...typography.caption, color: palette.textSubtle, fontSize: 9, letterSpacing: 1.35 },
  feedTitle: { ...typography.heading, color: palette.text },
  countPill: {
    minWidth: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: palette.accentSoft,
  },
  countText: { ...typography.label, color: palette.accent },
  cards: { gap: spacing.md },
  empty: {
    minHeight: 390,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
    gap: spacing.md,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: 'rgba(255,254,250,0.72)',
  },
  emptyWave: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 7 },
  waveBar: { width: 6, borderRadius: 3, backgroundColor: palette.accent, opacity: 0.72 },
  emptyTitle: { ...typography.title, color: palette.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center', maxWidth: 460 },
  emptyHint: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceMuted,
  },
  emptyHintDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.positive },
  emptyHintText: { ...typography.caption, color: palette.textMuted },
  warningPanel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: '#F5E6E3',
    borderWidth: 1,
    borderColor: '#E7C6C1',
  },
  warningMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    textAlign: 'center',
    lineHeight: 28,
    color: '#FFF8F7',
    backgroundColor: palette.critical,
    fontWeight: '800',
  },
  warningBody: { flex: 1, gap: spacing.xs },
  warningTitle: { ...typography.label, color: '#713936' },
  warningCopy: { ...typography.callout, color: '#81504C' },
  expiryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: '#F4EBDD',
  },
  expiryLabel: { ...typography.caption, color: palette.caution, letterSpacing: 1 },
  expiryCopy: { ...typography.callout, color: '#715C3D', flex: 1 },
});
