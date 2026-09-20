import { requestRecordingPermissionsAsync } from 'expo-audio';
import {
  createContext, type PropsWithChildren, useCallback, useContext,
  useEffect, useMemo, useRef, useState,
} from 'react';

import { useInterventionPlayer } from '../audio/useInterventionPlayer';
import { usePcmCapture, type CaptureState } from '../audio/usePcmCapture';
import { initialConversationState, type ConversationState } from '../conversation/model';
import type { ServerEvent } from '../protocol/generated';
import { reduceConversation, type ConversationAction } from '../protocol/reducer';
import { SessionSocket, type SessionControl, type SocketFailure } from '../protocol/sessionSocket';
import { discoverBackend } from '../services/capabilities';
import { buildSessionConfig, type SetupModel } from '../setup/model';
import { validateSetup } from '../setup/validation';

export type SessionContextValue = {
  state: ConversationState;
  setup: SetupModel | null;
  starting: boolean;
  error: string | null;
  captureEnabled: boolean;
  captureState: CaptureState;
  startConversation: (setup: SetupModel) => Promise<boolean>;
  sendControl: (message: SessionControl) => boolean;
  replay: (interventionId: string) => void;
  endConversation: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const FAILURE_MESSAGES: Record<SocketFailure, string> = {
  connection_lost: 'Connection lost. Start a new conversation.',
  connection_too_slow: 'The audio connection is too slow. Start a new conversation.',
  connection_timeout: 'The backend did not respond. Check its address and pairing token.',
  protocol_error: 'The backend sent an incompatible response. Start a new conversation.',
  resume_unavailable: 'Resume was unavailable. Start a new conversation.',
  pairing_failed: 'Pairing failed. Enter the temporary token from the backend terminal.',
  provider_unavailable: 'Meta transcription could not start. Check provider readiness and try again.',
};

class StartupError extends Error {}

export function SessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState(initialConversationState);
  const [setup, setSetup] = useState<SetupModel | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const stateRef = useRef(state);
  const socketRef = useRef<SessionSocket | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const startingRef = useRef(false);
  const captureLive = useRef(false);
  const resumeInFlight = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutomatic = useRef<string | null>(null);
  const captureError = useRef<(failure: CaptureState) => void>(() => undefined);

  const replaceState = useCallback((next: ConversationState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);
  const dispatch = useCallback((action: ConversationAction) => {
    replaceState(reduceConversation(stateRef.current, action));
  }, [replaceState]);

  const sendControl = useCallback((message: SessionControl): boolean => {
    const socket = socketRef.current;
    if (!socket?.isActive) return false;
    try {
      socket.sendControl(message);
      return true;
    } catch {
      return false;
    }
  }, []);

  const capture = usePcmCapture({
    onFrame: (frame) => {
      if (socketRef.current?.isActive) {
        try { socketRef.current.sendAudio(frame); } catch { captureLive.current = false; }
      }
    },
    onError: (failure) => captureError.current(failure),
  });
  const player = useInterventionPlayer({
    onStarted: (item) => {
      if (!stateRef.current.interventions[item.interventionId] || !sendControl({
        type: 'playback.started', protocol_version: 1,
        intervention_id: item.interventionId, manual: item.manual,
      })) return false;
      dispatch({ type: 'local.playback_started', interventionId: item.interventionId });
      return true;
    },
    onEnded: (item) => {
      sendControl({ type: 'playback.ended', protocol_version: 1, intervention_id: item.interventionId });
      dispatch({ type: 'local.playback_ended', interventionId: item.interventionId, interrupted: false });
    },
    onInterrupted: (item) => {
      sendControl({ type: 'playback.interrupted', protocol_version: 1, intervention_id: item.interventionId });
      dispatch({ type: 'local.playback_ended', interventionId: item.interventionId, interrupted: true });
    },
    onFailure: () => {
      if (mounted.current) setError('Speech could not play. The translation remains available; try Replay.');
    },
  });

  const stopMedia = useCallback(() => {
    captureLive.current = false;
    pendingAutomatic.current = null;
    capture.stop();
    player.stopAll();
    if (mounted.current) setCaptureEnabled(false);
  }, [capture.stop, player]);

  const endConversation = useCallback(() => {
    generation.current += 1;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    resumeInFlight.current = false;
    startingRef.current = false;
    stopMedia();
    socketRef.current?.end();
    socketRef.current = null;
    replaceState(initialConversationState);
    if (mounted.current) {
      setSetup(null);
      setStarting(false);
      setError(null);
    }
  }, [replaceState, stopMedia]);

  const requireRestart = useCallback((message: string) => {
    endConversation();
    dispatch({ type: 'local.restart_required', message });
    if (mounted.current) setError(message);
  }, [dispatch, endConversation]);
  captureError.current = (failure) => requireRestart(
    failure === 'permission_denied'
      ? 'Microphone permission is required. Update system settings and try again.'
      : 'Microphone capture stopped. Check audio permissions and start a new conversation.',
  );

  const playPending = useCallback(() => {
    const id = pendingAutomatic.current;
    if (!id || !captureLive.current || !socketRef.current?.isActive) return;
    pendingAutomatic.current = null;
    const card = stateRef.current.interventions[id];
    if (card?.playbackKind && stateRef.current.currentPlaybackId === id) {
      player.requestAutomatic(
        id,
        card.playbackKind,
        card.targetText,
        card.targetLanguage,
        card.audioUrl,
      );
    }
  }, [player]);

  const onEvent = useCallback((event: ServerEvent) => {
    dispatch(event);
    if (event.type === 'playback.start_requested') {
      pendingAutomatic.current = event.intervention_id;
      playPending();
    } else if (event.type === 'playback.stop_requested') {
      if (pendingAutomatic.current === event.intervention_id) pendingAutomatic.current = null;
      player.stopRequested(event.intervention_id);
    } else if (event.type === 'session.degraded' && event.restart_required) {
      stopMedia();
      if (mounted.current) setError('Meta transcription stopped. Start a new conversation.');
    } else if (event.type === 'session.ended') {
      stopMedia();
      if (mounted.current) setSetup(null);
    }
  }, [dispatch, playPending, player, stopMedia]);

  const onConnectionLost = useCallback((failure: SocketFailure, socket: SessionSocket, epoch: number) => {
    if (generation.current !== epoch || !mounted.current) return;
    const canResume = failure === 'connection_lost' && captureLive.current &&
      socket.credentials !== null && !resumeInFlight.current;
    stopMedia();
    dispatch({ type: 'local.connection_lost' });
    if (!canResume) {
      if (!startingRef.current) requireRestart(FAILURE_MESSAGES[failure]);
      return;
    }
    setError('Reconnecting to the same conversation…');
    resumeInFlight.current = true;
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      void (async () => {
        try {
          await socket.resume();
          if (generation.current !== epoch) return;
          await socket.startAudio();
          if (generation.current !== epoch) return;
          const started = await capture.start(true);
          if (generation.current !== epoch) return;
          if (!started) throw new StartupError('Microphone capture could not restart.');
          captureLive.current = true;
          setCaptureEnabled(true);
          setError(null);
          playPending();
        } catch {
          if (generation.current === epoch) requireRestart(FAILURE_MESSAGES.resume_unavailable);
        } finally {
          if (generation.current === epoch) resumeInFlight.current = false;
        }
      })();
    }, 100);
  }, [capture.start, dispatch, playPending, requireRestart, stopMedia]);

  const startConversation = useCallback(async (nextSetup: SetupModel): Promise<boolean> => {
    if (startingRef.current || !mounted.current) return false;
    endConversation();
    const epoch = generation.current;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const discovery = await discoverBackend(nextSetup.backendBaseUrl);
      if (generation.current !== epoch) return false;
      const errors = validateSetup(nextSetup, discovery.capabilities);
      if (Object.keys(errors).length) throw new StartupError(Object.values(errors)[0]);
      if (discovery.health.status !== 'ok') {
        const missing = [
          !discovery.health.providers.meta ? 'Meta' : null,
        ].filter(Boolean);
        throw new StartupError(`${missing.join(' and ')} provider configuration is missing.`);
      }
      const socket = new SessionSocket({
        onEvent: (event) => { if (generation.current === epoch) onEvent(event); },
        onConnectionLost: (failure) => onConnectionLost(failure, socket, epoch),
      });
      socketRef.current = socket;
      await socket.start({
        backendBaseUrl: nextSetup.backendBaseUrl, pairingToken: nextSetup.pairingToken,
        config: buildSessionConfig(nextSetup),
      });
      if (generation.current !== epoch) return false;
      const permission = await requestRecordingPermissionsAsync();
      if (generation.current !== epoch) return false;
      if (!permission.granted) throw new StartupError(
        'Microphone permission is required. Update system settings and try again.',
      );
      await socket.startAudio();
      if (generation.current !== epoch) return false;
      if (!await capture.start(true)) throw new StartupError('Microphone capture could not start.');
      if (generation.current !== epoch) return false;
      captureLive.current = true;
      setCaptureEnabled(true);
      setSetup({ ...nextSetup, pairingToken: '' });
      playPending();
      return true;
    } catch (caught) {
      if (generation.current === epoch) {
        const message = caught instanceof StartupError ? caught.message
          : caught instanceof Error && caught.message in FAILURE_MESSAGES
            ? FAILURE_MESSAGES[caught.message as SocketFailure]
            : 'Could not start the conversation. Check the backend and try again.';
        endConversation();
        setError(message);
      }
      return false;
    } finally {
      if (generation.current === epoch) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [capture.start, endConversation, onConnectionLost, onEvent, playPending]);

  const replay = useCallback((interventionId: string) => {
    const card = stateRef.current.interventions[interventionId];
    if (socketRef.current?.isActive && card?.playbackKind && card.status !== 'preview') {
      player.replay(
        interventionId,
        card.playbackKind,
        card.targetText,
        card.targetLanguage,
        card.audioUrl,
      );
    }
  }, [player]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; endConversation(); };
  }, [endConversation]);

  const value = useMemo<SessionContextValue>(() => ({
    state, setup, starting, error, captureEnabled, captureState: capture.state,
    startConversation, sendControl, replay, endConversation,
  }), [state, setup, starting, error, captureEnabled, capture.state,
    startConversation, sendControl, replay, endConversation]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
