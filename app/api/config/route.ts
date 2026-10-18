import { env } from 'cloudflare:workers';
import { getPublicConfig, recognitionErrorResponse } from '../../../lib/recognition.ts';
import type { RecognitionEnvironment } from '../../../lib/recognition.ts';

export async function GET() {
  try {
    return Response.json(getPublicConfig(env as RecognitionEnvironment), {
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch (error) { return recognitionErrorResponse(error); }
}
