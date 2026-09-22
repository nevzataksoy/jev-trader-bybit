#!/usr/bin/env bash
set +e

OUT="quality-output"
REPORT="$OUT/report.txt"
mkdir -p "$OUT"
: > "$REPORT"

run_check() {
  name="$1"
  shift
  {
    echo "===== $name ====="
    echo "$ $*"
  } >> "$REPORT"
  "$@" >> "$REPORT" 2>&1
  code=$?
  echo "__EXIT_CODE__=$code" >> "$REPORT"
  echo >> "$REPORT"
  return $code
}

run_check "lint" npm run lint
LINT_CODE=$?
run_check "typecheck" npm run typecheck
TYPECHECK_CODE=$?
run_check "test" npm run test
TEST_CODE=$?
run_check "build" npm run build
BUILD_CODE=$?

{
  echo "===== SUMMARY ====="
  echo "lint=$LINT_CODE"
  echo "typecheck=$TYPECHECK_CODE"
  echo "test=$TEST_CODE"
  echo "build=$BUILD_CODE"
} >> "$REPORT"

cat > "$OUT/index.html" <<'HTML'
<!doctype html>
<html><body><h1>Temporary Quality Report</h1><p><a href="/report.txt">Open report.txt</a></p></body></html>
HTML

# Always let the temporary preview deploy so the report can be inspected.
exit 0
