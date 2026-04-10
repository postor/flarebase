/**
 * Flarebase JavaScript Client SDK (TypeScript)
 *
 * Main entry point for the Flarebase client SDK
 */

// Export all classes
export {
  FlareClient,
  CollectionReference,
  DocumentReference,
  Query,
  WriteBatch,
  Transaction,
  FlareHook
} from './FlareClient.js';

// Export all types
export type {
  JWTPayload,
  User,
  AuthState,
  LoginCredentials,
  RegistrationData,
  AuthResponse,
  FilterOperator,
  Filter,
  DocumentData,
  QueryResult,
  FetchResponse,
  SWROptions,
  SWRState,
  MutateOptions,
  FlareClientOptions,
  SocketInterface,
  SnapshotCallback,
  Snapshot,
  TransactionOperation,
  BatchResult,
  NamedQueryParams,
  NamedQueryResult,
  OTPRequestResult,
  OTPRegisterData,
  OTPUpdatePasswordData
} from './types.js';

// Re-export types for convenience
export type { default as Socket } from 'socket.io-client';
