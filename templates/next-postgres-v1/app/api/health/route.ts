// Process health only. Runtime readiness additionally requires the separate DB probe.
export function GET() {
  return Response.json({ status: 'process-ready', provenance: 'platform-authored-template-candidate', database: 'not-probed' }, { headers: { 'cache-control': 'no-store' } })
}
