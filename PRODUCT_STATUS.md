# Blue RAG Product Status

## Delivered artifact

Recommended Windows installer:

```text
release/Blue-RAG-Setup-0.2.3.exe
```

Portable Windows desktop app:

```text
release/Blue-RAG-Portable-0.2.3.exe
```

Unpacked app for local verification:

```text
release/win-unpacked/Blue RAG.exe
```

## Current product capabilities

- Windows desktop app shell using Electron + React.
- Local backend starts automatically inside the desktop app.
- 100% offline document Q&A after models are present in Ollama.
- Multilingual/Farsi-first configuration.
- Folder picker for client-selected folders.
- Simple folder controls: Add folder, Remove, Index/re-index.
- Removing a folder also clears matching indexed chunks.
- PDF extraction fixed for the current `pdf-parse` API.
- Local document indexing.
- Local embeddings using Ollama `bge-m3` or bundled `models/embeddings/bge-m3.gguf`.
- Local generation using Ollama models or GGUF models through bundled `llama.cpp`.
- Source-cited answers.
- Open-source model runtime via Ollama.
- Client data stored locally under the app user-data directory.

## Models downloaded on this machine

```text
bge-m3:latest          1.2 GB
qwen2.5:7b-instruct    4.7 GB
```

## Verification completed

- `npm install` passed.
- `npm run typecheck` passed.
- `npm run app:build` passed.
- `npm run dist` produced both an installer and a portable Windows executable.
- Packaged renderer was inspected through Chromium DevTools Protocol and confirmed to render the React UI.
- Packaged desktop app launched successfully.
- Packaged app backend responded on `127.0.0.1:3344`.
- Packaged app indexed the included Persian sample document.
- Packaged app answered a Persian question with source citation `[1]`.

## Notes

- Ollama is optional when both an embedding GGUF and an answer GGUF are bundled or selected in the app.
- This build does not send documents to any cloud service.
- The current vector store is a simple local JSON store suitable for prototype/demo scale. For production-scale client folders, replace it with LanceDB or Qdrant local.
- OCR for scanned Persian PDFs is not included yet.
