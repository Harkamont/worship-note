import { env } from 'cloudflare:workers';
import { handleAnnotationRequest } from '../../../lib/recognition.ts';
import type { RecognitionEnvironment } from '../../../lib/recognition.ts';

export async function POST(request: Request) {
  return handleAnnotationRequest(request, env as RecognitionEnvironment);
}
