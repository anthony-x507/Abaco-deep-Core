// Shared TypeScript contracts for the upload feature.
//
// These interfaces are the single source of truth for the IPC payloads
// exchanged between the main process (`ipc-handlers.ts`), the preload
// bridge (`preload-bridge.ts`) and the renderer components
// (`ui-component.tsx`, `preview-component.tsx`).  Keep them in sync with
// the Python `UploadedFile` dataclass defined in
// `core/uploads/models.py`.

export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export const UPLOAD_IPC_CHANNELS = {
  uploadFile: 'abaco:upload:file',
  listFiles: 'abaco:upload:list',
  getMetadata: 'abaco:upload:metadata',
  getContent: 'abaco:upload:content',
  deleteFile: 'abaco:upload:delete',
} as const;

export type UploadChannel = (typeof UPLOAD_IPC_CHANNELS)[keyof typeof UPLOAD_IPC_CHANNELS];

/** MIME types accepted by the backend whitelist. */
export const ALLOWED_MIME_PREFIXES: readonly string[] = [
  'image/',
  'text/',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/octet-stream',
] as const;

export type UploadStatus = 'pending' | 'uploading' | 'ready' | 'failed';

export interface UploadedFileMetadata {
  readonly fileId: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storagePath: string;
  readonly uploadedAt: string;
  readonly uploadedByNodeId: string;
  readonly threadId: string | null;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface UploadListFilter {
  readonly threadId?: string;
  readonly nodeId?: string;
}

export interface UploadRequestPayload {
  /** Raw bytes of the file.  Strings are interpreted as UTF-8. */
  readonly data: Uint8Array | string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly uploadedByNodeId: string;
  readonly threadId?: string | null;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UploadResult {
  readonly ok: true;
  readonly file: UploadedFileMetadata;
}

export interface UploadError {
  readonly ok: false;
  readonly code: UploadErrorCode;
  readonly message: string;
}

export type UploadErrorCode =
  | 'invalid_mime'
  | 'too_large'
  | 'invalid_name'
  | 'io_error'
  | 'not_found'
  | 'unknown';

export type UploadResponse = UploadResult | UploadError;

export interface UploadBridge {
  upload(payload: UploadRequestPayload): Promise<UploadResponse>;
  list(filter?: UploadListFilter): Promise<readonly UploadedFileMetadata[]>;
  metadata(fileId: string): Promise<UploadResponse>;
  content(fileId: string): Promise<Uint8Array>;
  remove(fileId: string): Promise<UploadResponse>;
}

/** Lightweight runtime representation used inside the UI. */
export interface UploadDraft {
  readonly localId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly previewUrl?: string;
  readonly status: UploadStatus;
  readonly progress: number;
  readonly errorMessage?: string;
  readonly serverFileId?: string;
}

declare global {
  interface Window {
    abacoUpload?: UploadBridge;
  }
}
