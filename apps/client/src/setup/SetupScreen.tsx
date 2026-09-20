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
import {
  discoverBackend,
  type CapabilitiesResponse,
  type HealthResponse,
} from '../services/capabilities';
import { useSession } from '../session/SessionProvider';
import { createSetupModel, setMode, type SetupModel } from './model';
import {
  clearPairingFragment,
  consumePairingFragment,
} from './pairingBootstrap';
import { validateSetup } from './validation';

const palette = colors.light;

export function SetupScreen() {
  const router = useRouter();
  const session = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const compact = width < 600;
  const narrow = width < 360;
  const [pairingBootstrap] = useState(consumePairingFragment);
  const [showConnectionSettings, setShowConnectionSettings] = useState(!pairingBootstrap);
  const [model, setModel] = useState(() => ({
    ...createSetupModel(),
    pairingToken: pairingBootstrap ?? '',
  }));
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

  useEffect(() => {
    if (!pairingBootstrap) return undefined;
    const cleanup = setTimeout(clearPairingFragment, 0);
    return () => clearTimeout(cleanup);
  }, [pairingBootstrap]);

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
    if (!canStart) return;
    if (await session.startConversation(model)) {
      router.replace('/conversation');
    }
  };

  const providerMessage = health?.status === 'not_ready'
    ? 'Backend needs Meta configuration.'
    : null;
  const connectionTone = loadError || providerMessage
    ? 'error'
    : health?.status === 'ok'
      ? 'ready'
      : 'idle';
  const connectionCopy = loadError ?? providerMessage ?? (
    loading
      ? 'Checking the local coach…'
      : health?.status === 'ok'
        ? 'Meta and local speech are ready.'
        : 'Check the backend before starting.'
  );

  return (
    <View style={styles.screen}>
      <AmbientBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.page,
          compact && styles.pageCompact,
        ]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.topbar}>
          <View style={styles.brandRow}>
            <BrandMark size={36} decorative />
            <View>
              <Text style={styles.brandName}>Conversation coach</Text>
              {!narrow ? <Text style={styles.brandMeta}>LOCAL-FIRST · SESSION-ONLY</Text> : null}
            </View>
          </View>
          <View
            accessibilityLabel="Private session. Nothing is saved"
            style={[styles.privacyPill, narrow && styles.privacyPillNarrow]}>
            <View style={styles.privacyDot} />
            <Text style={styles.privacyText}>
              {narrow ? 'Private' : compact ? 'Private session' : 'Nothing is saved'}
            </Text>
          </View>
        </View>

        <View style={[styles.layout, wide && styles.layoutWide]}>
          <Reveal style={[styles.hero, wide && styles.heroWide]}>
            <Text style={styles.eyebrow}>LIVE LANGUAGE SUPPORT</Text>
            <Text style={[styles.title, compact && styles.titleCompact]}>
              Stay in the conversation.
            </Text>
            <Text style={styles.intro}>
              When a word goes missing, the coach quietly surfaces the phrase you
              needed—and says it when there is room to listen.
            </Text>

            <View style={styles.exampleCard} accessibilityLabel="Example translation: grocery store translates to supermercado">
              <View style={styles.exampleTopline}>
                <Text style={styles.exampleKicker}>A helpful moment</Text>
                <View style={styles.exampleStatus}>
                  <View style={styles.exampleStatusDot} />
                  <Text style={styles.exampleStatusText}>ready to speak</Text>
                </View>
              </View>
              <View style={[styles.exampleTranslation, compact && styles.exampleTranslationCompact]}>
                <View style={styles.examplePhrase}>
                  <Text style={styles.languageCode}>EN</Text>
                  <Text style={styles.exampleSource}>grocery store</Text>
                </View>
                <View style={[styles.arrowDisc, compact && styles.exampleArrowCompact]}>
                  <Text style={styles.arrow}>→</Text>
                </View>
                <View style={styles.examplePhrase}>
                  <Text style={styles.languageCode}>ES</Text>
                  <Text style={styles.exampleTarget}>supermercado</Text>
                </View>
              </View>
            </View>

            {!compact ? (
              <View style={styles.promiseGrid}>
                <PromiseItem index="01" title="Only useful phrases" copy="No running transcript or grammar feed." />
                <PromiseItem index="02" title="Speaks at the right time" copy="Waits for a natural pause before helping." />
                <PromiseItem index="03" title="Ends without a trace" copy="Session text and audio clear when you leave." />
              </View>
            ) : null}
          </Reveal>

          <Reveal delay={90} style={[styles.formColumn, wide && styles.formColumnWide]}>
            <View style={styles.formSurface}>
              <View style={styles.formHeader}>
                <View>
                  <Text style={styles.formEyebrow}>NEW SESSION</Text>
                  <Text style={styles.formTitle}>Set the conversation</Text>
                </View>
                <Text style={styles.formTime}>about 1 min</Text>
              </View>

              <View style={styles.section}>
                <SectionHeading number="01" title="Connect locally" />
                {pairingBootstrap && !showConnectionSettings ? (
                  <View style={[
                    styles.importedConnection,
                    compact && styles.importedConnectionCompact,
                  ]}>
                    <View style={styles.importedCheck}>
                      <Text style={styles.importedCheckmark}>✓</Text>
                    </View>
                    <View style={styles.importedCopy}>
                      <Text style={styles.importedTitle}>Secure connection details added</Text>
                      <Text style={styles.importedHint}>
                        The temporary token came from the backend link and was removed from the address bar.
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Show connection settings"
                      style={({ pressed }) => [
                        styles.settingsButton,
                        compact && styles.settingsButtonCompact,
                        pressed && styles.buttonPressed,
                      ]}
                      onPress={() => setShowConnectionSettings(true)}>
                      <Text style={styles.settingsButtonText}>Settings</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Text style={styles.label}>Backend address</Text>
                    <TextInput
                      accessibilityLabel="Backend address"
                      accessibilityHint="Address of the local language coach backend"
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
                      accessibilityHint="Token printed by the backend when it starts"
                      testID="pairing-token"
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      style={styles.input}
                      value={model.pairingToken}
                      onChangeText={(value) => update('pairingToken', value)}
                    />
                  </>
                )}
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.connectionState,
                    connectionTone === 'ready' && styles.connectionStateReady,
                    connectionTone === 'error' && styles.connectionStateError,
                  ]}>
                  {loading ? (
                    <ActivityIndicator
                      accessibilityLabel="Loading backend"
                      color={palette.accent}
                      size="small"
                    />
                  ) : (
                    <View style={[
                      styles.stateDot,
                      connectionTone === 'ready' && styles.stateDotReady,
                      connectionTone === 'error' && styles.stateDotError,
                    ]} />
                  )}
                  <Text style={[
                    styles.connectionCopy,
                    connectionTone === 'error' && styles.errorText,
                  ]}>
                    {connectionCopy}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Check backend"
                    style={({ pressed }) => [
                      styles.checkButton,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => void refresh()}>
                    <Text style={styles.checkButtonText}>Check</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.section}>
                <View style={styles.modeRow}>
                  <SectionHeading number="02" title="Choose the speakers" />
                  <View style={styles.toggleControl}>
                    <Text style={styles.toggleLabel}>Two learners</Text>
                    <Switch
                      accessibilityLabel="Two learners"
                      accessibilityHint="Analyze the first two distinct speakers"
                      testID="two-learners"
                      value={model.mode === 'two_learners'}
                      trackColor={{ false: palette.borderStrong, true: palette.accent }}
                      thumbColor={palette.surface}
                      onValueChange={(enabled) =>
                        setModel((current) =>
                          setMode(current, enabled ? 'two_learners' : 'learner_fluent'),
                        )
                      }
                    />
                  </View>
                </View>
                <Text style={styles.sectionHint}>
                  {model.mode === 'two_learners'
                    ? 'The first two distinct voices become Learner 1 and Learner 2.'
                    : 'The first voice is the learner; the next becomes the fluent partner.'}
                </Text>

                <View style={[styles.languageGrid, wide && styles.languageGridWide]}>
                  <LanguagePicker
                    label="Learner 1 native language"
                    testID="learner-1-language"
                    value={model.learner1NativeLanguage}
                    capabilities={capabilities}
                    onChange={(value) => update('learner1NativeLanguage', value)}
                  />
                  {model.mode === 'two_learners' ? (
                    <LanguagePicker
                      label="Learner 2 native language"
                      testID="learner-2-language"
                      value={model.learner2NativeLanguage}
                      capabilities={capabilities}
                      onChange={(value) => update('learner2NativeLanguage', value)}
                    />
                  ) : null}
                  <LanguagePicker
                    label="Shared learning language"
                    testID="learning-language"
                    value={model.learningLanguage}
                    capabilities={capabilities}
                    onChange={(value) => update('learningLanguage', value)}
                  />
                </View>
                {submitted && errors.learner1NativeLanguage ? (
                  <Text style={styles.errorText}>{errors.learner1NativeLanguage}</Text>
                ) : null}
                {submitted && errors.learner2NativeLanguage ? (
                  <Text style={styles.errorText}>{errors.learner2NativeLanguage}</Text>
                ) : null}
                {submitted && errors.learningLanguage ? (
                  <Text style={styles.errorText}>{errors.learningLanguage}</Text>
                ) : null}

                <View style={styles.orderNote}>
                  <Text style={styles.orderIndex}>FIRST WORD</Text>
                  <Text style={styles.orderTitle}>Speaking order matters</Text>
                  <Text style={styles.orderCopy}>
                    {model.mode === 'two_learners'
                      ? 'Learner 1 speaks first. Learner 2 should be the next distinct voice; you can swap them later.'
                      : 'The learner speaks first. The next distinct voice is treated as the fluent partner.'}
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: model.disclosureAccepted }}
                accessibilityLabel="Acknowledge provider processing"
                accessibilityHint="Required before starting a conversation"
                testID="processing-disclosure"
                style={({ pressed }) => [
                  styles.disclosure,
                  pressed && styles.disclosurePressed,
                ]}
                onPress={() => update('disclosureAccepted', !model.disclosureAccepted)}>
                <View style={[
                  styles.checkbox,
                  model.disclosureAccepted && styles.checkboxChecked,
                ]}>
                  {model.disclosureAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <Text style={styles.disclosureText}>
                  I understand that microphone audio and text go to Meta, translated speech
                  is generated locally by the backend or a device fallback, and internet is
                  required for Meta while some fallback voices may require a download.
                </Text>
              </Pressable>

              {session.error ? (
                <View style={styles.sessionError} accessibilityLiveRegion="assertive">
                  <Text style={styles.sessionErrorText}>{session.error}</Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start conversation"
                accessibilityHint="Opens the foreground-only conversation screen"
                testID="start-conversation"
                disabled={!canStart}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !canStart && styles.disabledButton,
                  pressed && canStart && styles.primaryButtonPressed,
                ]}
                onPress={() => void start()}>
                <Text style={styles.primaryButtonText}>
                  {session.starting ? 'Starting…' : 'Start conversation'}
                </Text>
                <View style={styles.buttonArrowDisc}>
                  <Text style={styles.buttonArrow}>→</Text>
                </View>
              </Pressable>

              <Text style={styles.footerNote}>
                Foreground only · Up to 50 minutes · No conversation history
              </Text>
            </View>
          </Reveal>
        </View>
      </ScrollView>
    </View>
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
          style={styles.picker}
          dropdownIconColor={palette.accent}
          onValueChange={(selected) => onChange(String(selected))}>
          <Picker.Item label="Choose a language" value="" color={palette.textSubtle} />
          {capabilities?.languages.map((language) => (
            <Picker.Item
              key={language.code}
              label={language.display_name}
              value={language.code}
              color={palette.text}
            />
          ))}
        </Picker>
      </View>
    </View>
  );
}

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionNumber}>{number}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function PromiseItem({ index, title, copy }: { index: string; title: string; copy: string }) {
  return (
    <View style={styles.promiseItem}>
      <Text style={styles.promiseIndex}>{index}</Text>
      <View style={styles.promiseCopy}>
        <Text style={styles.promiseTitle}>{title}</Text>
        <Text style={styles.promiseBody}>{copy}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  page: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.giant,
    gap: spacing.huge,
  },
  pageCompact: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.xxxl,
  },
  topbar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandName: { ...typography.label, color: palette.text, fontSize: 14 },
  brandMeta: {
    ...typography.caption,
    color: palette.textSubtle,
    fontSize: 9,
    letterSpacing: 1.15,
  },
  privacyPill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,254,250,0.72)',
  },
  privacyPillNarrow: { width: 64, gap: spacing.xs, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  privacyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.positive },
  privacyText: { ...typography.caption, color: palette.textMuted },
  layout: { width: '100%', gap: spacing.xxxl },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.giant },
  hero: { flex: 1, gap: spacing.xl },
  heroWide: { paddingTop: spacing.xxl, maxWidth: 500 },
  eyebrow: {
    ...typography.caption,
    color: palette.accent,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  title: {
    ...typography.hero,
    color: palette.text,
    fontSize: 58,
    lineHeight: 62,
    letterSpacing: -2.2,
    maxWidth: 520,
  },
  titleCompact: { fontSize: 43, lineHeight: 47, letterSpacing: -1.4 },
  intro: { ...typography.body, color: palette.textMuted, maxWidth: 500 },
  exampleCard: {
    marginTop: spacing.sm,
    padding: spacing.xl,
    gap: spacing.xl,
    borderRadius: radii.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    ...shadows.raised,
  },
  exampleTopline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  exampleKicker: { ...typography.caption, color: palette.textSubtle, textTransform: 'uppercase', letterSpacing: 1 },
  exampleStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: palette.accentSoft,
  },
  exampleStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.positive },
  exampleStatusText: { ...typography.caption, color: palette.accentPressed, fontSize: 10, textTransform: 'uppercase' },
  exampleTranslation: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  exampleTranslationCompact: { flexDirection: 'column', alignItems: 'stretch' },
  examplePhrase: { flex: 1, minWidth: 0, gap: spacing.xs },
  languageCode: { ...typography.caption, color: palette.textSubtle, fontSize: 10, letterSpacing: 1.2 },
  exampleSource: { ...typography.title, color: palette.text, fontSize: 20 },
  exampleTarget: { ...typography.title, color: palette.accent, fontSize: 22 },
  arrowDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  exampleArrowCompact: { transform: [{ rotate: '90deg' }] },
  arrow: { color: palette.textMuted, fontSize: 19 },
  promiseGrid: { gap: spacing.md, marginTop: spacing.sm },
  promiseItem: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  promiseIndex: { ...typography.code, color: palette.accent, paddingTop: 1 },
  promiseCopy: { flex: 1, gap: spacing.xs },
  promiseTitle: { ...typography.label, color: palette.text },
  promiseBody: { ...typography.callout, color: palette.textMuted },
  formColumn: { flex: 1, width: '100%' },
  formColumnWide: { maxWidth: 620 },
  formSurface: {
    width: '100%',
    padding: spacing.xxl,
    gap: spacing.xl,
    borderRadius: radii.xxl,
    backgroundColor: 'rgba(255,254,250,0.94)',
    borderWidth: 1,
    borderColor: palette.border,
    ...shadows.floating,
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  formEyebrow: { ...typography.caption, color: palette.accent, letterSpacing: 1.3 },
  formTitle: { ...typography.heading, color: palette.text, fontSize: 28 },
  formTime: {
    ...typography.caption,
    color: palette.textSubtle,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceMuted,
  },
  section: { gap: spacing.md },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionNumber: {
    ...typography.code,
    color: palette.accent,
    minWidth: 28,
    fontSize: 11,
  },
  sectionTitle: { ...typography.title, color: palette.text, fontSize: 19 },
  sectionHint: { ...typography.callout, color: palette.textMuted, marginTop: -spacing.xs },
  divider: { height: 1, backgroundColor: palette.border },
  label: { ...typography.label, color: palette.text, marginTop: spacing.xs },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    color: palette.text,
    backgroundColor: palette.surface,
    fontFamily: typography.body.fontFamily,
    fontSize: 15,
  },
  importedConnection: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.accentSoft,
    borderWidth: 1,
    borderColor: '#C5DDD4',
  },
  importedConnectionCompact: { flexWrap: 'wrap' },
  importedCheck: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: palette.accent,
  },
  importedCheckmark: { color: palette.onAccent, fontWeight: '700' },
  importedCopy: { flex: 1, gap: spacing.xs },
  importedTitle: { ...typography.label, color: palette.text },
  importedHint: { ...typography.caption, color: palette.textMuted },
  settingsButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
  },
  settingsButtonCompact: { width: '100%', alignItems: 'center' },
  settingsButtonText: { ...typography.caption, color: palette.accent, fontWeight: '600' },
  connectionState: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
  },
  connectionStateReady: { backgroundColor: palette.accentSoft, borderColor: '#C5DDD4' },
  connectionStateError: { backgroundColor: '#F5E6E3', borderColor: '#E8C5C2' },
  stateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.textSubtle },
  stateDotReady: { backgroundColor: palette.positive },
  stateDotError: { backgroundColor: palette.critical },
  connectionCopy: { ...typography.callout, color: palette.textMuted, flex: 1, fontSize: 13 },
  checkButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
  },
  checkButtonText: { ...typography.label, color: palette.accent },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  toggleControl: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleLabel: { ...typography.caption, color: palette.textMuted },
  languageGrid: { gap: spacing.md },
  languageGridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  pickerGroup: { flex: 1, minWidth: 180, gap: spacing.sm },
  pickerShell: {
    minHeight: 50,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: palette.surface,
  },
  picker: { minHeight: 48, color: palette.text, backgroundColor: palette.surface },
  orderNote: {
    marginTop: spacing.xs,
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceMuted,
    borderLeftWidth: 3,
    borderLeftColor: palette.accent,
  },
  orderIndex: { ...typography.caption, color: palette.accent, fontSize: 9, letterSpacing: 1.25 },
  orderTitle: { ...typography.label, color: palette.text },
  orderCopy: { ...typography.callout, color: palette.textMuted, fontSize: 13 },
  disclosure: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    marginHorizontal: -spacing.md,
    borderRadius: radii.md,
  },
  disclosurePressed: { backgroundColor: palette.surfaceMuted },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    borderColor: palette.accent,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: palette.accent },
  checkmark: { color: palette.onAccent, fontSize: 14, fontWeight: '700' },
  disclosureText: { ...typography.callout, flex: 1, color: palette.textMuted, fontSize: 13, lineHeight: 19 },
  sessionError: { padding: spacing.md, borderRadius: radii.md, backgroundColor: '#F5E6E3' },
  sessionErrorText: { ...typography.callout, color: palette.critical },
  errorText: { ...typography.callout, color: palette.critical, fontSize: 13 },
  primaryButton: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.xl,
    paddingRight: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: palette.accent,
    ...shadows.soft,
  },
  primaryButtonPressed: { backgroundColor: palette.accentPressed, transform: [{ scale: 0.995 }] },
  disabledButton: { opacity: 0.38 },
  primaryButtonText: { ...typography.bodyMedium, color: palette.onAccent, fontWeight: '600' },
  buttonArrowDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  buttonArrow: { color: palette.onAccent, fontSize: 20 },
  footerNote: { ...typography.caption, color: palette.textSubtle, textAlign: 'center' },
  buttonPressed: { opacity: 0.72 },
});
