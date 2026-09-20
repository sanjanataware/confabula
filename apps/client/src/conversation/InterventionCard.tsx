import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { InterventionCardModel } from './model';

export type InterventionCardProps = {
  card: InterventionCardModel;
  onReplay: (card: InterventionCardModel) => void;
  onRetry: (card: InterventionCardModel) => void;
};

export function InterventionCard({ card, onReplay, onRetry }: InterventionCardProps) {
  const stateLabel = {
    preview: 'Checking…',
    committed: 'Translation ready',
    audio_ready: 'Ready to speak',
    audio_failed: 'Speech unavailable',
    interrupted: 'Playback stopped',
  }[card.status];

  return (
    <View style={styles.card} testID={`intervention-${card.id}`}>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{stateLabel}</Text>
        <Text style={styles.meta}>{card.participantId.replace('_', ' ')}</Text>
      </View>
      <View style={styles.translationRow}>
        <View style={styles.phrase}>
          <Text style={styles.language}>{card.sourceLanguage.toUpperCase()}</Text>
          <Text style={styles.source}>{card.sourceText}</Text>
        </View>
        <Text style={styles.arrow} accessibilityLabel="translates to">→</Text>
        <View style={styles.phrase}>
          <Text style={styles.language}>{card.targetLanguage.toUpperCase()}</Text>
          <Text style={styles.target}>{card.targetText}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {card.replayAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Replay ${card.targetText}`}
            style={styles.action}
            onPress={() => onReplay(card)}
          >
            <Text style={styles.actionText}>Replay</Text>
          </Pressable>
        ) : null}
        {card.retryAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry speech"
            style={styles.action}
            onPress={() => onRetry(card)}
          >
            <Text style={styles.actionText}>Retry speech</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#d8d8cc',
    gap: 16,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  meta: { color: '#64736b', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  translationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  phrase: { flex: 1, gap: 5 },
  language: { color: '#718078', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  source: { color: '#24342b', fontSize: 20, fontWeight: '600' },
  target: { color: '#125c3e', fontSize: 22, fontWeight: '800' },
  arrow: { color: '#7b8a81', fontSize: 24 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { borderRadius: 10, backgroundColor: '#e0ece2', paddingHorizontal: 13, paddingVertical: 8 },
  actionText: { color: '#125c3e', fontWeight: '800' },
});
