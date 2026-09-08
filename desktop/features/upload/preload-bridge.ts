// Preload bridge: exposes the upload IPC API to the renderer in a
// type-safe way.  The renderer never touches `ipcRenderer` directly —
// it talks to `window.abacoUpload` which is wired here.
//
// The bridge is intentionally synchronous at install time: callers
// obtain a `UploadBridge` instance that wraps `contextBridge.invoke`
// promises.  We keep error normalisation in one place so UI code never
// has to differentiate between transport failures and validation
// failures.

import {
  ALLOWED_MIME_PREFIXES,
  UPLOAD_IPC_CHANNELS,
  UPLOAD_MAX_BYTES,
  type UploadBridge,
  type UploadError,
  type UploadErrorCode,
  type UploadListFilter,
  type UploadRequestPayload,
  type UploadResponse,
  type UploadedFileMetadata,
} from './types';

type IpcInvoker = (channel: string, ...args: readonly unknown[]) => Promise<unknown>;

interface BridgeContext {
  readonly invoke: IpcInvoker;
  /** When true, install the bridge on `window.abacoUpload`. */
  readonly exposeOnWindow?: boolean;
}

function bytesToArrayBuffer(value: Uint8Array | string): ArrayBuffer {
  if (typeof value === 'string') {
    const encoder = new TextEncoder();
    const view = encoder.encode(value);
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  // Copy into a fresh ArrayBuffer so the structured-clone boundary
  // doesn't keep the caller's typed array pinned in the renderer.
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function isMimeAllowed(mime: string): boolean {
  const candidate = mime.trim().toLowerCase();
  if (candidate.length === 0) {
    return false;
  }
  return ALLOWED_MIME_PREFIXES.some((prefix) => candidate === prefix || candidate.startsWith(prefix));
}

function makeError(code: UploadErrorCode, message: string): UploadError {
  return { ok: false, code, message };
}

function normaliseError(err: unknown, fallbackCode: UploadErrorCode = 'unknown'): UploadError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const candidate = err as { code: unknown; message: unknown };
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return makeError(candidate.code as UploadErrorCode, candidate.message);
    }
  }
  if (err instanceof Error) {
    return makeError(fallbackCode, err.message);
  }
  return makeError(fallbackCode, 'unknown upload error');
}

function normaliseList(value: unknown): readonly UploadedFileMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is UploadedFileMetadata => {
    return Boolean(item) && typeof item === 'object' && typeof (item as { fileId?: unknown }).fileId === 'string';
  });
}

function toRequestPayload(payload: UploadRequestPayload): {
  buffer: ArrayBuffer;
  originalName: string;
  mimeType: string;
  uploadedByNodeId: string;
  threadId: string | null;
  tags: readonly string[];
  metadata: Readonly<Record<string, unknown>>;
} {
  const name = payload.originalName.trim();
  if (name.length === 0) {
    throw makeError('invalid_name', 'originalName must be a non-empty string');
  }
  if (!isMimeAllowed(payload.mimeType)) {
    throw makeError('invalid_mime', `mime type not allowed: ${payload.mimeType}`);
  }
  const buffer = bytesToArrayBuffer(payload.data);
  if (buffer.byteLength > UPLOAD_MAX_BYTES) {
    throw makeError('too_large', `file exceeds ${UPLOAD_MAX_BYTES} bytes`);
  }
  return {
    buffer,
    originalName: name,
    mimeType: payload.mimeType.trim().toLowerCase(),
    uploadedByNodeId: payload.uploadedByNodeId,
    threadId: payload.threadId ?? null,
    tags: payload.tags ?? [],
    metadata: payload.metadata ?? {},
  };
}

export function createUploadBridge(context: BridgeContext): UploadBridge {
  const invoke = context.invoke;

  async function upload(payload: UploadRequestPayload): Promise<UploadResponse> {
    let body;
    try {
      body = toRequestPayload(payload);
    } catch (err) {
      return normaliseError(err);
    }
    try {
      const response = (await invoke(UPLOAD_IPC_CHANNELS.uploadFile, body)) as UploadResponse;
      if (!response || typeof response !== 'object' || !('ok' in response)) {
        return makeError('unknown', 'unexpected response shape from main process');
      }
      return response;
    } catch (err) {
      return normaliseError(err, 'io_error');
    }
  }

  async function list(filter?: UploadListFilter): Promise<readonly UploadedFileMetadata[]> {
    try {
      const response = await invoke(UPLOAD_IPC_CHANNELS.listFiles, filter ?? {});
      return normaliseList(response);
    } catch (err) {
      // Listing is best-effort: surface as empty rather than throwing
      // so the UI degrades gracefully.
      void normaliseError(err, 'io_error');
      return [];
    }
  }

  async function metadata(fileId: string): Promise<UploadResponse> {
    try {
      const response = (await invoke(UPLOAD_IPC_CHANNELS.getMetadata, { fileId })) as UploadResponse;
      if (!response || typeof response !== 'object' || !('ok' in response)) {
        return makeError('not_found', 'metadata not found');
      }
      return response;
    } catch (err) {
      return normaliseError(err, 'not_found');
    }
  }

  async function content(fileId: string): Promise<Uint8Array> {
    try {
      const response = (await invoke(UPLOAD_IPC_CHANNELS.getContent, { fileId })) as unknown;
      if (response instanceof ArrayBuffer) {
        return new Uint8Array(response);
      }
      if (response && typeof response === 'object' && 'data' in response) {
        const data = (response as { data: unknown }).data;
        if (data instanceof ArrayBuffer) {
          return new Uint8Array(data);
        }
      }
      return new Uint8Array(0);
    } catch (err) {
      normaliseError(err, 'io_error');
      return new Uint8Array(0);
    }
  }

  async function remove(fileId: string): Promise<UploadResponse> {
    try {
      const response = (await invoke(UPLOAD_IPC_CHANNELS.deleteFile, { fileId })) as UploadResponse;
      if (!response || typeof response !== 'object' || !('ok' in response)) {
        return makeError('unknown', 'unexpected response shape from main process');
      }
      return response;
    } catch (err) {
      return normaliseError(err, 'io_error');
    }
  }

  const bridge: UploadBridge = { upload, list, metadata, content, remove };

  if (context.exposeOnWindow && typeof window !== 'undefined') {
    window.abacoUpload = bridge;
  }

  return bridge;
}

export const __testing__ = {
  isMimeAllowed,
  bytesToArrayBuffer,
  normaliseError,
  normaliseList,
  toRequestPayload,
};
