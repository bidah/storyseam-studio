// A bash snippet the Daytona sandboxes source to push an output file back to R2
// through the Worker — single PUT to /ingest for ≤90MB, chunked multipart to
// /ingest-mpu for larger (the Worker request body cap is 100MB). Requires `jq`
// and `curl` in the sandbox image. Reference `$BASE` (WORKER_PUBLIC_URL) and
// `$TOKEN` (INGEST_TOKEN) — set them at the top of the job script.
export function uploadFnBash() {
  return [
    "upload_r2() {",
    '  local f="$1" key="$2" sz up parts n=1 dir p et',
    '  sz=$(stat -c%s "$f")',
    "  if [ \"$sz\" -le 94371840 ]; then",
    '    curl -fsS -X PUT -H "authorization: Bearer $TOKEN" -T "$f" "$BASE/ingest/$key"',
    "  else",
    '    up=$(curl -fsS -X POST -H "authorization: Bearer $TOKEN" "$BASE/ingest-mpu/start?key=$key" | jq -r .uploadId)',
    '    dir=$(mktemp -d); split -b 90m "$f" "$dir/part_"; parts=""',
    '    for p in "$dir"/part_*; do',
    '      et=$(curl -fsS -X PUT -H "authorization: Bearer $TOKEN" -T "$p" "$BASE/ingest-mpu/part?key=$key&uploadId=$up&part=$n" | jq -r .etag)',
    '      [ -n "$parts" ] && parts="$parts,"; parts="$parts{\\"partNumber\\":$n,\\"etag\\":\\"$et\\"}"; n=$((n+1))',
    "    done",
    '    curl -fsS -X POST -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d "{\\"parts\\":[$parts]}" "$BASE/ingest-mpu/complete?key=$key&uploadId=$up"',
    '    rm -rf "$dir"',
    "  fi",
    "}",
  ].join("\n");
}
