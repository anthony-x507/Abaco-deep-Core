# abaco-documents

Upload PDF / DOCX / TXT / MD / CSV / JSON / YAML / XML documents into the
chat composer. Text extraction runs entirely client-side; binary content
never leaves the device.

## Supported types
| Ext | MIME |
|---|---|
| `.pdf` | application/pdf |
| `.docx` | application/vnd.openxmlformats-officedocument.wordprocessingml.document |
| `.txt` | text/plain |
| `.md` | text/markdown |
| `.csv` | text/csv |
| `.json` | application/json |
| `.yaml` / `.yml` | text/yaml |
| `.xml` | application/xml |

## Limits
- Max 50 MB per file
- Max 200 pages for PDFs
- Extracted text capped at 1 M chars (truncated with marker)

## How it works
1. Click 📎 in the composer accessory → file picker
2. Each file is parsed client-side (`pdfjs-dist` for PDF, `mammoth` for DOCX, FileReader for text)
3. A card appears above input: click × to remove
4. On submit, all `ready` docs are concatenated as `<attachments>` XML blocks appended to the user message
5. After send, the queue is cleared

## Security / privacy
- No binary content is uploaded anywhere
- Text content is appended to the conversation message — it WILL be sent to the model provider (e.g. OpenAI / MiniMax / etc.) as part of the user turn, exactly like typing it
- If you need to redact parts of a document, edit the document or use a text editor first

## Slot injections
| Slot | Component |
|---|---|
| `conversation.input.attachments` | Upload button (📎) |
| `conversation.composer` | Documents row (cards) |
| `conversation.submit` | Wraps submit to inject document context |