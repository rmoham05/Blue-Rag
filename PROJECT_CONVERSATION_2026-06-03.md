# Blue RAG Project Conversation Notes - 2026-06-03

Use this file as the first thing to read when returning to the Blue RAG project.

## Project Identity

- Product name: Blue RAG
- Repo: https://github.com/rmoham05/Blue-Rag
- Local working folder: `C:\Users\14169\OneDrive\Desktop\Main\Learning\AIAutomate\Projects\local-rag-app`
- Current version at time of this note: `0.2.6`
- Current Git commit: `33a16b7 Answer in detected question language`
- Current release files:
  - `release\Blue-RAG-Setup-0.2.6.exe`
  - `release\Blue-RAG-Portable-0.2.6.exe`

## What The App Is

Blue RAG is an offline Windows desktop RAG app built with Electron, React, Fastify, TypeScript, local llama.cpp runtimes, and a bundled embedding model. It is intended for local/private document Q&A, including Persian/Farsi and English documents.

The client should normally receive:

- One app EXE, usually `Blue-RAG-Setup-<version>.exe`
- The separate answer model GGUF file/folder, if using a local GGUF answer model

Do not send `.blockmap` files for manual client installs. They are for updater/differential-update workflows.

## Major Decisions And Fixes

### Branding

- Renamed the app from Local RAG to Blue RAG.
- Added the bluemouse.ai logo/icon assets.
- Electron window, package metadata, UI title, shortcuts, installer names, and docs now use Blue RAG.

### Bundled Embedding Model

- The app bundles `bge-m3` as the embedding model.
- Large GGUF files are ignored in Git with `models/**/*.gguf` because GitHub blocks normal files over 100 MiB.
- The bundled embedding model is included in the packaged EXE by electron-builder, but not committed to GitHub.

### Local GGUF Answer Model

- The answer model is selected/loaded by the user from a GGUF file/folder.
- The app supports split GGUF files using llama.cpp.
- The client should load/select the answer model inside the UI.

### Initial Model Not Loaded Error

Fixed the error:

`llama.cpp model is not loaded. Click Load for the local GGUF model first.`

The backend now loads the selected llama.cpp answer model before answering.

### Embedding Batch Error

Customer saw:

`input (564 tokens) is too large to process. increase the physical batch size (current batch size: 512)`

Fixes:

- llama.cpp embedding batch/micro-batch raised to `2048`.
- default chunk size reduced to make indexing safer.
- verified bundled `bge-m3` returns 1024-dimensional embeddings.

### Bad File During Indexing

Indexing now continues if a file or folder fails.

- Failed files are skipped and logged internally.
- Good files are still indexed and saved.
- Failed files do not leave partial chunks in the index.
- UI no longer shows scary raw technical errors to the client.
- UI shows `Files skipped` instead.

### Release Folder Cleanup

Added `scripts/clean-release.mjs`.

`npm run dist` now cleans the generated `release` folder before packaging a new version, so old EXEs do not accumulate.

Note: if a portable EXE is currently running from `release`, Windows locks it. Stop the old portable process before rebuilding.

### Better Answer Quality

The app was behaving too much like a search tool and telling users to consult documents.

Fixes:

- Prompt now tells the model it is a document-grounded assistant, not a search-results tool.
- It must answer directly using retrieved excerpts.
- It should synthesize across retrieved sources.
- It should not say "consult/refer to the document" as a substitute for answering.
- It now retrieves 8 chunks by default for question answering.
- Answer generation limit increased from 450 to 850 tokens.

### Citation Cleanup

Academic PDFs caused the model to copy internal bibliography numbers like `[12]`, `[101]`, etc.

Fixes:

- Retrieved context strips bibliography-style bracket numbers before prompting.
- Prompt says only Blue RAG source IDs `[1]` through `[N]` are valid.
- Final answer is post-processed to remove bracket citations outside the actual source count.

### Response Language

As of `0.2.6`, the backend detects the question language and injects a hard instruction:

- Farsi/Persian question -> answer in Farsi/Persian
- English question -> answer in English

Fallback messages such as "no indexed documents" and "no sufficiently relevant information" also follow the detected language.

## Important Files

- `src/server.ts`: Fastify API, RAG retrieval, prompt construction, citation cleanup, language detection.
- `src/llamaCppRuntime.ts`: local llama.cpp answer and embedding runtime management.
- `src/ollama.ts`: embedding/generation wrapper for Ollama and local llama.cpp embeddings.
- `src/indexer.ts`: folder walk, file extraction, chunking, embedding, skip-bad-file behavior.
- `src/text.ts`: text extraction and chunking.
- `src/bundledModels.ts`: detects bundled GGUF models in packaged app.
- `ui/src/App.tsx`: React UI, model loading, indexing, chat, source buttons.
- `electron/main.cjs`: Electron launcher and stale backend detection.
- `package.json`: version, electron-builder config, artifact names.
- `scripts/clean-release.mjs`: cleans generated release output before packaging.
- `CLIENT_HANDOFF.md`: client-facing packaging instructions.
- `PRODUCT_STATUS.md`: current build status summary.

## Build And Release Commands

Run checks:

```powershell
npm.cmd run typecheck
npm.cmd run app:build
```

Build clean release:

```powershell
npm.cmd run dist
```

Expected output is under `release\`.

## Git Workflow

Repo is already connected to GitHub.

For future changes:

```powershell
git status
git pull --rebase origin main
git add .
git commit -m "Describe the change"
git push
```

Keep generated files and large local assets out of Git:

- `node_modules/`
- `dist/`
- `.rag-data/`
- `release/`
- `models/**/*.gguf`

## Current Git History

```text
33a16b7 Answer in detected question language
f247095 Clean hallucinated document citation numbers
0276794 Improve document-grounded answer synthesis
be4e112 Initial Blue RAG app
```

## Client Distribution Notes

For a normal client handoff:

- Send `Blue-RAG-Setup-<version>.exe` or `Blue-RAG-Portable-<version>.exe`.
- Send the separate answer model GGUF file/folder.
- Do not send `.blockmap`.
- The bundled `bge-m3` embedding model is inside the app package.
- Client should close all old Blue RAG windows before installing/running a new build.
- Client should load/select the answer model, add document folders, then run `Index / re-index`.

## Known Limitations / Future Improvements

- This is local desktop RAG, so performance depends on the client's machine.
- Large folders are okay conceptually, but indexing can take time.
- Very unusual PDFs can still produce poor extracted text.
- Better future work:
  - show indexing progress per current file
  - add auto retry/split for overlarge chunks
  - add a diagnostic/export log button
  - consider GitHub Releases or another delivery process for EXEs/model files
  - consider Git LFS or external storage if vendor/runtime binaries become too large

