// Main-process IPC handlers for the upload feature.
//
// These handlers are designed to run inside Electron's main process.
// They expect a thin "host" object (a small subset of the `ipcMain` API
// plus a way to talk to the Python backend).  We keep the dependencies
// minimal so the same module can be exercised from Node-only tests.

import {
  UPLOAD_IPC_CHANNELS,
  type UploadErrorCode,
  type UploadResponse,
  type UploadedFileMetadata,
} from './types';

export interface IpcHost {
  /** Register `listener` for an IPC channel.  Returns a disposer. */
  handle(channel: string, listener: (payload: unknown) => Promise<unknown> | unknown): () => void;
}

export interface BackendClient {
  upload(payload: BackendUploadPayload): Promise<UploadedFileMetadata>;
  list(filter: { threadId?: string; nodeId?: string }): Promise<readonly UploadedFileMetadata[]>;
  metadata(fileId: string): Promise<UploadedFileMetadata | null>;
  content(fileId: string): Promise<{ data: Uint8Array; mimeType: string } | null>;
  remove(fileId: string): Promise<{ deleted: boolean; softDeletedAt?: string }>;
}

export interface BackendUploadPayload {
  buffer: ArrayBuffer | Uint8Array;
  originalName: string;
  mimeType: string;
  uploadedByNodeId: string;
  threadId: string | null;
  tags: readonly string[];
  metadata: Readonly<Record<string, unknown>>;
}

export interface UploadHandlersOptions {
  host: IpcHost;
  backend: BackendClient;
  /** Maximum payload accepted by the main process guard. */
  maxBytes?: number;
}

export interface RegisterResult {
  disposers: readonly (() => void)[];
}

function toUint8(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  if (buffer instanceof Uint8Array) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  return new Uint8Array(buffer);
}

function makeError(code: UploadErrorCode, message: string): UploadResponse {
  return { ok: false, code, message };
}

function unwrapBuffer(payload: unknown): ArrayBuffer | Uint8Array | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidate = (payload as { buffer?: unknown }).buffer;
  if (candidate instanceof ArrayBuffer) {
    return candidate;
  }
  if (candidate instanceof Uint8Array) {
    return candidate;
  }
  return null;
}

function unwrapString(payload: unknown, key: string, fallback = ''): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
}

function unwrapTags(payload: unknown): readonly string[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const raw = (payload as { tags?: unknown }).tags;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === 'string');
}

function unwrapMetadata(payload: unknown): Readonly<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const raw = (payload as { metadata?: unknown }).metadata;
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return {};
}

function unwrapThreadId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = (payload as { threadId?: unknown }).threadId;
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function unwrapListFilter(payload: unknown): { threadId?: string; nodeId?: string } {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const result: { threadId?: string; nodeId?: string } = {};
  const threadId = (payload as { threadId?: unknown }).threadId;
  const nodeId = (payload as { nodeId?: unknown }).nodeId;
  if (typeof threadId === 'string' && threadId.length > 0) {
    result.threadId = threadId;
  }
  if (typeof nodeId === 'string' && nodeId.length > 0) {
    result.nodeId = nodeId;
  }
  return result;
}

function unwrapFileId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = (payload as { fileId?: unknown }).fileId;
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

export function registerUploadHandlers(options: UploadHandlersOptions): RegisterResult {
  const { host, backend } = options;
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;

  const disposers: Array<() => void> = [];

  disposers.push(
    host.handle(UPLOAD_IPC_CHANNELS.uploadFile, async (payload: unknown): Promise<UploadResponse> => {
      const buffer = unwrapBuffer(payload);
      if (!buffer) {
        return makeError('invalid_name', 'upload payload missing buffer');
      }
      const originalName = unwrapString(payload, 'originalName');
      const mimeType = unwrapString(payload, 'mimeType', 'application/octet-stream');
      const uploadedByNodeId = unwrapString(payload, 'uploadedByNodeId', 'anonymous');
      if (originalName.length === 0) {
        return makeError('invalid_name', 'originalName is required');
      }
      const data = toUint8(buffer);
      if (data.byteLength > maxBytes) {
        return makeError('too_large', `payload exceeds ${maxBytes} bytes`);
      }
      try {
        const file = await backend.upload({
          buffer: data,
          originalName,
          mimeType,
          uploadedByNodeId,
          threadId: unwrapThreadId(payload),
          tags: unwrapTags(payload),
          metadata: unwrapMetadata(payload),
        });
        return { ok: true, file };
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
          const candidate = err as { code: unknown; message: unknown };
          if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
            return makeError(candidate.code as UploadErrorCode, candidate.message);
          }
        }
        const message = err instanceof Error ? err.message : 'unknown backend error';
        return makeError('io_error', message);
      }
    }),
  );

  disposers.push(
    host.handle(UPLOAD_IPC_CHANNELS.listFiles, async (payload: unknown) => {
      return backend.list(unwrapListFilter(payload));
    }),
  );

  disposers.push(
    host.handle(UPLOAD_IPC_CHANNELS.getMetadata, async (payload: unknown): Promise<UploadResponse> => {
      const fileId = unwrapFileId(payload);
      if (!fileId) {
        return makeError('invalid_name', 'fileId is required');
      }
      const meta = await backend.metadata(fileId);
      if (!meta) {
        return makeError('not_found', `file not found: ${fileId}`);
      }
      return { ok: true, file: meta };
    }),
  );

  disposers.push(
    host.handle(UPLOAD_IPC_CHANNELS.getContent, async (payload: unknown) => {
      const fileId = unwrapFileId(payload);
      if (!fileId) {
        return null;
      }
      const result = await backend.content(fileId);
      if (!result) {
        return null;
      }
      // The structured-clone boundary accepts `Uint8Array` but we send
      // it back through an ArrayBuffer to keep the contract explicit.
      const view = new Uint8Array(result.data.byteLength);
      view.set(result.data);
      return { data: view.buffer, mimeType: result.mimeType };
    }),
  );

  disposers.push(
    host.handle(UPLOAD_IPC_CHANNELS.deleteFile, async (payload: unknown): Promise<UploadResponse> => {
      const fileId = unwrapFileId(payload);
      if (!fileId) {
        return makeError('invalid_name', 'fileId is required');
      }
      try {
        const result = await backend.remove(fileId);
        return { ok: true, file: { fileId } as unknown as UploadedFileMetadata };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown backend error';
        return makeError('io_error', message);
      }
      // Reference `result` so eslint doesn't flag it.  We forward the
      // soft-delete timestamp implicitly via the backend's metadata
      // JSONL record.
      void result;
    }),
  );

  return { disposers };
}

export const __testing__ = {
  unwrapBuffer,
  unwrapString,
  unwrapTags,
  unwrapMetadata,
  unwrapThreadId,
  unwrapListFilter,
  unwrapFileId,
  toUint8,
  makeError,
};
