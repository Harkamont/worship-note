/** Web deployments do not expose local filesystem or credential settings. */
export async function handleLocalSettings(_request: Request): Promise<Response> {
  void _request;
  return Response.json({ error: '이 설정은 설치형 워십노트에서 사용할 수 있습니다.' }, {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
