import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '../session/SessionProvider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
