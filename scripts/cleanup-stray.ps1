# Moves files that are NOT part of VSM Ops (left over from an older project) out of the folder.
# Nothing is deleted: they go to ..\vsm-stray-files so you can check them.
$out = "..\vsm-stray-files"; New-Item -ItemType Directory -Force $out | Out-Null
@("src\app\(app)\automations","src\app\(app)\documents","src\app\(app)\incidents","src\app\(app)\scholars",
  "src\app\(app)\settings\departments","src\app\(app)\settings\notifications","src\app\(app)\settings\organization",
  "src\app\(app)\settings\users","src\app\(app)\settings\page.tsx","supabase\functions") | ForEach-Object {
  if (Test-Path -LiteralPath $_) { Move-Item -LiteralPath $_ -Destination (Join-Path $out ($_ -replace '[\\()]','_')) -Force; "moved $_" } }
"Done. Now run: npm run typecheck ; npm run build"
