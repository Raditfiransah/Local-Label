# Auto Labeler — Local AI

**Auto Labeler** is a local AI-powered web application for automatic labeling of large CSV datasets using LLMs (*Large Language Models*) running on your own machine via **LM Studio** or **Ollama**.

---

## Problem

Manual data labeling for *supervised learning* is time-consuming, expensive, and labor-intensive. Data science teams often have to:

- Pay expensive cloud API costs (OpenAI, etc.) for thousands of rows of data.
- Manually split data into small batches due to model context window limitations.
- Handle errors one by one when the model fails to process specific rows.
- Lack a convenient interface to monitor progress or fix labeling results.

---

## Solution

Auto Labeler solves these problems with a **local, smart, and efficient** approach:

| Feature | Description |
|---|---|
| **Local AI** | Uses LM Studio / Ollama — no API costs, data stays secure on your machine. |
| **Batch Multi-Text** | Sends multiple texts in a single prompt → model returns a JSON array. |
| **Adaptive Batch** | Batch size automatically adjusts to average text length (30 / 15 / 8 / 4). |
| **Progressive Split** | If a batch fails, it splits progressively (20→10→5→2→1) with up to 5 retries. |
| **Parallel Workers** | Labeling runs concurrently with multiple workers via asyncio. |
| **Real-time SSE** | Progress streamed to the frontend via *Server-Sent Events* — instantly visible. |
| **Validation & Retry** | JSON output strictly validated; failed rows can be retried individually or in bulk. |
| **Export Filter** | Export results filtered by status and specific labels. |
| **Web UI** | React 19 + Vite + Tailwind — upload CSV, configure prompts, monitor progress, edit labels. |

### Architecture

```
┌──────────┐     HTTP/SSE      ┌────────────────┐     OpenAI API    ┌──────────────┐
│  React   │ ◄──────────────►  │  FastAPI       │ ◄──────────────►  │  LM Studio   │
│  Frontend│    localhost:5173 │  Backend       │   localhost:1234  │  / Ollama    │
└──────────┘                   │  localhost:8000│                   └──────────────┘
                               │  + SQLite      │
                               └────────────────┘
```

---

## Usage

### 1. Prerequisites

- Python 3.12+
- Node.js 18+
- LM Studio (https://lmstudio.ai) or Ollama with your desired model

**Install dependencies:**

```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate    # Windows
# source venv/bin/activate  # Linux
pip install -r requirements.txt

# Frontend
cd frontend
npm install

# Root scripts (optional)
npm install
```

### 2. Start LM Studio

1. Open LM Studio
2. Load a model (e.g., `qwen2.5-3b-instruct`)
3. Start the server on port `1234`
4. Verify the endpoint `http://localhost:1234/v1/chat/completions` is accessible

### 3. Run the Application

**Manually:**

```bash
# Terminal 1 - Backend
cd backend
venv\Scripts\activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev
```

**Auto (single command):**

```bash
# Windows
start-web.bat

# Linux
chmod +x start-web.sh
./start-web.sh
```

### 4. How to Use

1. Open `http://localhost:5173` in your browser
2. **Upload CSV** — select a CSV file (at least 1 text column)
3. **Configure** — select provider (`lm-studio`), enter base URL (`http://localhost:1234`), pick a model
4. **Write Prompt** — use `{text}` as placeholder for the text to be labeled
5. **Benchmark** (optional) — test model speed
6. **Start Labeling** — process begins, progress visible in real-time
7. **Review & Edit** — inspect results, manually edit labels if needed, retry failed rows
8. **Export** — download results as CSV

### 5. Tips

- Use a **non-reasoning model** (e.g., `qwen2.5-3b-instruct`) for maximum speed
- Clear and specific prompts produce more accurate labels
- For datasets >100 rows, a confirmation dialog will appear before labeling starts

---

## Credit

Built by **Radit Firansah** — [@Raditfiransah](https://github.com/Raditfiransah)

Powered by:

- **FastAPI** — modern, async Python backend
- **React 19 + Vite** — fast frontend with HMR
- **Tailwind CSS** — utility-first styling
- **TanStack Query** — state management & caching
- **SQLAlchemy + SQLite** — lightweight database, no setup required
- **LM Studio** — run LLMs locally with an OpenAI-compatible API
- **Ollama** — open-source alternative LLM runner
- **httpx** — async HTTP client for model communication

---

*Auto Labeler was built for internal use and released as an open-source project.*
