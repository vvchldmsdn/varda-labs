import {requireAlignedBackendSource} from '@/lib/shared-backend/selection';
import * as preserved from '@/app/api/investment-plans/route';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request: Request) { await requireAlignedBackendSource(); return preserved.GET(request); }
export async function POST(request: Request) { await requireAlignedBackendSource(); return preserved.POST(request); }
export async function DELETE(request: Request) { await requireAlignedBackendSource(); return preserved.DELETE(request); }
