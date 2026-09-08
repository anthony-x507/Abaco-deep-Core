// Unit tests for the main-process IPC handlers.  These tests run in a
// pure Node environment: they don't need Electron, jsdom or React.  We
// build a fake `IpcHost` and a fake `BackendClient` so the contract of
// `registerUploadHandlers` can be exercised end-to-end.

import { describe, expect, it, vi } from 'vitest';

import {
  type BackendClient,
  type BackendUploadPayload,
  type IpcHost,
  __testing__,
  registerUploadHandlers,
} from '../ipc-handlers';
import { UPLOAD_IPC_CHANNELS } from '../types';

function makeHost(): IpcHost & { calls: Map<string, (payload: unknown) => Promise<unknown>> } {
  const calls = new Map<string, (payload: unknown) => Promise<unknown>>();
  return {
    calls,
    handle(channel, listener) {
      calls.set(channel, listener);
      return () => {
        calls.delete(channel);
      };
    },
  };
}

function makeBackend(overrides: Partial<BackendClient> = {}): BackendClient & {
  uploadCalls: BackendUploadPayload[];
} {
  const uploadCalls: BackendUploadPayload[] = [];
  const backend: BackendClient & { uploadCalls: BackendUploadPayload[] } = {
    uploadCalls,
    async upload(payload) {
      uploadCalls.push(payload);
      return {
        fileId: 'file-1',
        originalName: payload.originalName,
        mimeType: payload.mimeType,
        sizeBytes: payload.buffer instanceof Uint8Array ? payload.buffer.byteLength : payload.buffer.byteLength,
        sha256: 'deadbeef',
        storagePath: '2026/01/file-1.bin',
        uploadedAt: '2026-01-01T00:00:00Z',
        uploadedByNodeId: payload.uploadedByNodeId,
        threadId: payload.threadId,
        tags: payload.tags,
        metadata: payload.metadata,
      };
    },
    async list(filter) {
      if (filter.threadId === 'thread-1') {
        return [
          {
            fileId: 'file-1',
            originalName: 'a.txt',
            mimeType: 'text/plain',
            sizeBytes: 4,
            sha256: 'deadbeef',
            storagePath: '2026/01/file-1.txt',
            uploadedAt: '2026-01-01T00:00:00Z',
            uploadedByNodeId: 'node-1',
            threadId: 'thread-1',
            tags: [],
            metadata: {},
          },
        ];
      }
      return [];
    },
    async metadata(fileId) {
      if (fileId === 'file-1') {
        return {
          fileId,
          originalName: 'a.txt',
          mimeType: 'text/plain',
          sizeBytes: 4,
          sha256: 'deadbeef',
          storagePath: '2026/01/file-1.txt',
          uploadedAt: '2026-01-01T00:00:00Z',
          uploadedByNodeId: 'node-1',
          threadId: 'thread-1',
          tags: [],
          metadata: {},
        };
      }
      return null;
    },
    async content(fileId) {
      if (fileId === 'file-1') {
        return { data: new Uint8Array([104, 105]), mimeType: 'text/plain' };
      }
      return null;
    },
    async remove(fileId) {
      return { deleted: fileId === 'file-1', softDeletedAt: '2026-01-02T00:00:00Z' };
    },
    ...overrides,
  };
  return backend;
}

describe('registerUploadHandlers', () => {
  it('registers handlers for every channel', () => {
    const host = makeHost();
    const backend = makeBackend();
    const { disposers } = registerUploadHandlers({ host, backend });
    expect(host.calls.size).toBe(Object.values(UPLOAD_IPC_CHANNELS).length);
    for (const channel of Object.values(UPLOAD_IPC_CHANNELS)) {
      expect(host.calls.has(channel)).toBe(true);
    }
    expect(disposers.length).toBe(Object.values(UPLOAD_IPC_CHANNELS).length);
  });

  it('upload handler returns ok with metadata on success', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.uploadFile)!;
    const buffer = new Uint8Array([1, 2, 3, 4]);
    const response = (await handler({
      buffer,
      originalName: 'hello.txt',
      mimeType: 'text/plain',
      uploadedByNodeId: 'node-7',
      threadId: 'thread-1',
      tags: ['inbox'],
      metadata: { source: 'test' },
    })) as { ok: boolean; file?: { fileId: string }; code?: string; message?: string };
    expect(response.ok).toBe(true);
    expect(response.file?.fileId).toBe('file-1');
    expect(backend.uploadCalls[0]?.originalName).toBe('hello.txt');
    expect(backend.uploadCalls[0]?.tags).toEqual(['inbox']);
  });

  it('upload handler rejects empty filenames', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.uploadFile)!;
    const response = (await handler({
      buffer: new Uint8Array([1]),
      originalName: '   ',
      mimeType: 'text/plain',
      uploadedByNodeId: 'node-7',
      threadId: null,
      tags: [],
      metadata: {},
    })) as { ok: boolean; code?: string; message?: string };
    expect(response.ok).toBe(false);
    expect(response.code).toBe('invalid_name');
  });

  it('upload handler rejects payloads exceeding maxBytes', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend, maxBytes: 4 });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.uploadFile)!;
    const response = (await handler({
      buffer: new Uint8Array([1, 2, 3, 4, 5]),
      originalName: 'big.bin',
      mimeType: 'application/octet-stream',
      uploadedByNodeId: 'node-7',
      threadId: null,
      tags: [],
      metadata: {},
    })) as { ok: boolean; code?: string };
    expect(response.ok).toBe(false);
    expect(response.code).toBe('too_large');
  });

  it('upload handler rejects payloads missing buffer', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.uploadFile)!;
    const response = (await handler({ originalName: 'x' }) as { ok: boolean; code?: string });
    expect(response.ok).toBe(false);
    expect(response.code).toBe('invalid_name');
  });

  it('upload handler propagates backend errors as UploadResponse', async () => {
    const host = makeHost();
    const backend = makeBackend({
      upload: async () => {
        throw Object.assign(new Error('boom'), { code: 'io_error', message: 'boom' });
      },
    });
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.uploadFile)!;
    const response = (await handler({
      buffer: new Uint8Array([1]),
      originalName: 'x.txt',
      mimeType: 'text/plain',
      uploadedByNodeId: 'n',
      threadId: null,
      tags: [],
      metadata: {},
    })) as { ok: boolean; code?: string; message?: string };
    expect(response.ok).toBe(false);
    expect(response.code).toBe('io_error');
    expect(response.message).toBe('boom');
  });

  it('list handler forwards filter to backend', async () => {
    const host = makeHost();
    const listSpy = vi.fn(async () => []);
    const backend: BackendClient = { ...makeBackend(), list: listSpy } as BackendClient;
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.listFiles)!;
    await handler({ threadId: 't-1', nodeId: 'n-1' });
    expect(listSpy).toHaveBeenCalledWith({ threadId: 't-1', nodeId: 'n-1' });
  });

  it('metadata handler returns not_found when backend returns null', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.getMetadata)!;
    const response = (await handler({ fileId: 'missing' })) as { ok: boolean; code?: string };
    expect(response.ok).toBe(false);
    expect(response.code).toBe('not_found');
  });

  it('metadata handler requires fileId', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.getMetadata)!;
    const response = (await handler({})) as { ok: boolean; code?: string };
    expect(response.ok).toBe(false);
    expect(response.code).toBe('invalid_name');
  });

  it('content handler returns null when file missing', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.getContent)!;
    const response = (await handler({ fileId: 'nope' })) as { data: ArrayBuffer } | null;
    expect(response).toBeNull();
  });

  it('content handler returns ArrayBuffer copy with mimeType', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.getContent)!;
    const response = (await handler({ fileId: 'file-1' })) as { data: ArrayBuffer; mimeType: string };
    expect(response.mimeType).toBe('text/plain');
    const view = new Uint8Array(response.data);
    expect(Array.from(view)).toEqual([104, 105]);
  });

  it('delete handler returns ok', async () => {
    const host = makeHost();
    const backend = makeBackend();
    registerUploadHandlers({ host, backend });
    const handler = host.calls.get(UPLOAD_IPC_CHANNELS.deleteFile)!;
    const response = (await handler({ fileId: 'file-1' })) as { ok: boolean };
    expect(response.ok).toBe(true);
  });

  it('disposers unregister handlers', () => {
    const host = makeHost();
    const backend = makeBackend();
    const { disposers } = registerUploadHandlers({ host, backend });
    disposers.forEach((dispose) => dispose());
    expect(host.calls.size).toBe(0);
  });
});

describe('helpers exported from ipc-handlers', () => {
  it('unwrapBuffer tolerates missing buffer', () => {
    expect(__testing__.unwrapBuffer(null)).toBeNull();
    expect(__testing__.unwrapBuffer({})).toBeNull();
    const buffer = new Uint8Array([1, 2, 3]);
    expect(__testing__.unwrapBuffer({ buffer })).toBe(buffer);
  });

  it('unwrapString defaults to empty string', () => {
    expect(__testing__.unwrapString(null, 'x')).toBe('');
    expect(__testing__.unwrapString({}, 'x', 'fallback')).toBe('fallback');
    expect(__testing__.unwrapString({ x: 'value' }, 'x')).toBe('value');
  });

  it('unwrapTags filters non-string entries', () => {
    expect(__testing__.unwrapTags({ tags: ['a', 2, 'b'] })).toEqual(['a', 'b']);
    expect(__testing__.unwrapTags(null)).toEqual([]);
  });

  it('unwrapMetadata returns object or empty', () => {
    expect(__testing__.unwrapMetadata(null)).toEqual({});
    expect(__testing__.unwrapMetadata({ metadata: { a: 1 } })).toEqual({ a: 1 });
  });

  it('unwrapThreadId normalises empty values', () => {
    expect(__testing__.unwrapThreadId(null)).toBeNull();
    expect(__testing__.unwrapThreadId({ threadId: '' })).toBeNull();
    expect(__testing__.unwrapThreadId({ threadId: 't-1' })).toBe('t-1');
  });

  it('unwrapFileId requires non-empty string', () => {
    expect(__testing__.unwrapFileId(null)).toBeNull();
    expect(__testing__.unwrapFileId({ fileId: '' })).toBeNull();
    expect(__testing__.unwrapFileId({ fileId: 'ok' })).toBe('ok');
  });

  it('toUint8 copies a slice of an ArrayBuffer', () => {
    const view = __testing__.toUint8(new Uint8Array([1, 2, 3]));
    expect(Array.from(view)).toEqual([1, 2, 3]);
    const buf = new ArrayBuffer(4);
    new Uint8Array(buf).set([9, 8, 7, 6]);
    expect(Array.from(__testing__.toUint8(buf))).toEqual([9, 8, 7, 6]);
  });

  it('makeError produces UploadError', () => {
    expect(__testing__.makeError('io_error', 'x')).toEqual({ ok: false, code: 'io_error', message: 'x' });
  });
});
