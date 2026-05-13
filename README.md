# AI Text Summarization Platform

An AI-powered web application for summarizing text using HuggingFace Transformers.

## Project Structure

```
summarizer/
├── api/
│   └── main.py              # FastAPI backend — file parsing, preprocessing, HF API proxy
├── static/
│   ├── css/
│   │   └── style.css        # Full design system: light + dark themes, all components
│   └── js/
│       └── app.js           # All frontend logic: tabs, file parsing, API calls, downloads
├── templates/
│   └── index.html           # HTML structure only — imports CSS and JS
├── requirements.txt
└── README.md
```

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Set HuggingFace API token (optional but recommended)

```bash
export HF_API_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx
```

Without a token the app uses HuggingFace's public inference endpoint (rate-limited).
Get a free token at https://huggingface.co/settings/tokens

### 3. Run the server

```bash
# From the project root
cd summarizer
uvicorn api.main:app --reload --port 8000
```

Open http://localhost:8000 in your browser.

### 4. Standalone (no backend)

Open `templates/index.html` directly in a browser.
The JS will call HuggingFace directly from the frontend (requires CORS — works on public models).

---

## Features

| Feature | Details |
|---|---|
| Input modes | Paste text · File upload |
| File formats | .txt .md .tex .latex .html .rtf .rst .org .docx .pdf .csv |
| AI models | BART-large-CNN · DistilBART · PEGASUS-XSum · BART-SAMSum · Long-T5 |
| Tone | Auto-detect · Formal · Informal · Academic · Technical · Neutral · Creative |
| Condensation | Ratio % · Word count · Character count · Paragraph count |
| Output formats | Paragraphs · Bullet points |
| Export | .txt · .md · .html · .pdf (print) · .docx · Copy to clipboard |
| Themes | Light · Dark (system preference + manual toggle) |

export
- **Documentation (10)** — This README + inline code comments
