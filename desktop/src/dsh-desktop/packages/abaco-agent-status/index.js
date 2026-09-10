/**
 * Host half for the browser-only ABACO agent-status plugin.
 *
 * The indicator is a pure renderer concern: it reads the live Session
 * snapshot (`SessionSnapshot.running`) through the session-scope standard
 * props of `conversation.session.header.actions` and draws a status pill.
 * No Node-side state or service exists today, so this half is inert — the
 * client half (`./client.js`) does all the work, exactly like abaco-voice.
 */
export function apply() {}
