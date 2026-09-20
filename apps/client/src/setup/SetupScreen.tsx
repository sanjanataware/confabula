import { Picker } from '@react-native-picker/picker';
import { getLocales } from 'expo-localization';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  discoverBackend,
  type CapabilitiesResponse,
  type HealthResponse,
} from '../services/capabilities';
import { useSession } from '../session/SessionProvider';
import { createSetupModel, setMode, type SetupModel } from './model';
import { validateSetup } from './validation';

export function SetupScreen() {
  const router = useRouter();
  const session = useSession();
  const [model, setModel] = useState(createSetupModel);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const discoveryGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++discoveryGeneration.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await discoverBackend(model.backendBaseUrl);
      if (generation !== discoveryGeneration.current) return;
      setCapabilities(result.capabilities);
      setHealth(result.health);
      const locale = getLocales()[0]?.languageCode;
      if (
        locale &&
        result.capabilities.languages.some((item) => item.code === locale)
      ) {
        setModel((current) =>
          current.learner1NativeLanguage
            ? current
            : { ...current, learner1NativeLanguage: locale },
        );
      }
    } catch {
      if (generation !== discoveryGeneration.current) return;
      setCapabilities(null);
      setHealth(null);
      setLoadError('Could not reach the backend. Check the address and try again.');
    } finally {
      if (generation === discoveryGeneration.current) setLoading(false);
    }
  }, [model.backendBaseUrl]);

  useEffect(() => {
    void refresh();
    return () => { discoveryGeneration.current += 1; };
  }, []);

  const errors = useMemo(
    () => validateSetup(model, capabilities),
    [model, capabilities],
  );
  const canStart =
    !loading &&
    health?.status === 'ok' &&
    Object.keys(errors).length === 0 &&
    !session.starting;

  const update = <Key extends keyof SetupModel>(
    key: Key,
    value: SetupModel[Key],
  ) => {
    setModel((current) => ({ ...current, [key]: value }));
    if (key.endsWith('Language')) setSubmitted(true);
    if (key === 'backendBaseUrl') {
      discoveryGeneration.current += 1;
      setCapabilities(null);
      setHealth(null);
      setLoading(false);
    }
  };

  const start = async () => {
    setSubmitted(true);
    if (!canStart) {
      return;
    }
    if (await session.startConversation(model)) {
      router.replace('/conversation');
    }
  };

  const providerMessage = health?.status === 'not_ready'
    ? 'Backend needs Meta configuration.'
    : null;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>LIVE LANGUAGE SUPPORT</Text>
        <Text style={styles.title}>Keep the conversation moving.</Text>
        <Text style={styles.intro}>
          When a learner reaches for a word from their native language, the coach
          shows and speaks only the useful translation.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Local connection</Text>
        <Text style={styles.label}>Backend address</Text>
        <TextInput
          accessibilityLabel="Backend address"
          testID="backend-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          value={model.backendBaseUrl}
          onChangeText={(value) => update('backendBaseUrl', value)}
        />
        <Text style={styles.label}>Temporary pairing token</Text>
        <TextInput
          accessibilityLabel="Temporary pairing token"
          testID="pairing-token"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
          value={model.pairingToken}
          onChangeText={(value) => update('pairingToken', value)}
        />
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => void refresh()}>
          <Text style={styles.secondaryButtonText}>Check backend</Text>
        </Pressable>
        {loading ? <ActivityIndicator accessibilityLabel="Loading backend" /> : null}
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
        {providerMessage ? <Text style={styles.error}>{providerMessage}</Text> : null}
        {health?.status === 'ok' ? (
          <Text style={styles.ready}>Meta and local speech are ready.</Text>
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.sectionTitle}>Two learners</Text>
            <Text style={styles.hint}>Analyze the first two distinct speakers.</Text>
          </View>
          <Switch
            accessibilityLabel="Two learners"
            testID="two-learners"
            value={model.mode === 'two_learners'}
            onValueChange={(enabled) =>
              setModel((current) =>
                setMode(current, enabled ? 'two_learners' : 'learner_fluent'),
              )
            }
          />
        </View>

        <LanguagePicker
          label="Learner 1 native language"
          testID="learner-1-language"
          value={model.learner1NativeLanguage}
          capabilities={capabilities}
          onChange={(value) => update('learner1NativeLanguage', value)}
        />
        {submitted && errors.learner1NativeLanguage ? (
          <Text style={styles.error}>{errors.learner1NativeLanguage}</Text>
        ) : null}

        {model.mode === 'two_learners' ? (
          <>
            <LanguagePicker
              label="Learner 2 native language"
              testID="learner-2-language"
              value={model.learner2NativeLanguage}
              capabilities={capabilities}
              onChange={(value) => update('learner2NativeLanguage', value)}
            />
            {submitted && errors.learner2NativeLanguage ? (
              <Text style={styles.error}>{errors.learner2NativeLanguage}</Text>
            ) : null}
          </>
        ) : null}

        <LanguagePicker
          label="Shared learning language"
          testID="learning-language"
          value={model.learningLanguage}
          capabilities={capabilities}
          onChange={(value) => update('learningLanguage', value)}
        />
        {submitted && errors.learningLanguage ? (
          <Text style={styles.error}>{errors.learningLanguage}</Text>
        ) : null}

        <View style={styles.instruction}>
          <Text style={styles.instructionTitle}>Speaking order matters</Text>
          <Text style={styles.hint}>
            {model.mode === 'two_learners'
              ? 'Learner 1 should speak first; Learner 2 should be the next distinct speaker. You can swap them later.'
              : 'The learner must speak first. The next distinct speaker is treated as the fluent partner.'}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: model.disclosureAccepted }}
        accessibilityLabel="Acknowledge provider processing"
        testID="processing-disclosure"
        style={styles.disclosure}
        onPress={() => update('disclosureAccepted', !model.disclosureAccepted)}
      >
        <View style={[styles.checkbox, model.disclosureAccepted && styles.checkboxChecked]} />
        <Text style={styles.disclosureText}>
          I understand that microphone audio and text go to Meta, translated speech
          is generated locally by the backend or a device fallback, and internet is
          required for Meta while some fallback voices may require a download.
        </Text>
      </Pressable>

      {session.error ? <Text style={styles.error}>{session.error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start conversation"
        testID="start-conversation"
        disabled={!canStart}
        style={[styles.primaryButton, !canStart && styles.disabledButton]}
        onPress={() => void start()}
      >
        <Text style={styles.primaryButtonText}>
          {session.starting ? 'Starting…' : 'Start conversation'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

type LanguagePickerProps = {
  label: string;
  testID: string;
  value: string;
  capabilities: CapabilitiesResponse | null;
  onChange: (value: string) => void;
};

function LanguagePicker({
  label,
  testID,
  value,
  capabilities,
  onChange,
}: LanguagePickerProps) {
  return (
    <View style={styles.pickerGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pickerShell}>
        <Picker
          accessibilityLabel={label}
          testID={testID}
          selectedValue={value}
          onValueChange={(selected) => onChange(String(selected))}
        >
          <Picker.Item label="Choose a language" value="" />
          {capabilities?.languages.map((language) => (
            <Picker.Item
              key={language.code}
              label={language.display_name}
              value={language.code}
            />
          ))}
        </Picker>
      </View>
    </View>
  );
}

const colors = {
  ink: '#17241d',
  muted: '#5f6f66',
  paper: '#f3f0e8',
  white: '#fffdf8',
  green: '#176445',
  paleGreen: '#dceadf',
  border: '#d9d6ca',
  red: '#a13c32',
};

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    backgroundColor: colors.paper,
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 56,
    gap: 18,
  },
  hero: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 10 },
  eyebrow: { color: colors.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: colors.ink, fontSize: 38, lineHeight: 43, fontWeight: '800' },
  intro: { color: colors.muted, fontSize: 17, lineHeight: 25, maxWidth: 620 },
  panel: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    borderRadius: 22,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
  },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginTop: 6 },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 13,
    color: colors.ink,
    backgroundColor: '#ffffff',
  },
  secondaryButton: { alignSelf: 'flex-start', paddingVertical: 7 },
  secondaryButtonText: { color: colors.green, fontSize: 14, fontWeight: '700' },
  ready: { color: colors.green, fontWeight: '600' },
  error: { color: colors.red, fontSize: 14, lineHeight: 20 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleCopy: { flex: 1, paddingRight: 16, gap: 3 },
  pickerGroup: { gap: 5 },
  pickerShell: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  instruction: { marginTop: 10, backgroundColor: colors.paleGreen, borderRadius: 14, padding: 14, gap: 4 },
  instructionTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  disclosure: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 4,
  },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.green, marginTop: 1 },
  checkboxChecked: { backgroundColor: colors.green },
  disclosureText: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 20 },
  primaryButton: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.green,
  },
  disabledButton: { opacity: 0.42 },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
});
