export * from './types.js';
export * from './blackboard.js';
export * from './firestore.js';

import { Blackboard, LocalBlackboard } from './blackboard.js';
import { FirestoreBlackboard } from './firestore.js';

/**
 * Board selection is config, not code: FIREBASE_* present → Firestore,
 * otherwise the local file-backed board. All env reads for the board
 * happen here and in firestore.ts — nowhere else (SPEC §6).
 */
export function createBlackboard(dataFile = 'data/blackboard.json'): Blackboard {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
    process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return new FirestoreBlackboard();
  }
  return new LocalBlackboard(dataFile);
}
