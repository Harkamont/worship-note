import { env } from 'cloudflare:workers';
import { handleMusicXMLRepairRequest, type RecognitionEnvironment } from '../../../lib/recognition.ts';
export async function POST(request: Request) { return handleMusicXMLRepairRequest(request, env as RecognitionEnvironment); }
