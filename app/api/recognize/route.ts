import { env } from 'cloudflare:workers';
import { handleRecognitionRequest } from '../../../lib/recognition.ts';
import type { RecognitionEnvironment } from '../../../lib/recognition.ts';

export async function POST(request: Request) {
  return handleRecognitionRequest(request, env as RecognitionEnvironment);
}
