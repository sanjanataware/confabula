import type { CapabilitiesResponse } from '../../src/services/capabilities';
import { createSetupModel, setMode } from '../../src/setup/model';
import { validateSetup } from '../../src/setup/validation';

const capabilities: CapabilitiesResponse = {
  protocol_version: 1,
  languages: [
    {
      code: 'en',
      display_name: 'English',
      muse_bias_name: 'English',
      speech_route: { kind: 'device_speech' },
    },
    {
      code: 'es',
      display_name: 'Spanish',
      muse_bias_name: 'Spanish',
      speech_route: { kind: 'device_speech' },
    },
  ],
};

test('validates distinct supported languages', () => {
  const model = {
    ...createSetupModel(),
    pairingToken: 'p'.repeat(43),
    learner1NativeLanguage: 'en',
    learningLanguage: 'en',
    disclosureAccepted: true,
  };
  expect(validateSetup(model, capabilities).learner1NativeLanguage).toBeDefined();
  expect(validateSetup({ ...model, learningLanguage: 'es' }, capabilities)).toEqual({});
});

test('switching to default mode clears learner two', () => {
  const model = setMode(
    { ...createSetupModel(), mode: 'two_learners', learner2NativeLanguage: 'en' },
    'learner_fluent',
  );
  expect(model.learner2NativeLanguage).toBe('');
});
