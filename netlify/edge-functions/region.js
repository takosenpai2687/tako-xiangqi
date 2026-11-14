export default function region(_request, context) {
  const country = context.geo?.country?.code ?? null;
  return Response.json({ country }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const config = { path: "/api/region" };
