/*
  MStreamParserWeb — 3ds Max pre-render hook
  ------------------------------------------------------------------
  Fetches a freshly rendered texture (current Spotify song -> filled
  template -> PNG) from the web API and refreshes the scene bitmaps,
  so pressing Render updates the music-display texture automatically.

  SETUP (once):
    1. Paste your API key below (create one at <site>/account).
       Keep your real key OUT of git — edit a LOCAL copy of this file.
    2. Set templateId + outputPath below.
    3. Point your material's Bitmap map at the SAME outputPath.
    4. Assign this file as the Pre-Render script:
         Render Setup -> Common -> Scripts -> Pre-Render -> this .ms
  ------------------------------------------------------------------
*/
(
    -- ===== CONFIG =====
    local serverBase = "http://127.0.0.1:3000"     -- local test; later "https://m1999-tools.de"
    local apiKey     = ""
    local templateId = 28
    local mode       = ""        -- "" = template's saved mode; or "current-song" / "queue" / "playlist"
    local pngSize    = 0      -- longest side in px; 0 = template's natural size (never upscales)
    local outputPath = "C:\DEV\PYTHON\DynamicMusicDisplay\output.png"  -- your material's Bitmap must point here

    -- ===== BUILD URL =====
    local url = serverBase + "/api/v1/render/" + (templateId as string) + "?format=png"
    if mode != "" do url = url + "&mode=" + mode
    if pngSize > 0 do url = url + "&size=" + (pngSize as string)

    try (
        -- Allow modern TLS (needed once you switch to https://). Harmless on http.
        local spm = dotNetClass "System.Net.ServicePointManager"
        spm.SecurityProtocol = (dotNetClass "System.Net.SecurityProtocolType").Tls12

        local wc = dotNetObject "System.Net.WebClient"
        wc.Headers.Add "Authorization" ("Bearer " + apiKey)
        wc.DownloadFile url outputPath
        wc.Dispose()

        -- Drop cached bitmaps so the render reloads the new PNG from disk.
        freeSceneBitmaps()

        format "[MStreamParser] texture updated: %\n" outputPath
    )
    catch (
        -- Swallow errors (e.g. nothing playing -> 409, server down) so the
        -- render still proceeds with the previous texture.
        format "[MStreamParser] update FAILED: %\n" (getCurrentException())
    )
)
