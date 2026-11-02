# SLTMobitel EasyApply Backend

This is the backend API service for the **SLTMobitel EasyApply** customer application portal, built using **Node.js**, **Express**, and **MongoDB**.

This service implements **Module 01: Authentication & User Management**.

---

## ❖ Prerequisites

Make sure you have the following installed on your machine:
* **Node.js** (v20 or higher recommended)
* **MongoDB** (Running locally, in Docker, or an active MongoDB Atlas cluster)

---

## ❖ Setup Instructions

### 1. Install Dependencies
Run the following command inside the `Easy-Apply-Backend` directory:
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root of `Easy-Apply-Backend` (use `.env.example` as a template):
```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/easyapply
JWT_ACCESS_SECRET=your_access_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_key_here
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

### 3. Run MongoDB in Docker (Optional)
If you have Docker installed and want to run a local database instance:
```bash
docker run -d -p 27017:27017 --name easyapply-db mongo:latest
```

### 4. Start Server
To start the server in development mode (with auto-reload on save):
```bash
npm run dev
```
The server will start running on `http://localhost:5000`.

## Audit logs

Successful authentication, user-management, KYC, application/request, form,
comment, and appointment actions are stored in the `audit_logs` MongoDB
collection. Administrators can retrieve them with:

```text
GET /api/admin/audit-logs?page=1&limit=25&search=REQ-1024&action=STATUS_UPDATE&module=Application&from=2026-01-01&to=2026-01-31
```

The endpoint requires an administrator Bearer token. `search`, `action`,
`module`, `from`/`startDate`, and `to`/`endDate` are optional; results are
sorted newest first and include pagination metadata.

## NIC OCR

`POST /api/ocr/scan-nic` (and `/api/nic/scan`) go through `services/ocr/nicScanService.js`.
Set `NIC_OCR_ENGINE` in `.env`:

| Value | Behaviour |
|---|---|
| `auto` (default) | Gemini Vision first; if it fails or reads no NIC number, the local PaddleOCR model runs |
| `local` | Local model only. Gemini is never called and no image leaves the server |
| `gemini` | Gemini only |

The response includes `engine` and, when the fallback ran, `fallbackReason`. The local model
(`services/ocr/paddleOcrService.js`, PP-OCRv6 small on ONNX Runtime) is loaded at server start and
downloaded once on first run (needs internet, then cached in `~/.cache/ppu-paddle-ocr`).

### Measuring accuracy

```bash
npm run ocr:eval -- <samples-dir> [--gemini]
```

`<samples-dir>` holds `<name>.front.jpg`, `<name>.back.jpg` and `<name>.json` (expected
`nicNumber`, `fullName`, `dob`, `gender`, `address`) per card. It prints per-field accuracy per
engine. Keep real NIC images outside git (an `ocr-eval/` folder is git-ignored). Run it before
and after any model or parser change; a larger labelled set is also the starting point if the
local model ever needs fine-tuning.
