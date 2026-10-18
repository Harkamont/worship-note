/** Replaced only in the installed local app; websites use browser storage. */
export async function handleLocalProject(request: Request): Promise<Response> {
  void request;
  return Response.json({ error: '설치형 앱 전용 저장소입니다.' }, {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
