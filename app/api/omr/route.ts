import { env } from 'cloudflare:workers';
import { getOmrConfig, handleOmrRequest } from '../../../lib/omr.ts';
import type { OmrEnvironment } from '../../../lib/omr.ts';

export async function GET() {
  return Response.json(getOmrConfig(env as OmrEnvironment), {headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export async function POST(request: Request) { return handleOmrRequest(request,env as OmrEnvironment); }
