import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFromFile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');
const repositoryRoot = resolve(clientRoot, '../..');
const schemaRoot = resolve(repositoryRoot, 'packages/protocol/v1');
const outputRoot = resolve(clientRoot, 'src/protocol');
const options = {
  bannerComment: '',
  format: true,
  style: { singleQuote: true, semi: true },
};

await mkdir(outputRoot, { recursive: true });
const clientTypes = await compileFromFile(
  resolve(schemaRoot, 'client-messages.schema.json'),
  options,
);
const serverTypes = await compileFromFile(
  resolve(schemaRoot, 'server-events.schema.json'),
  options,
);
const aliases = `
export type ClientMessage = ClientProtocol.ClientMessages;
export type SessionConfig = ClientProtocol.SessionConfig;
export type SessionStart = ClientProtocol.SessionStart;
export type SessionResume = ClientProtocol.SessionResume;
export type ServerEvent = ServerProtocol.ServerEvents;
export type SessionReady = ServerProtocol.SessionReady;
export type SessionStatus = ServerProtocol.SessionStatus;
export type SpeakerMapped = ServerProtocol.SpeakerMapped;
export type InterventionPreview = ServerProtocol.InterventionPreview;
export type InterventionCommitted = ServerProtocol.InterventionCommitted;
export type InterventionAudioReady = ServerProtocol.InterventionAudioReady;
export type InterventionAudioFailed = ServerProtocol.InterventionAudioFailed;
export type InterventionCancelled = ServerProtocol.InterventionCancelled;
export type PlaybackStartRequested = ServerProtocol.PlaybackStartRequested;
export type PlaybackStopRequested = ServerProtocol.PlaybackStopRequested;
export type SessionDegraded = ServerProtocol.SessionDegraded;
export type SessionEnded = ServerProtocol.SessionEnded;
`;
await writeFile(
  resolve(outputRoot, 'generated.ts'),
  `export namespace ClientProtocol {\n${clientTypes.trim()}\n}\n\nexport namespace ServerProtocol {\n${serverTypes.trim()}\n}\n${aliases}`,
);
await copyFile(
  resolve(schemaRoot, 'server-events.schema.json'),
  resolve(outputRoot, 'server-events.schema.json'),
);
