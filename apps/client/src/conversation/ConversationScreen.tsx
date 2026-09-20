import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useSession } from '../session/SessionProvider';
import { useForegroundSession } from '../session/useForegroundSession';
import { InterventionCard } from './InterventionCard';
import type { InterventionCardModel } from './model';

export function ConversationScreen() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const session = useSession();
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
  const activities = session.state.activities.map((item) => item.replace('_', ' '));
  const status = session.state.connectionState === 'active'
    ? activities.length > 0 ? activities.join(' · ') : 'ready'
    : session.state.connectionState;
  const ended = session.state.connectionState === 'ended' || session.state.restartRequired;
  const canSwap = Object.values(session.state.speakers).filter((speaker) =>
    speaker.participantId === 'learner_1' || speaker.participantId === 'learner_2',
  ).length === 2;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{ended ? 'CONVERSATION ENDED' : 'CONVERSATION ACTIVE'}</Text>
          <Text style={styles.status} testID="conversation-status">{status}</Text>
        </View>
        <Pressable accessibilityRole="button" style={styles.endButton} onPress={end}>
          <Text style={styles.endText}>{ended ? 'Start a new conversation' : 'End'}</Text>
        </Pressable>
      </View>

      {session.state.secondsRemaining !== null ? (
        <Text style={styles.warning}>
          Session ends in {session.state.secondsRemaining} seconds.
        </Text>
      ) : null}
      {session.error || session.state.degradedCode ? (
        <View style={styles.warningPanel}>
          <Text style={styles.warningTitle}>Conversation needs attention</Text>
          <Text style={styles.warning}>
            {session.error ?? 'A provider is temporarily unavailable. Listening can continue.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.mappingRow}>
        {Object.values(session.state.speakers).map((speaker) => (
          <View key={speaker.providerLabel} style={styles.mappingPill}>
            <Text style={styles.mappingText}>{speaker.displayLabel}</Text>
          </View>
        ))}
        {session.setup?.mode === 'two_learners' ? (
          <Pressable
            accessibilityRole="button"
            style={styles.swapButton}
            disabled={!canSwap || ended}
            onPress={() =>
              session.sendControl({ type: 'speakers.swap', protocol_version: 1 })
            }
          >
            <Text style={styles.swapText}>Swap speakers</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.cards}>
        {cards.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{ended ? 'This conversation is over' : 'Listening for useful moments'}</Text>
            <Text style={styles.emptyCopy}>
              {ended ? 'Session audio and conversation state have been cleared.' :
                'Keep talking naturally. Help appears only when a learner uses a native-language fallback.'}
            </Text>
          </View>
        ) : (
          cards.map((card) => (
            <InterventionCard
              key={card.id}
              card={card}
              onReplay={replay}
              onRetry={retry}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f1eee6', paddingTop: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#d8d5ca',
  },
  eyebrow: { color: '#176445', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  status: { color: '#17241d', fontSize: 24, fontWeight: '800', textTransform: 'capitalize' },
  endButton: { borderWidth: 1, borderColor: '#b8b9af', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 },
  endText: { color: '#7d322d', fontWeight: '800' },
  warningPanel: { margin: 16, borderRadius: 14, padding: 14, backgroundColor: '#f4dfd8', gap: 3 },
  warningTitle: { color: '#732f2a', fontWeight: '800' },
  warning: { color: '#854239', paddingHorizontal: 20, paddingTop: 8 },
  mappingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 16 },
  mappingPill: { backgroundColor: '#dce9df', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  mappingText: { color: '#24553f', fontSize: 13, fontWeight: '700' },
  swapButton: { paddingHorizontal: 10, paddingVertical: 7 },
  swapText: { color: '#176445', fontWeight: '800', fontSize: 13 },
  cards: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 16, paddingBottom: 60, gap: 12 },
  empty: { borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: '#bfc4ba', padding: 28, gap: 7 },
  emptyTitle: { color: '#25372d', fontSize: 18, fontWeight: '700' },
  emptyCopy: { color: '#65746c', fontSize: 14, lineHeight: 21 },
});
