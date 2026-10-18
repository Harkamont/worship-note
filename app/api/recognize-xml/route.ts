import { env } from 'cloudflare:workers';
import { handleMusicXMLRecognitionRequest } from '../../../lib/recognition.ts';
import type { RecognitionEnvironment } from '../../../lib/recognition.ts';

export async function POST(request: Request) {
  return handleMusicXMLRecognitionRequest(request, env as RecognitionEnvironment);
}
