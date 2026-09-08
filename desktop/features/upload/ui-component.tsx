// React component that renders the "+ Upload" button, click-to-upload
// behaviour and a drag-and-drop zone for files.  The component is
// intentionally framework-agnostic: it exposes an `onChange` callback
// (in addition to internal state) so it can be embedded next to the
// chat input without coupling to the rest of the shell.
//
// The component is pure presentational.  Persistence and IPC live in
// `ipc-handlers.ts` and `preload-bridge.ts`.  We obtain the bridge via
// `useUploadBridge` so unit tests can inject a fake.

import {
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { PreviewList } from './preview-component';
import styles from './styles.module.css';
import type {
  UploadBridge,
  UploadDraft,
  UploadListFilter,
  UploadRequestPayload,
  UploadedFileMetadata,
} from './types';

const DEFAULT_NODE_ID = 'unknown-node';

function makeLocalId(): string {
  // Avoid `crypto.randomUUID` for environments that lack the Web Crypto
  // API (older Electron renderers).  The ID only needs to be unique
  // within the UI session.
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function inferMime(file: File): string {
  if (file.type && file.type.length > 0) {
    return file.type;
  }
  // Some Electron builds report an empty mime.  Fall back to a safe
  // value so the backend validator at least sees something meaningful.
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
  return 'application/octet-stream';
}

export interface UploadComponentProps {
  /** The bridge used to talk to the main process. */
  bridge: UploadBridge;
  /** Identifier of the current node, recorded on each upload. */
  nodeId?: string;
  /** Identifier of the chat thread the files will be attached to. */
  threadId?: string | null;
  /** Optional filter used by `bridge.list` on mount. */
  initialFilter?: UploadListFilter;
  /** Called whenever the in-flight drafts change. */
  onDraftsChange?: (drafts: readonly UploadDraft[]) => void;
  /** Optional label override. */
  label?: ReactNode;
  /** Disable the upload button (e.g. while the agent is processing). */
  disabled?: boolean;
}

interface DraftEntry {
  draft: UploadDraft;
  file: File;
}

export function UploadComponent(props: UploadComponentProps): ReactElement {
  const { bridge, nodeId = DEFAULT_NODE_ID, threadId = null, initialFilter, onDraftsChange, label, disabled = false } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [drafts, setDrafts] = useState<readonly DraftEntry[]>([]);
  const [isDragActive, setDragActive] = useState(false);
  const inputId = useId();

  // Publish draft changes upstream so the chat composer can attach them
  // to its outgoing message.
  useEffect(() => {
    onDraftsChange?.(drafts.map((entry) => entry.draft));
  }, [drafts, onDraftsChange]);

  const startUpload = useCallback(
    async (entry: DraftEntry): Promise<void> => {
      const buffer = await entry.file.arrayBuffer();
      const payload: UploadRequestPayload = {
        data: new Uint8Array(buffer),
        originalName: entry.file.name,
        mimeType: entry.draft.mimeType,
        uploadedByNodeId: nodeId,
        threadId,
        tags: [],
        metadata: { source: 'upload-component' },
      };
      setDrafts((current) =>
        current.map((existing) =>
          existing.draft.localId === entry.draft.localId
            ? {
                ...existing,
                draft: { ...existing.draft, status: 'uploading', progress: 0.25 },
              }
            : existing,
        ),
      );
      const response = await bridge.upload(payload);
      if (response.ok) {
        const meta: UploadedFileMetadata = response.file;
        setDrafts((current) =>
          current.map((existing) =>
            existing.draft.localId === entry.draft.localId
              ? {
                  ...existing,
                  draft: {
                    ...existing.draft,
                    status: 'ready',
                    progress: 1,
                    serverFileId: meta.fileId,
                  },
                }
              : existing,
          ),
        );
      } else {
        setDrafts((current) =>
          current.map((existing) =>
            existing.draft.localId === entry.draft.localId
              ? {
                  ...existing,
                  draft: {
                    ...existing.draft,
                    status: 'failed',
                    errorMessage: response.message,
                  },
                }
              : existing,
          ),
        );
      }
    },
    [bridge, nodeId, threadId],
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      const additions: DraftEntry[] = files.map((file) => ({
        file,
        draft: {
          localId: makeLocalId(),
          fileName: file.name,
          mimeType: inferMime(file),
          sizeBytes: file.size,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
          status: 'pending',
          progress: 0,
        },
      }));
      setDrafts((current) => [...current, ...additions]);
      // Kick off uploads in the background; failures are surfaced via
      // draft status.
      void additions.forEach((entry) => {
        void startUpload(entry);
      });
    },
    [startUpload],
  );

  const handleClick = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) {
        addFiles(event.target.files);
        // Reset so picking the same file twice still fires `change`.
        event.target.value = '';
      }
    },
    [addFiles],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      if (event.dataTransfer?.files) {
        addFiles(event.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleRemove = useCallback((localId: string) => {
    setDrafts((current) => {
      const next = current.filter((entry) => entry.draft.localId !== localId);
      // Revoke any blob URL we created so the renderer can GC the
      // preview image.
      const removed = current.find((entry) => entry.draft.localId === localId);
      if (removed?.draft.previewUrl) {
        URL.revokeObjectURL(removed.draft.previewUrl);
      }
      return next;
    });
  }, []);

  // Pre-populate from the backend if requested (e.g. when the user
  // navigates back to an existing thread).
  useEffect(() => {
    let cancelled = false;
    if (!initialFilter) return;
    void bridge.list(initialFilter).then((items) => {
      if (cancelled) return;
      if (items.length === 0) return;
      setDrafts((current) => {
        const existing = new Set(current.map((entry) => entry.draft.serverFileId));
        const additions: DraftEntry[] = items
          .filter((meta) => !existing.has(meta.fileId))
          .map((meta) => ({
            file: new File([new Uint8Array(0)], meta.originalName, { type: meta.mimeType }),
            draft: {
              localId: makeLocalId(),
              fileName: meta.originalName,
              mimeType: meta.mimeType,
              sizeBytes: meta.sizeBytes,
              status: 'ready',
              progress: 1,
              serverFileId: meta.fileId,
            },
          }));
        return [...current, ...additions];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, initialFilter]);

  const draftView = useMemo(() => drafts.map((entry) => entry.draft), [drafts]);

  return (
    <div className={styles.root} data-testid="upload-root">
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={handleClick}
          data-disabled={disabled ? 'true' : 'false'}
          aria-label="Subir archivo"
          data-testid="upload-button"
        >
          + {label ?? 'Upload'}
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className={styles.hiddenInput}
          multiple
          onChange={handleChange}
          data-testid="upload-input"
          aria-hidden="true"
          tabIndex={-1}
        />
        <span className={styles.dropzoneHint}>o arrastra y suelta aquí</span>
      </div>
      <div
        ref={dropRef}
        className={styles.dropzone}
        data-active={isDragActive ? 'true' : 'false'}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="upload-dropzone"
      >
        <strong>Suelta archivos para subirlos</strong>
        <div className={styles.dropzoneHint}>PDF, imágenes, texto, código o ZIP — máx. 100 MB c/u</div>
      </div>
      <PreviewList drafts={draftView} onRemove={handleRemove} />
    </div>
  );
}

export interface UseUploadBridgeResult {
  readonly bridge: UploadBridge | null;
}

export function useUploadBridge(): UseUploadBridgeResult {
  const [bridge, setBridge] = useState<UploadBridge | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.abacoUpload) {
      setBridge(window.abacoUpload);
      return;
    }
    // If the bridge isn't installed yet (e.g. the preload script loads
    // asynchronously), poll briefly before giving up.  This keeps the
    // component usable in dev environments where preload order isn't
    // guaranteed.
    let cancelled = false;
    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      if (window.abacoUpload) {
        setBridge(window.abacoUpload);
        window.clearInterval(interval);
      } else if (attempts > 20) {
        window.clearInterval(interval);
      }
    }, 50);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void cancelled;
    };
  }, []);
  return { bridge };
}
