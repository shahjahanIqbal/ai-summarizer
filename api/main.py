"""
AI Text Summarization Platform — FastAPI Backend
Handles file parsing, text preprocessing, and HuggingFace inference.
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx
import re
import os
import io
import logging
from typing import Optional

load_dotenv()

#  Resolve paths relative to the project root (one level up from api/) 
# main.py lives at  <project>/api/main.py
# static/ and templates/ live at  <project>/static/  and  <project>/templates/
API_DIR       = os.path.dirname(os.path.abspath(__file__))  # .../api/
BASE_DIR      = os.path.dirname(API_DIR)                    # .../ (project root)
STATIC_DIR    = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

#  Optional heavy parsers (install if available) 
try:
    import pdfplumber
    HAS_PDF = True
except ImportError:
    HAS_PDF = False

try:
    from docx import Document as DocxDocument
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

try:
    import markdown
    HAS_MD = True
except ImportError:
    HAS_MD = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Text Summarizer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files and templates
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

#HF_API_BASE = "https://api-inference.huggingface.co/models"
HF_API_BASE = "https://router.huggingface.co/hf-inference/models"
SUPPORTED_MODELS = {
    "facebook/bart-large-cnn":               "Best general-purpose. News, articles, reports.",
    "sshleifer/distilbart-cnn-12-6":         "Faster, lighter BART variant.",
    "google/pegasus-xsum":                   "Extreme single-sentence compression.",
    "philschmid/bart-large-cnn-samsum":      "Optimised for dialogues and meetings.",
    "pszemraj/long-t5-tglobal-base-16384-book-summary": "Long documents (up to 16k tokens).",
}

TONE_KEYWORDS = {
    "academic":  ["therefore","hypothesis","methodology","findings","research","abstract",
                  "conclusion","study","analysis","literature","empirical","scholarly"],
    "technical": ["algorithm","function","parameter","implementation","interface","module",
                  "protocol","variable","configuration","deployment","runtime","API"],
    "informal":  ["gonna","wanna","kinda","yeah","hey","okay","nope","awesome","cool",
                  "totally","literally","basically","lol","tbh","imo"],
    "formal":    ["hereby","whereas","pursuant","henceforth","aforementioned","accordingly",
                  "notwithstanding","pertaining","subsequent","herein"],
    "creative":  ["imagine","dream","story","beauty","soul","wonder","magic","journey",
                  "whisper","dance","echo","narrative","vivid"],
}


#  Helpers 

def detect_tone(text: str) -> str:
    lower = text.lower()
    scores = {tone: sum(1 for kw in kws if kw in lower) for tone, kws in TONE_KEYWORDS.items()}
    scores["neutral"] = 1  # fallback floor
    return max(scores, key=scores.get)


def strip_latex(text: str) -> str:
    """Remove LaTeX commands while keeping readable content."""
    text = re.sub(r"\\(?:begin|end)\{[^}]*\}", "", text)
    text = re.sub(r"\$\$.*?\$\$", " [equation] ", text, flags=re.DOTALL)
    text = re.sub(r"\$[^$]+\$", " [equation] ", text)
    text = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+\s?", " ", text)
    text = re.sub(r"[{}]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def strip_markdown(text: str) -> str:
    """Remove Markdown syntax, keep text."""
    text = re.sub(r"#{1,6}\s+", "", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"!\[.*?\]\(.*?\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    return re.sub(r"\s+", " ", text).strip()


def strip_html(text: str) -> str:
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def strip_rst(text: str) -> str:
    text = re.sub(r"^[=\-~^]+$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\.\.\s+\w+::", "", text)
    return re.sub(r"\s+", " ", text).strip()


def preprocess(text: str, ext: str) -> str:
    ext = ext.lower().lstrip(".")
    if ext in ("tex", "latex"):
        return strip_latex(text)
    if ext in ("md", "markdown"):
        return strip_markdown(text)
    if ext in ("html", "htm"):
        return strip_html(text)
    if ext == "rst":
        return strip_rst(text)
    return re.sub(r"\s+", " ", text).strip()


def compute_lengths(text: str, by: str, value: int):
    words = len(text.split())
    if by == "ratio":
        frac = value / 100
        target = max(30, round(words * frac))
    elif by == "words":
        target = max(30, value)
    elif by == "chars":
        target = max(20, value // 5)
    elif by == "paragraphs":
        target = max(20, value * 80)
    else:
        target = max(30, round(words * 0.30))

    min_len = max(20, round(target * 0.6))
    max_len = min(1024, round(target * 1.5))
    return min_len, max_len


def format_output(text: str, fmt: str) -> str:
    if fmt == "bullets":
        sentences = re.split(r"(?<=[.!?])\s+", text.strip())
        return "\n".join(f"• {s.strip()}" for s in sentences if s.strip())
    return text.strip()


#  Routes 

@app.get("/")
async def index():
    return FileResponse(os.path.join(TEMPLATES_DIR, "index.html"))


@app.get("/api/models")
async def list_models():
    return {"models": [{"id": k, "description": v} for k, v in SUPPORTED_MODELS.items()]}


class SummarizeTextRequest(BaseModel):
    text: str
    model: str = "facebook/bart-large-cnn"
    tone: str = "auto"
    output_format: str = "paragraphs"
    condense_by: str = "ratio"
    condense_value: int = 30


@app.post("/api/summarize/text")
async def summarize_text(req: SummarizeTextRequest):
    if len(req.text.strip()) < 50:
        raise HTTPException(400, "Text must be at least 50 characters.")

    text = preprocess(req.text, "txt")
    truncated = text[:4000]
    min_len, max_len = compute_lengths(truncated, req.condense_by, req.condense_value)
    tone = detect_tone(text) if req.tone == "auto" else req.tone

    result = await call_hf(req.model, truncated, min_len, max_len)
    formatted = format_output(result, req.output_format)

    in_words = len(text.split())
    out_words = len(formatted.split())
    return {
        "summary": formatted,
        "tone": tone,
        "stats": {
            "input_words": in_words,
            "output_words": out_words,
            "input_chars": len(text),
            "output_chars": len(formatted),
            "ratio": round(out_words / max(1, in_words) * 100),
        },
    }


@app.post("/api/summarize/file")
async def summarize_file(
    file: UploadFile = File(...),
    model: str = Form("facebook/bart-large-cnn"),
    tone: str = Form("auto"),
    output_format: str = Form("paragraphs"),
    condense_by: str = Form("ratio"),
    condense_value: int = Form(30),
):
    ext = os.path.splitext(file.filename)[1].lower().lstrip(".")
    raw_bytes = await file.read()

    # Extract text based on format
    if ext in ("txt", "md", "tex", "latex", "rst", "org", "csv", "tsv"):
        text = raw_bytes.decode("utf-8", errors="replace")
    elif ext in ("html", "htm"):
        text = strip_html(raw_bytes.decode("utf-8", errors="replace"))
    elif ext == "pdf":
        if not HAS_PDF:
            raise HTTPException(400, "pdfplumber not installed. Run: pip install pdfplumber")
        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    elif ext == "docx":
        if not HAS_DOCX:
            raise HTTPException(400, "python-docx not installed. Run: pip install python-docx")
        doc = DocxDocument(io.BytesIO(raw_bytes))
        text = "\n".join(p.text for p in doc.paragraphs)
    elif ext == "rtf":
        text = raw_bytes.decode("utf-8", errors="replace")
        text = re.sub(r"\\[a-z0-9*]+[\s]?", " ", text)
        text = re.sub(r"[{}]", "", text)
    else:
        raise HTTPException(400, f"Unsupported file type: .{ext}")

    if not text.strip():
        raise HTTPException(400, "No text could be extracted from the file.")

    cleaned = preprocess(text, ext)
    truncated = cleaned[:4000]
    min_len, max_len = compute_lengths(truncated, condense_by, condense_value)
    detected_tone = detect_tone(cleaned) if tone == "auto" else tone

    summary_raw = await call_hf(model, truncated, min_len, max_len)
    formatted = format_output(summary_raw, output_format)

    in_words = len(cleaned.split())
    out_words = len(formatted.split())
    return {
        "summary": formatted,
        "tone": detected_tone,
        "filename": file.filename,
        "stats": {
            "input_words": in_words,
            "output_words": out_words,
            "input_chars": len(cleaned),
            "output_chars": len(formatted),
            "ratio": round(out_words / max(1, in_words) * 100),
        },
    }


async def call_hf(model: str, text: str, min_len: int, max_len: int):
    hf_token = os.getenv("HF_API_TOKEN")

    headers = {
        "Content-Type": "application/json"
    }

    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"

    payload = {
        "inputs": text,
        "parameters": {
            "min_length": min_len,
            "max_length": max_len,
            "do_sample": False
        }
    }

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(
            f"{HF_API_BASE}/{model}",
            headers=headers,
            json=payload,
        )

    # Handle errors cleanly
    if resp.status_code != 200:
        try:
            error_data = resp.json()
            detail = error_data.get(
                "error",
                f"HuggingFace returned HTTP {resp.status_code}"
            )
        except Exception:
            detail = resp.text

        raise HTTPException(
            status_code=resp.status_code,
            detail=detail
        )

    # Parse successful response
    try:
        data = resp.json()

        if isinstance(data, list) and len(data) > 0:
            return data[0]["summary_text"]

        elif isinstance(data, dict):
            if "summary_text" in data:
                return data["summary_text"]

            if "error" in data:
                raise HTTPException(
                    status_code=500,
                    detail=data["error"]
                )

        raise HTTPException(
            status_code=500,
            detail=f"Unexpected HuggingFace response: {data}"
        )

    except HTTPException:
        raise  # don't swallow intentional HTTP errors
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse HuggingFace response: {str(e)}"
        )
