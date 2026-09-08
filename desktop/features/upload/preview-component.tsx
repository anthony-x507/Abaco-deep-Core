// Preview component: shows a horizontal row of "pills" representing the
// files the user attached.  Images get a tiny thumbnail; everything else
// shows an icon derived from its MIME type.

import type { ReactElement } from 'react';

import styles from './styles.module.css';
import type { UploadDraft, UploadStatus } from './types';

export interface PreviewListProps {
  drafts: readonly UploadDraft[];
  onRemove?: (localId: string) => void;
}

export function PreviewList(props: PreviewListProps): ReactElement {
  const { drafts, onRemove } = props;
  if (drafts.length === 0) {
    return <></>;
  }
  return (
    <ul className={styles.previewList} data-testid="upload-preview-list">
      {drafts.map((draft) => (
        <PreviewItem key={draft.localId} draft={draft} onRemove={onRemove} />
      ))}
    </ul>
  );
}

export interface PreviewItemProps {
  draft: UploadDraft;
  onRemove?: (localId: string) => void;
}

const ICON_LABELS: Readonly<Record<string, string>> = {
  pdf: 'PDF',
  zip: 'ZIP',
  json: '{}',
  text: 'TXT',
  image: 'IMG',
  binary: 'BIN',
};

function iconForMime(mime: string): string {
  const candidate = mime.toLowerCase();
  if (candidate === 'application/pdf') return ICON_LABELS.pdf;
  if (candidate === 'application/zip' || candidate === 'application/x-zip-compressed') return ICON_LABELS.zip;
  if (candidate === 'application/json') return ICON_LABELS.json;
  if (candidate.startsWith('image/')) return ICON_LABELS.image;
  if (candidate.startsWith('text/')) return ICON_LABELS.text;
  return ICON_LABELS.binary;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusLabel(status: UploadStatus): string {
  switch (status) {
    case 'pending':
      return 'En cola';
    case 'uploading':
      return 'Subiendo…';
    case 'ready':
      return 'Listo';
    case 'failed':
      return 'Error';
    default:
      return status;
  }
}

export function PreviewItem(props: PreviewItemProps): ReactElement {
  const { draft, onRemove } = props;
  return (
    <li className={styles.previewItem} data-testid={`upload-preview-${draft.localId}`}>
      <span className={styles.previewThumb} aria-hidden="true">
        {draft.previewUrl ? (
          <img src={draft.previewUrl} alt="" />
        ) : (
          <span>{iconForMime(draft.mimeType)}</span>
        )}
      </span>
      <span className={styles.previewMeta}>
        <span className={styles.previewName} title={draft.fileName}>
          {draft.fileName}
        </span>
        <span className={styles.previewSub}>{formatBytes(draft.sizeBytes)}</span>
        <span
          className={styles.previewStatus}
          data-status={draft.status}
          data-testid={`upload-preview-status-${draft.localId}`}
        >
          {draft.status === 'failed' && draft.errorMessage
            ? `Error: ${draft.errorMessage}`
            : statusLabel(draft.status)}
        </span>
        {draft.status === 'uploading' || draft.status === 'pending' ? (
          <span className={styles.progress} aria-hidden="true">
            <span className={styles.progressBar} style={{ width: `${Math.round(draft.progress * 100)}%` }} />
          </span>
        ) : null}
      </span>
      {onRemove ? (
        <button
          type="button"
          className={styles.removeButton}
          onClick={() => onRemove(draft.localId)}
          aria-label={`Quitar ${draft.fileName}`}
          data-testid={`upload-preview-remove-${draft.localId}`}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}
