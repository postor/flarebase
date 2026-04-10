/**
 * Flarebase React Client SDK (TypeScript)
 *
 * Main entry point with comprehensive TypeScript types
 */

// Export Provider and hooks
export { FlarebaseProvider, useFlarebase } from './provider.js';
export {
  useFlarebaseSWR,
  useFlarebaseDocumentSWR,
  useFlarebaseQuerySWR,
  useCollection,
  useDocument,
  useQuery
} from './hooks.js';
export {
  CollectionReferenceImpl as CollectionReference,
  DocumentReferenceImpl as DocumentReference,
  QueryImpl as Query
} from './classes.js';

// Export all types
export * from './types.js';
