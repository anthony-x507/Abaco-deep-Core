/**
 * ABACO — Audio Panel
 * --------------------------------------------------------------------
 * Slide-out voice panel with:
 *  - big microphone button that toggles recording
 *  - live waveform while recording
 *  - live transcription text below the waveform
 *  - voice selector for TTS
 *  - per-message play button on agent replies
 *  - settings: language, whisper model, speech rate
 *
 * The panel is purely presentational. All state is delegated to the
 * provided IPC.
 */

import * as React from 'react';
import { MicButton } from './mic-button';
import { SpeakerButton } from './speaker-button';
import { Waveform } from './waveform';
import type { AudioError, RecorderState, VoiceInfo } from './types';

export interface AudioPanelProps {
    /** IPC bridge to the voice backend. */
    ipc: {
        listVoices(): Promise<VoiceInfo[]>;
        status(): Promise<{ stt_available: boolean; tts_available: boolean }>;
        transcribe(blob: Blob, meta: { language?: string | null }): Promise<
            | { ok: true; text: string; language: string }
            | { ok: false; error: string }
        >;
        speak(text: string, voice: string, rate: number): Promise<void>;
        synthesize(text: string, voice: string, rate: number): Promise<Blob>;
    };
    /** Called with the latest transcript text. */
    onTranscript?: (text: string, language: string) => void;
    /** Forward errors so the host shell can show a toast. */
    onError?: (err: AudioError) => void;
    /** Called when the user clicks the close button. */
    onClose?: () => void;
    /** Initial voice to use for TTS. Defaults to "es_Mexico". */
    initialVoice?: string;
}

export function AudioPanel(props: AudioPanelProps): React.ReactElement {
    const [recorderState, setRecorderState] = React.useState<RecorderState>('idle');
    const [transcript, setTranscript] = React.useState<string>('');
    const [voices, setVoices] = React.useState<readonly VoiceInfo[]>([]);
    const [selectedVoice, setSelectedVoice] = React.useState<string>(props.initialVoice ?? 'es_Mexico');
    const [rate, setRate] = React.useState<number>(200);
    const [language, setLanguage] = React.useState<string>('es');
    const [showSettings, setShowSettings] = React.useState<boolean>(false);

    React.useEffect(() => {
        let cancelled = false;
        void props.ipc.listVoices().then((list) => {
            if (cancelled) return;
            setVoices(list);
            if (list.length > 0 && !list.find((v) => v.name === selectedVoice)) {
                setSelectedVoice(list[0].name);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [props.ipc]);

    const handleTranscript = (text: string, lang: string): void => {
        setTranscript(text);
        props.onTranscript?.(text, lang);
    };

    return (
        <aside className="abaco-audio-panel" data-testid="audio-panel">
            <header className="abaco-audio-panel__header">
                <strong>Voz</strong>
                <button
                    type="button"
                    className="abaco-audio-panel__close"
                    aria-label="Cerrar panel de voz"
                    onClick={() => props.onClose?.()}
                >
                    ✕
                </button>
            </header>

            <div className="abaco-audio-panel__record">
                <MicButton
                    ipc={props.ipc as never}
                    language={language}
                    onTranscript={handleTranscript}
                    onError={(err) => props.onError?.(err)}
                    size={64}
                />
                <span className="abaco-audio-panel__record-label">
                    {recorderState === 'recording' ? 'Grabando...' : 'Mantén presionado para hablar'}
                </span>
            </div>

            <Waveform
                maxBars={48}
                height={48}
                active={recorderState === 'recording'}
            />

            {transcript ? (
                <div className="abaco-audio-panel__transcript">
                    <h4>Transcripción</h4>
                    <p>{transcript}</p>
                </div>
            ) : null}

            <div className="abaco-audio-panel__tts">
                <label htmlFor="voice-select">Voz TTS</label>
                <select
                    id="voice-select"
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                >
                    {voices.map((v) => (
                        <option key={v.name} value={v.name}>
                            {v.name} ({v.language})
                        </option>
                    ))}
                </select>
                <SpeakerButton
                    text={transcript}
                    voice={selectedVoice}
                    rate={rate}
                    ipc={props.ipc as never}
                />
            </div>

            <details
                className="abaco-audio-panel__settings"
                open={showSettings}
                onToggle={(e) => setShowSettings((e.target as HTMLDetailsElement).open)}
            >
                <summary>Settings</summary>
                <label>
                    Idioma de transcripción:
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                        <option value="es">Español</option>
                        <option value="en">English</option>
                        <option value="">Auto-detect</option>
                    </select>
                </label>
                <label>
                    Velocidad (TTS):
                    <input
                        type="range"
                        min={120}
                        max={320}
                        value={rate}
                        onChange={(e) => setRate(parseInt(e.target.value, 10))}
                    />
                    <span>{rate} wpm</span>
                </label>
            </details>
        </aside>
    );
}

export default AudioPanel;
