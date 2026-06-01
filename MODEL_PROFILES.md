# Offline Model Profiles

## Test profile - this machine

Hardware detected:
- RAM: about 32GB
- GPU: NVIDIA RTX 3070 Ti Laptop GPU, 8GB VRAM
- Ollama: installed

Recommended local models for prototype:

```text
Embedding: bge-m3
LLM: qwen2.5:7b-instruct
```

Why:
- `bge-m3` is strong for multilingual retrieval and suitable for Persian/Farsi document search.
- `qwen2.5:7b-instruct` is practical on 8GB VRAM and has solid multilingual ability.

## Client profiles

### Low-spec CPU-only
- Embedding: `bge-m3` if acceptable speed, otherwise smaller multilingual MiniLM/E5 model in a later non-Ollama path
- LLM: `qwen2.5:3b-instruct` or `phi3.5:latest`
- Use smaller chunk count/top_k

### Mid-spec 16-32GB RAM
- Embedding: `bge-m3`
- LLM: `qwen2.5:7b-instruct`

### High-spec GPU
- Embedding: `bge-m3`
- LLM: `qwen2.5:14b-instruct` or newer Qwen multilingual model

## Farsi/Persian optimization notes

- Retrieval quality matters more than generation model size for document Q&A.
- `bge-m3` should be the default multilingual embedding model.
- Keep prompts language-aware: answer in the same language as the user.
- Add OCR later for scanned Persian PDFs.
- Add a Farsi eval set: short Persian PDFs/DOCX files with known answers.
