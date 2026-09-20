import { normalizeBackendBaseUrl, type CapabilitiesResponse } from '../services/capabilities';
import type { SetupModel } from './model';

export type SetupErrors = Partial<
  Record<
    | 'backendBaseUrl'
    | 'pairingToken'
    | 'learningLanguage'
    | 'learner1NativeLanguage'
    | 'learner2NativeLanguage'
    | 'disclosureAccepted',
    string
  >
>;

export function validateSetup(
  model: SetupModel,
  capabilities: CapabilitiesResponse | null,
): SetupErrors {
  const errors: SetupErrors = {};
  const supported = new Set(capabilities?.languages.map((item) => item.code) ?? []);
  if (!model.backendBaseUrl.trim()) {
    errors.backendBaseUrl = 'Backend address is required.';
  } else {
    try {
      normalizeBackendBaseUrl(model.backendBaseUrl);
    } catch {
      errors.backendBaseUrl = 'Enter a valid backend address.';
    }
  }
  if (model.pairingToken.length < 32) {
    errors.pairingToken = 'Enter the temporary pairing token.';
  }
  if (!model.learningLanguage || !supported.has(model.learningLanguage)) {
    errors.learningLanguage = 'Choose a supported learning language.';
  }
  if (
    !model.learner1NativeLanguage ||
    !supported.has(model.learner1NativeLanguage)
  ) {
    errors.learner1NativeLanguage = 'Choose Learner 1’s native language.';
  } else if (model.learner1NativeLanguage === model.learningLanguage) {
    errors.learner1NativeLanguage =
      'The native and learning languages must be different.';
  }
  if (model.mode === 'two_learners') {
    if (
      !model.learner2NativeLanguage ||
      !supported.has(model.learner2NativeLanguage)
    ) {
      errors.learner2NativeLanguage = 'Choose Learner 2’s native language.';
    } else if (model.learner2NativeLanguage === model.learningLanguage) {
      errors.learner2NativeLanguage =
        'The native and learning languages must be different.';
    }
  }
  if (!model.disclosureAccepted) {
    errors.disclosureAccepted = 'Acknowledge provider processing to continue.';
  }
  return errors;
}
