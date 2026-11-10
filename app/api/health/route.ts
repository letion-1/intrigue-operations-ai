/** Liveness only. This endpoint does NOT imply that AI jobs are running. */
export async function GET(request: Request) {
  // Request header access prevents treating this as a static marketing asset.
  void request.headers.get('accept');
  return Response.json({ status: 'ok' }, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
