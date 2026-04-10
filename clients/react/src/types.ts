/**
 * Flarebase React TypeScript Type Definitions
 */

import type { User, LoginCredentials, RegistrationData, AuthResponse } from '@flarebase/client';

/**
 * Flarebase Context Type
 */
export interface FlarebaseContextType {
  baseURL: string;
  socket: SocketInterface;
  collection: <T = any>(name: string) => CollectionReference<T>;
  query: <T = any>(collection: string, filters: Filter[]) => Promise<QueryResult<T>>;
  login: (credentials: LoginCredentials) => Promise<AuthResponse>;
  register: (userData: RegistrationData) => Promise<AuthResponse>;
  logout: () => void;
  auth: {
    isAuthenticated: boolean;
    user: User | null;
    jwt: string | null;
  };
  namedQuery: <T = any>(queryName: string, params: Record<string, any>) => Promise<T>;
  createSWRFetcher: <T = any>(queryName: string) => (params: Record<string, any>) => Promise<T>;
  swrFetcher: (url: string) => Promise<any>;
}

/**
 * Socket interface for React
 */
export interface SocketInterface {
  id: string;
  emit: (event: string, ...args: any[]) => void;
  on: (event: string, handler: (...args: any[]) => void) => this;
  off: (event: string, handler?: (...args: any[]) => void) => this;
  disconnect: () => void;
  connect: () => void;
  connected: boolean;
}

/**
 * FlarebaseProvider Props
 */
export interface FlarebaseProviderProps {
  baseURL: string;
  children: React.ReactNode;
  initialJWT?: string | null;
  initialUser?: User | null;
}

/**
 * Filter type
 */
export type Filter = [string, Record<string, any>];

/**
 * Document data structure
 */
export interface DocumentData<T = any> {
  id: string;
  data: T;
  version?: number;
  updated_at?: number;
  created_at?: number;
}

/**
 * Collection query result
 */
export type QueryResult<T = any> = Array<DocumentData<T>>;

/**
 * Snapshot callback types
 */
export type SnapshotCallback<T = any> = (snapshot: Snapshot<T>) => void;

export type Snapshot<T = any> = {
  type: 'added' | 'modified' | 'removed';
  doc?: DocumentData<T>;
  id?: string;
};

/**
 * Collection reference interface
 */
export interface CollectionReference<T = any> {
  doc(id: string): DocumentReference<T>;
  get(): Promise<QueryResult<T>>;
  where(field: string, op: string, value: any): Query<T>;
  onSnapshot(callback: SnapshotCallback<T>): () => void;
}

/**
 * Document reference interface
 */
export interface DocumentReference<T = any> {
  readonly id: string;
  readonly collection: string;
  get(): Promise<DocumentData<T> | null>;
  update(data: Partial<T>): Promise<DocumentData<T>>;
  delete(): Promise<boolean>;
  onSnapshot(callback: SnapshotCallback<T>): () => void;
}

/**
 * Query interface
 */
export interface Query<T = any> {
  where(field: string, op: string, value: any): Query<T>;
  get(): Promise<QueryResult<T>>;
}

/**
 * SWR configuration options
 */
export interface SWROptions {
  revalidateOnFocus?: boolean;
  revalidateInterval?: number | false;
  enabled?: boolean;
  fetcher?: () => Promise<any>;
  customFetcher?: () => Promise<any>;
  optimistic?: boolean;
}

/**
 * SWR state interface
 */
export interface SWRState<T = any, E = Error> {
  data?: T;
  error?: E;
  isLoading: boolean;
  isValidating: boolean;
  mutate: (updateFn?: () => Promise<any>, options?: MutateOptions) => Promise<any>;
  refetch: () => Promise<any>;
}

/**
 * SWR mutate options
 */
export interface MutateOptions {
  optimistic?: boolean;
  rollbackOnError?: boolean;
  optimisticData?: any;
}

// Re-export types from JS SDK
export type {
  JWTPayload,
  AuthState,
  FilterOperator,
  FetchResponse,
  TransactionOperation,
  BatchResult,
  NamedQueryParams,
  NamedQueryResult,
  OTPRequestResult,
  OTPRegisterData,
  OTPUpdatePasswordData
} from '@flarebase/client';
