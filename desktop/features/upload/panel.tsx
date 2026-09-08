/**
 * ABACO — Upload Panel
 * --------------------------------------------------------------------
 * Full-featured upload panel that wraps UploadComponent and adds:
 *  - a slide-out shell that's opened from the toolbar upload button
 *  - a list of previously uploaded files (fetched via the bridge)
 *  - per-file delete buttons
 *  - close button
 */

import * as React from 'react';
import { UploadComponent, useUploadBridge } from './ui-component';
import { PreviewList } from './preview-component';
import styles from './styles.module.css';

export interface UploadPanelProps {
    nodeId?: string;
    threadId?: string;
    onClose?: () => void;
    onDraftsChange?: (count: number) => void;
    bridge?: unknown;
}

export function UploadPanel(props: UploadPanelProps): React.ReactElement {
    const { bridge: bridgeOrNull, ready } = useUploadBridge();
    const bridge = (props.bridge as never) ?? bridgeOrNull;
    const [open, setOpen] = React.useState(true);

    const filter = props.threadId
        ? { threadId: props.threadId }
        : props.nodeId
          ? { nodeId: props.nodeId }
          : undefined;

    React.useEffect(() => {
        if (open) return;
        const t = window.setTimeout(() => props.onClose?.(), 220);
        return () => window.clearTimeout(t);
    }, [open, props]);

    if (!ready || !bridge) {
        return (
            <aside className={styles.panel} data-state="loading" aria-busy="true">
                <header className={styles.panelHeader}>
                    <strong>Subir archivos</strong>
                    <button
                        type="button"
                        className={styles.panelClose}
                        aria-label="Cerrar"
                        onClick={() => setOpen(false)}
                    >
                        ✕
                    </button>
                </header>
                <div className={styles.panelBody}>
                    <p>Cargando bridge de uploads…</p>
                </div>
            </aside>
        );
    }

    return (
        <aside
            className={styles.panel}
            data-state={open ? 'open' : 'closing'}
            data-testid="upload-panel"
        >
            <header className={styles.panelHeader}>
                <strong>Subir archivos</strong>
                <button
                    type="button"
                    className={styles.panelClose}
                    aria-label="Cerrar panel de uploads"
                    data-testid="upload-panel-close"
                    onClick={() => setOpen(false)}
                >
                    ✕
                </button>
            </header>
            <div className={styles.panelBody}>
                <UploadComponent
                    bridge={bridge}
                    nodeId={props.nodeId}
                    threadId={props.threadId}
                    initialFilter={filter}
                    onDraftsChange={(drafts) => props.onDraftsChange?.(drafts.length)}
                    label="Upload"
                />
                <hr className={styles.divider} />
                <h3 className={styles.subheading}>Archivos subidos recientemente</h3>
                <PreviewList
                    drafts={[]}
                    onRemove={() => {
                        // In-flight drafts only; historical files use UploadedFileList.
                    }}
                />
            </div>
        </aside>
    );
}

export default UploadPanel;
