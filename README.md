# Blue RAG

Offline Windows desktop RAG app optimized for multilingual and Persian/Farsi documents.

## Delivered app

Recommended Windows installer:

```text
release/Blue-RAG-Setup-0.2.4.exe
```

Portable Windows executable:

```text
release/Blue-RAG-Portable-0.2.4.exe
```

Unpacked executable used for verification:

```text
release/win-unpacked/Blue RAG.exe
```

## Capabilities

- Windows desktop app using Electron + React.
- Local backend starts automatically inside the app.
- 100% offline document Q&A after models are downloaded.
- Simple folder controls: Add folder, Remove, Index/re-index.
- Removing a folder also clears matching indexed chunks.
- Local indexing for `.txt`, `.md`, `.html`, `.csv`, `.json`, `.pdf`, `.docx`.
- Farsi/Persian-friendly multilingual retrieval using `bge-m3`.
- Local answer generation using Ollama models or bundled GGUF models through `llama.cpp`.
- Bundled local embeddings are supported through `models/embeddings/*.gguf`.
- Source citations for answers.
- Local data directory per Windows user.

## Client runtime

For client builds, bundle the embedding model before packaging:

```text
models/embeddings/bge-m3.gguf
```

With that file included, clients do not need to run PowerShell commands for
embeddings.

For the answer model, either bundle GGUF files under:

```text
models/llm/
```

or let the client choose a GGUF model folder inside the app.

Ollama is optional for development. If you use Ollama instead of bundled GGUF
models, make sure these models exist locally:

```powershell
ollama pull bge-m3
ollama pull qwen2.5:7b-instruct
```

This machine already has both models downloaded.

## Developer commands

```powershell
npm install
npm run typecheck
npm run app:build
npm run dist
```

Run backend-only development server:

```powershell
npm run dev
```

Run packaged-app/API smoke test while the app or backend is running:

```powershell
npm run smoke
```

## API

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:3344/health
```

Add a folder:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:3344/folders -ContentType 'application/json' -Body '{"path":"C:\\path\\to\\docs"}'
```

Index folders:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:3344/index/run -ContentType 'application/json' -Body '{}'
```

Ask in Persian:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:3344/chat/ask -ContentType 'application/json; charset=utf-8' -Body '{"question":"این سند درباره چیست؟"}'
```

## Verification summary

See `PRODUCT_STATUS.md` for the tested artifact and verification log.
