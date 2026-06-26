# Auto Labeler — Local AI

**Auto Labeler** adalah aplikasi web berbasis AI lokal untuk melakukan labeling otomatis pada dataset CSV dalam jumlah besar (10.000+ baris) menggunakan LLM (*Large Language Model*) yang berjalan di mesin sendiri via **LM Studio** atau **Ollama**.

---

## Masalah

Labeling data secara manual untuk keperluan *supervised learning* memakan waktu, biaya, dan tenaga yang tidak sedikit. Tim *data science* sering harus:

- Membayar API cloud (OpenAI, dll.) yang mahal untuk ribuan baris data.
- Membagi data secara manual ke batch-batch kecil karena keterbatasan konteks model.
- Menangani error satu per satu saat model gagal memproses baris tertentu.
- Tidak memiliki antarmuka yang nyaman untuk memonitor progres atau memperbaiki hasil labeling.

---

## Solusi

Auto Labeler menyelesaikan masalah ini dengan pendekatan **lokal, cerdas, dan efisien**:

| Fitur | Deskripsi |
|---|---|
| **AI Lokal** | Menggunakan LM Studio / Ollama — tidak ada biaya API, data tetap aman di lokal. |
| **Batch Multi-Text** | Mengirim banyak teks dalam satu prompt → model mengembalikan JSON array. |
| **Adaptive Batch** | Ukuran batch otomatis menyesuaikan panjang rata-rata teks (30 / 15 / 8 / 4). |
| **Progressive Split** | Jika batch gagal, dibagi secara progresif (20→10→5→2→1) hingga 5× percobaan. |
| **Parallel Workers** | Labeling berjalan konkuren dengan beberapa worker via asyncio. |
| **Real-time SSE** | Progress dikirim ke frontend via *Server-Sent Events* — langsung terlihat. |
| **Validation & Retry** | Output JSON divalidasi ketat; baris gagal bisa diretry individu atau massal. |
| **Export Filter** | Ekspor hasil berdasarkan status dan label tertentu. |
| **Web UI** | React 19 + Vite + Tailwind — upload CSV, atur prompt, monitor progres, edit label. |

### Arsitektur

```
┌──────────┐     HTTP/SSE      ┌──────────────┐     OpenAI API     ┌────────────┐
│  React   │ ◄──────────────►  │  FastAPI      │ ◄──────────────►  │  LM Studio  │
│  Frontend │    localhost:5173 │  Backend      │   localhost:1234  │  / Ollama   │
└──────────┘                   │  localhost:8000│                   └────────────┘
                               │  + SQLite      │
                               └──────────────┘
```

---

## Cara Penggunaan

### 1. Persiapan

**Prasyarat:**

- Python 3.12+
- Node.js 18+
- LM Studio (https://lmstudio.ai) atau Ollama dengan model yang diinginkan

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

# Root scripts (opsional)
npm install
```

### 2. Jalankan LM Studio

1. Buka LM Studio
2. Load model (misal: `qwen2.5-3b-instruct`)
3. Start server pada port `1234`
4. Pastikan endpoint `http://localhost:1234/v1/chat/completions` bisa diakses

### 3. Jalankan Aplikasi

**Manual:**

```bash
# Terminal 1 - Backend
cd backend
venv\Scripts\activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev
```

**Auto (satu perintah):**

```bash
# Windows
start-web.bat

# Linux
chmod +x start-web.sh
./start-web.sh
```

### 4. Gunakan

1. Buka `http://localhost:5173` di browser
2. **Upload CSV** — pilih file CSV (minimal 1 kolom teks)
3. **Konfigurasi** — pilih provider (`lm-studio`), isi base URL (`http://localhost:1234`), pilih model
4. **Tulis Prompt** — gunakan `{text}` sebagai placeholder untuk teks yang akan dilabeli
5. **Benchmark** (opsional) — uji kecepatan model
6. **Start Labeling** — proses dimulai, progres terlihat real-time
7. **Review & Edit** — periksa hasil, edit label manual jika perlu, retry baris gagal
8. **Export** — unduh hasil sebagai CSV

### 5. Tips

- Gunakan **model non-reasoning** (misal: `qwen2.5-3b-instruct`) untuk kecepatan maksimal
- Prompt yang jelas dan spesifik menghasilkan label yang lebih akurat
- Untuk dataset >100 baris, konfirmasi akan muncul sebelum labeling dimulai

---

## Credit

Dibuat oleh **Radit** — [@anomalyco](https://github.com/anomalyco)

Teknologi yang digunakan:

- **FastAPI** — backend Python modern &异步
- **React 19 + Vite** — frontend cepat dengan HMR
- **Tailwind CSS** — styling utility-first
- **TanStack Query** — state management & caching
- **SQLAlchemy + SQLite** — database ringan tanpa setup
- **LM Studio** — menjalankan LLM lokal dengan API OpenAI-compatible
- **Ollama** — alternatif open-source LLM runner
- **httpx** — HTTP client async untuk komunikasi dengan model

---

*Auto Labeler dibuat untuk kebutuhan internal dan dirilis sebagai project open-source.*
