import type { SessionConfig } from '../protocol/generated';

export type ConversationMode = 'learner_fluent' | 'two_learners';

export type SetupModel = {
  backendBaseUrl: string;
  pairingToken: string;
  mode: ConversationMode;
  learningLanguage: string;
  learner1NativeLanguage: string;
  learner2NativeLanguage: string;
  disclosureAccepted: boolean;
};

export function defaultBackendBaseUrl(): string {
  if (__DEV__ && process.env.EXPO_PUBLIC_BACKEND_URL) {
    return process.env.EXPO_PUBLIC_BACKEND_URL;
  }
  if (__DEV__ && process.env.EXPO_PUBLIC_LOOPBACK_DEBUG === '1') {
    return 'http://127.0.0.1:8000';
  }
  return 'https://localhost:8444';
}

export function createSetupModel(): SetupModel {
  return {
    backendBaseUrl: defaultBackendBaseUrl(),
    pairingToken: '',
    mode: 'learner_fluent',
    learningLanguage: '',
    learner1NativeLanguage: '',
    learner2NativeLanguage: '',
    disclosureAccepted: false,
  };
}

export function setMode(model: SetupModel, mode: ConversationMode): SetupModel {
  return {
    ...model,
    mode,
    learner2NativeLanguage:
      mode === 'two_learners' ? model.learner2NativeLanguage : '',
  };
}

export function buildSessionConfig(model: SetupModel): SessionConfig {
  return {
    mode: model.mode,
    learning_language: model.learningLanguage,
    learner1_native_language: model.learner1NativeLanguage,
    learner2_native_language:
      model.mode === 'two_learners' ? model.learner2NativeLanguage : null,
  };
}
