/*
  MStreamParserWeb — 3ds Max control panel
  ------------------------------------------------------------------
  Open: Scripting -> Run Script -> pick this file (a dialog appears).

  - Enter your Server + API key, hit "Refresh template list".
    The dropdown shows the folder hierarchy as  Folder/Sub/Name [mode].
  - Pick a Template + PNG size, set the Output path
    (your material's Bitmap should point at that same path).
  - "Fetch & Apply now"      -> downloads + refreshes the texture immediately.
  - "Save as render default" -> stores the choice (plugcfg/MStreamParser.ini)
                                so the pre-render hook can use it.

  Mode is not chosen here — each template renders in its own saved mode.
  PNG size scales the LONGEST side; it never upscales past the template's
  natural size (Original = natural size). Settings persist between sessions.
  ------------------------------------------------------------------
*/
(
    global MStreamParserPanel
    try (destroyDialog MStreamParserPanel) catch ()

    rollout MStreamParserPanel "MStreamParser - Music Display" width:340
    (
        local iniFile = (getDir #plugcfg) + "\\MStreamParser.ini"
        local templateIds = #()               -- parallel to ddTemplate.items
        local sizePx = #(0, 1024, 2048, 4096, 8192)  -- parallel to ddSize.items (0 = Original)

        group "Connection" (
            edittext etServer "Server" text:"http://127.0.0.1:3000" labelOnTop:true width:320
            edittext etKey    "API key" text:"" labelOnTop:true width:320
            button   btnList  "Refresh template list" width:320
        )

        group "Selection" (
            dropdownlist ddTemplate "Template" width:320
            dropdownlist ddSize "PNG size (longest side)" items:#("Original", "1K", "2K", "4K", "8K") width:150 align:#left
            edittext etOutput "Output PNG path" text:"C:/temp/output.png" labelOnTop:true width:320
        )

        button btnApply "Fetch & Apply now" width:320 height:30
        button btnSave  "Save as render default" width:320
        label  lblStatus "Ready" width:320 align:#left

        -- Build an authenticated .NET WebClient.
        fn newClient = (
            (dotNetClass "System.Net.ServicePointManager").SecurityProtocol = (dotNetClass "System.Net.SecurityProtocolType").Tls12
            local wc = dotNetObject "System.Net.WebClient"
            wc.Headers.Add "Authorization" ("Bearer " + etKey.text)
            wc
        )

        fn renderUrl = (
            local id = templateIds[ddTemplate.selection]
            local u = etServer.text + "/api/v1/render/" + (id as string) + "?format=png"
            local sz = sizePx[ddSize.selection]
            if sz > 0 do u = u + "&size=" + (sz as string)
            u
        )

        fn doRefresh = (
            try (
                local wc = newClient()
                local txt = wc.DownloadString (etServer.text + "/api/v1/templates?format=text")
                wc.Dispose()
                local names = #()
                templateIds = #()
                for ln in (filterString txt "\n\r") do (
                    local p = filterString ln "\t"
                    if p.count >= 2 do (
                        append templateIds (p[1] as integer)
                        append names (p[2] + (if p.count >= 3 then (" [" + p[3] + "]") else ""))
                    )
                )
                ddTemplate.items = names
                lblStatus.text = (names.count as string) + " templates loaded"
            ) catch ( lblStatus.text = "List failed: " + (getCurrentException()) )
        )

        on btnList pressed do doRefresh()

        on btnApply pressed do (
            if templateIds.count == 0 or ddTemplate.selection == 0 then
                lblStatus.text = "Refresh + pick a template first"
            else try (
                local wc = newClient()
                wc.DownloadFile (renderUrl()) etOutput.text
                wc.Dispose()
                freeSceneBitmaps()      -- drop cached bitmaps so the new PNG loads
                completeRedraw()        -- update the viewport now
                lblStatus.text = "Applied -> " + etOutput.text
            ) catch ( lblStatus.text = "Apply failed: " + (getCurrentException()) )
        )

        on btnSave pressed do (
            if templateIds.count == 0 or ddTemplate.selection == 0 then
                lblStatus.text = "Refresh + pick a template first"
            else (
                setINISetting iniFile "config" "serverBase" etServer.text
                setINISetting iniFile "config" "apiKey"     etKey.text
                setINISetting iniFile "config" "templateId" (templateIds[ddTemplate.selection] as string)
                setINISetting iniFile "config" "size"       (sizePx[ddSize.selection] as string)
                setINISetting iniFile "config" "outputPath" etOutput.text
                lblStatus.text = "Saved render default (template " + (templateIds[ddTemplate.selection] as string) + ")"
            )
        )

        on MStreamParserPanel open do (
            local s = getINISetting iniFile "config" "serverBase"
            if s != "" do etServer.text = s
            local k = getINISetting iniFile "config" "apiKey"
            if k != "" do etKey.text = k
            local o = getINISetting iniFile "config" "outputPath"
            if o != "" do etOutput.text = o
            local w = getINISetting iniFile "config" "size"
            if w != "" do (
                local idx = findItem sizePx (w as integer)
                if idx > 0 do ddSize.selection = idx
            )
        )
    )

    createDialog MStreamParserPanel
)
