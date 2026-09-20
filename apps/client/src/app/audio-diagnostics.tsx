import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { usePcmCapture } from '../audio/usePcmCapture';

export default function AudioDiagnosticsScreen() {
  const [available] = useState(__DEV__);
  const capture = usePcmCapture({ onFrame: () => undefined });

  if (!available) {
    return null;
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title}>PCM diagnostics</Text>
      <Text>State: {capture.state}</Text>
      <Text>Sample rate: {capture.diagnostics.sampleRate ?? 'waiting'}</Text>
      <Text>Channels: {capture.diagnostics.channels ?? 'waiting'}</Text>
      <Text>Encoding: {capture.diagnostics.encoding}</Text>
      <Text>Frames: {capture.diagnostics.emittedFrameCount}</Text>
      <Text>Last frame bytes: {capture.diagnostics.lastFrameByteLength ?? 'waiting'}</Text>
      <View style={styles.controls}>
        <Button title="Start" onPress={() => void capture.start()} />
        <Button title="Stop" onPress={capture.stop} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: '700' },
  controls: { flexDirection: 'row', gap: 12 },
});
