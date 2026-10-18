import { handleLocalProject } from '@/lib/local-project-host';

export async function GET(request: Request) { return handleLocalProject(request); }
export async function PUT(request: Request) { return handleLocalProject(request); }
