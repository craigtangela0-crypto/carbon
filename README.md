<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1hYls_l_GFeJPcAPO3BcgArBmqG3PaRcI

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Provide `OPEN_API_KEY` for the backend (Cloud Run/runtime env).
   - Option A (local file): copy `.env.example` to `.env.local` and fill `OPEN_API_KEY`
   - PowerShell: `$env:OPEN_API_KEY="YOUR_KEY_HERE"`
3. Run the app (starts both backend + Vite):
   `npm run dev`

## Cloud Run

- This repo includes a `Dockerfile` that builds the Vite app and runs an Express backend on `PORT` (default `8080`).
- Required env var: `OPEN_API_KEY`
- Optional env vars:
  - `OPENAI_TEXT_MODEL` (default `gpt-5.2`)
  - `OPENAI_IMAGE_MODEL` (default `gpt-image-1.5`)
