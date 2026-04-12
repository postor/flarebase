/**
 * Flarebase TypeScript Type Definitions
 *
 * Comprehensive type definitions for Flarebase client SDK
 */

/**
 * JWT Token payload structure
 */
export interface JWTPayload {
  sub: string;          // Subject (user ID)
  email?: string;       // User email
  role?: string;        // User role
  iat?: number;         // Issued at (Unix timestamp)
  exp?: number;         // Expiration time (Unix timestamp)
  name?: string;        // User name
  [key: string]: any;   // Additional custom claims
}

/**
 * User object structure
 */
export interface User {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  exp?: number;
  iat?: number;
  [key: string]: any;
}

/**
 * Authentication state
 */
export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  jwt: string | null;
  expiresAt?: number | null;
  expiresIn?: number | null;
  expiresSoon?(seconds?: number): boolean;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Registration data
 */
export interface RegistrationData {
  email: string;
  password: string;
  name?: string;
  role?: string;
  status?: string;
  [key: string]: any;
}

/**
 * Authentication response
 */
export interface AuthResponse {
  token: string;
  user: User;
  [key: string]: any;
}

/**
 * Query filter operators
 */
export type FilterOperator =
  | 'Eq'      // Equals
  | 'Gt'      // Greater than
  | 'Lt'      // Less than
  | 'Gte'     // Greater than or equal
  | 'Lte'     // Less than or equal
  | 'In';     // In array

/**
 * Query filter structure
 */
export type Filter = [string, Record<FilterOperator, any>];

/**
 * Document data structure (generic)
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
 * Fetch response wrapper
 */
export interface FetchResponse<T = any> {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<T>;
  headers?: Headers;
}

/**
 * SWR configuration options
 */
export interface SWROptions {
  revalidateOnFocus?: boolean;
  revalidateInterval?: number | false;
  enabled?: boolean;
  fetcher?: () => Promise<any>;
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

/**
 * FlareClient options
 */
export interface FlareClientOptions {
  autoRefresh?: boolean;
  refreshThreshold?: number;
  debug?: boolean;
}

/**
 * Socket.IO socket interface (simplified)
 */
export interface SocketInterface {
  id: string;
  emit: (event: string, ...args: any[]) => void;
  on: (event: string, handler: (...args: any[]) => void) => this;
  once: (event: string, handler: (...args: any[]) => void) => this;
  off: (event: string, handler?: (...args: any[]) => void) => this;
  disconnect: () => void;
  connect: () => void;
  connected: boolean;
}

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
 * Transaction operation types
 */
export type TransactionOperation =
  | { Set: { id: string; collection: string; data: any; version?: number; updated_at?: number } }
  | { Update: { collection: string; id: string; data: any; precondition?: any } }
  | { Delete: { collection: string; id: string; precondition?: any } };

/**
 * Batch operation result
 */
export interface BatchResult {
  success: boolean;
  results?: any[];
  errors?: any[];
}

/**
 * Named query parameters
 */
export type NamedQueryParams = Record<string, any>;

/**
 * Named query result
 */
export type NamedQueryResult<T = any> = T;

/**
 * OTP authentication interfaces
 */
export interface OTPRequestResult {
  success: boolean;
  message: string;
  otpId?: string;
}

export interface OTPRegisterData {
  email: string;
  password?: string;
  name?: string;
  role?: string;
  status?: string;
  [key: string]: any;
}

export interface OTPUpdatePasswordData {
  userId: string;
  newPassword: string;
  otp: string;
}

/**
 * Plugin request structure
 */
export interface PluginRequest {
  request_id: string;
  event_name: string;
  session_id: string;
  params: Record<string, any>;
  $jwt: JWTContext;
}

/**
 * JWT context for plugin requests
 */
export interface JWTContext {
  user_id: string | null;
  email: string | null;
  role: string;
}

/**
 * Plugin response structure
 */
export interface PluginResponse {
  ok: boolean;
  [key: string]: any;
}

/**
 * Plugin error structure
 */
export interface PluginError {
  ok: false;
  code?: string;
  message: string;
}

/**
 * Plugin handler function type
 */
export type PluginHandler = (request: PluginRequest) => Promise<any>;

/**
 * Plugin configuration
 */
export interface PluginConfig {
  events: string[];
  handlers: Record<string, PluginHandler>;
}

/**
 * Mock plugin instance
 */
export interface MockPlugin {
  events: string[];
  handlers: Record<string, PluginHandler>;
  isConnected: boolean;
  requestCount: number;
  requestLog: PluginRequestLog[];
  handleRequest(eventName: string, params: Record<string, any>, jwt?: JWTContext | null): Promise<any>;
  getRequestLog(): PluginRequestLog[];
  resetLog(): void;
}

/**
 * Plugin request log entry
 */
export interface PluginRequestLog {
  eventName: string;
  params: Record<string, any>;
  jwt: JWTContext | null;
  timestamp: number;
}

/**
 * usePlugin hook return type
 */
export interface UsePluginResult<T = any> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  callPlugin: (params?: Record<string, any>) => Promise<T>;
  reset: () => void;
  executed: boolean;
}
