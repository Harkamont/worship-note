import { env } from 'cloudflare:workers';
import { handleXMLAnnotationRequest } from '../../../lib/recognition.ts';
import type { RecognitionEnvironment } from '../../../lib/recognition.ts';

export async function POST(request: Request) {
  return handleXMLAnnotationRequest(request, env as RecognitionEnvironment);
}
