import { env } from 'cloudflare:workers';
import { getTextOcrConfig, handleTextOcrRequest } from '../../../lib/text-ocr.ts';
import type { TextOcrEnvironment } from '../../../lib/text-ocr.ts';

export async function GET() {
  return Response.json(await getTextOcrConfig(env as TextOcrEnvironment), {headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export async function POST(request: Request) { return handleTextOcrRequest(request,env as TextOcrEnvironment); }
