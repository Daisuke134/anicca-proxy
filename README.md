# ANICCA Proxy Server

Proxy server for ANICCA AI Screen Narrator to securely handle Gemini API requests.

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env.local` file with your Gemini API key:
   ```
   GEMINI_API_KEY=your_actual_api_key_here
   ```

4. Run locally:
   ```bash
   npm run dev
   ```

## Deployment

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

3. Set environment variable in Vercel dashboard:
   - Go to Settings > Environment Variables
   - Add `GEMINI_API_KEY` with your actual key

## API Endpoints

### POST /api/gemini
Proxies requests to Gemini API.

Request body:
```json
{
  "endpoint": "/models/gemini-2.0-flash:generateContent",
  "data": {
    "contents": [...]
  }
}
```

## Security

- API key is stored only in Vercel environment variables
- CORS is configured to accept requests from any origin (adjust for production)
- All requests are logged for monitoring