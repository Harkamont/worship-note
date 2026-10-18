import { handleLocalSettings } from '@/lib/local-settings-host';

export async function GET(request: Request) { return handleLocalSettings(request); }
export async function POST(request: Request) { return handleLocalSettings(request); }
