"""
MStreamParserWeb — Blender add-on
==================================================================
Fills one of your saved SVG templates with your live music data on the server,
downloads it as a PNG, and refreshes the image your material already uses.

INSTALL
  Preferences ▸ Get Extensions ▸ ▾ ▸ Install from Disk…  (pick this folder
  zipped, or drop the folder into your extensions directory).

SETUP (once)
  Preferences ▸ Add-ons ▸ Music Streaming Tools ▸ expand:
    Server   — e.g. https://m1999-tools.de (or http://127.0.0.1:3000 locally)
    API key  — create one at <site>/account
  The key is stored in Blender's preferences, NOT in the .blend, so sharing a
  scene never leaks it.

USE  (3D Viewport ▸ N-panel ▸ Music Streaming Tools tab)
  1. Refresh (↻) to load your library. It browses like a file explorer:
     folders collapse, the funnel icon searches by name, and the dropdown
     narrows the list to one mode. Pick a template (not a folder).
  2. Pick the Image datablock your material already uses as the texture.
  3. Process Texture — downloads and reloads it in place.
  Optionally tick "Refresh before render" to have every F12 do step 3 first.

  There is no mode override: a template always renders in the mode it was
  saved with, exactly like the website. The mode dropdown only filters.

WHY PNG, NOT SVG
  Blender's SVG support imports curves, not image textures, so the server
  rasterizes for us (?format=png). Size caps the LONGEST side and never
  upscales past the template's natural resolution.
==================================================================
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

import bpy
from bpy.app.handlers import persistent
from bpy.props import (
    BoolProperty,
    CollectionProperty,
    EnumProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)
from bpy.types import AddonPreferences, Operator, Panel, PropertyGroup

# ---------------------------------------------------------------------------
# HTTP
#
# Blender ships Python without `requests`, and adding a wheel for one GET would
# be silly — urllib from the stdlib is enough. Every call passes an explicit
# timeout: a blocking request with no deadline freezes Blender's whole UI if the
# server is unreachable.
# ---------------------------------------------------------------------------


class ApiError(Exception):
    """An error whose message is already fit to show the user verbatim."""


def _prefs():
    return bpy.context.preferences.addons[__package__].preferences


def _request(path, *, expect_json):
    prefs = _prefs()
    base = prefs.server_url.strip().rstrip("/")
    key = prefs.api_key.strip()
    if not base:
        raise ApiError("Set the server URL in the add-on preferences.")
    if not key:
        raise ApiError("Set your API key in the add-on preferences.")

    req = urllib.request.Request(
        base + path,
        headers={"Authorization": "Bearer " + key},
    )
    try:
        with urllib.request.urlopen(req, timeout=prefs.timeout) as res:
            body = res.read()
    except urllib.error.HTTPError as err:
        raise ApiError(_http_message(err)) from err
    except urllib.error.URLError as err:
        # Covers DNS failures, refused connections and (via socket.timeout) a
        # server that accepted but never answered.
        raise ApiError("Could not reach {} ({}).".format(base, err.reason)) from err

    if not expect_json:
        return body
    try:
        return json.loads(body)
    except json.JSONDecodeError as err:
        raise ApiError("The server sent a malformed response.") from err


def _http_message(err):
    """Collapse our API's JSON error envelope into one readable line."""
    detail = ""
    code = ""
    try:
        payload = json.loads(err.read())
        detail = payload.get("error") or ""
        code = payload.get("code") or ""
    except Exception:
        pass  # non-JSON body (proxy error page, empty response, …)

    if err.code == 401:
        return detail or "API key rejected — check it in the add-on preferences."
    if err.code == 404:
        return detail or "That template no longer exists. Refresh the list."
    if err.code == 429:
        retry = err.headers.get("Retry-After") if err.headers else None
        return "Too many requests." + (" Retry in {}s.".format(retry) if retry else "")
    if err.code == 409:
        # 409 is the server's "you're connected but there's nothing to render"
        # or "your Spotify grant expired" case — both are actionable by the user.
        if code == "spotify_reauth_required":
            return (detail or "Spotify authorization expired.") + " Reconnect it on the website."
        return detail or "Nothing to render right now."
    return detail or "Server error {}.".format(err.code)


# ---------------------------------------------------------------------------
# Template library
#
# The server returns a flat list with a folder path per template. Blender has no
# public tree-view widget for add-ons, so we flatten the hierarchy depth-first
# into one collection and let the UIList indent it and hide collapsed branches.
# ---------------------------------------------------------------------------


def _tree_entries(rows):
    """Flattens the API's rows into a depth-first list of folder/template dicts.

    Folders come before files at each level, both alphabetical — i.e. what a file
    explorer shows.
    """
    root = {"folders": {}, "files": []}
    for row in rows:
        if not isinstance(row, dict) or row.get("id") is None:
            continue
        node = root
        for part in [p for p in (row.get("path") or "").split("/") if p]:
            node = node["folders"].setdefault(part, {"folders": {}, "files": []})
        node["files"].append(row)

    out = []

    def walk(node, depth, prefix):
        for name in sorted(node["folders"], key=str.lower):
            full = "{}/{}".format(prefix, name) if prefix else name
            out.append(
                {"kind": "FOLDER", "label": name, "depth": depth, "template_id": "", "mode": ""}
            )
            walk(node["folders"][name], depth + 1, full)
        for row in sorted(node["files"], key=lambda r: str(r.get("name") or "").lower()):
            out.append(
                {
                    "kind": "TEMPLATE",
                    "label": row.get("name") or "Untitled",
                    "depth": depth,
                    "template_id": str(row["id"]),
                    "mode": row.get("mode") or "",
                }
            )

    walk(root, 0, "")
    return out


def load_templates(settings):
    """Refills the browser from the server. Returns the number of templates."""
    rows = _request("/api/v1/templates", expect_json=True)
    if not isinstance(rows, list):
        raise ApiError("The server sent an unexpected template list.")

    entries = _tree_entries(rows)
    settings.entries.clear()
    for entry in entries:
        item = settings.entries.add()
        item.kind = entry["kind"]
        item.label = entry["label"]
        item.depth = entry["depth"]
        item.template_id = entry["template_id"]
        item.mode = entry["mode"]
        item.expanded = True  # start fully open; collapsing is the exception

    settings.active_index = next(
        (i for i, e in enumerate(entries) if e["kind"] == "TEMPLATE"), 0
    )
    return sum(1 for e in entries if e["kind"] == "TEMPLATE")


def active_template(settings):
    """The selected entry if it is a template, else None (folders aren't valid)."""
    index = settings.active_index
    if 0 <= index < len(settings.entries):
        entry = settings.entries[index]
        if entry.kind == "TEMPLATE":
            return entry
    return None


# ---------------------------------------------------------------------------
# The actual work — shared by the button and the pre-render handler so the two
# can never drift apart (the 3ds Max version needed an .ini to stay in sync;
# here both callers read the same scene properties).
# ---------------------------------------------------------------------------


def _destination_for(image):
    """Where to write the PNG for `image`.

    Overwrites the file the image already points at, so the .blend's references
    are untouched. Packed or generated images own no file, so those fall back to
    a persistent per-user cache path and get repointed once.
    """
    existing = image.filepath_raw or image.filepath
    if existing:
        return bpy.path.abspath(existing), False
    cache_dir = bpy.utils.extension_path_user(__package__, path="cache", create=True)
    safe = bpy.path.clean_name(image.name) or "texture"
    return os.path.join(cache_dir, safe + ".png"), True


def fetch_and_apply(settings):
    """Downloads the filled template and reloads it into `settings.target_image`.

    Raises ApiError with a user-facing message. Returns the path written.
    """
    image = settings.target_image
    if image is None:
        raise ApiError("Pick the image to replace first.")
    if image.source == "MOVIE" or image.type in {"MULTILAYER", "RENDER_RESULT"}:
        raise ApiError("Pick a still image texture, not a movie or render result.")

    entry = active_template(settings)
    if entry is None:
        raise ApiError("Select a template in the library (not a folder).")

    # No mode override: each template renders in the mode it was saved with, so
    # the panel's mode control filters the library rather than changing output.
    query = {"format": "png"}
    if settings.size != "0":
        query["size"] = settings.size

    png = _request(
        "/api/v1/render/{}?{}".format(
            urllib.parse.quote(entry.template_id), urllib.parse.urlencode(query)
        ),
        expect_json=False,
    )
    # Cheap sanity check: a proxy login page would otherwise be written straight
    # over a working texture.
    if not png.startswith(b"\x89PNG"):
        raise ApiError("The server did not return a PNG.")

    dest, repointed = _destination_for(image)
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)

    # Write beside the target then rename: a half-written download must never
    # replace a good texture, and Blender may still hold the old file open.
    staging = dest + ".part"
    try:
        with open(staging, "wb") as handle:
            handle.write(png)
        os.replace(staging, dest)
    except OSError as err:
        for leftover in (staging,):
            try:
                os.remove(leftover)
            except OSError:
                pass
        raise ApiError("Could not write {} ({}).".format(dest, err.strerror or err)) from err

    if repointed:
        image.filepath = dest
    image.reload()
    return dest


def _redraw_everything():
    """Nudge the viewport/image editors so the new pixels show up immediately."""
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type in {"VIEW_3D", "IMAGE_EDITOR", "NODE_EDITOR", "PROPERTIES"}:
                area.tag_redraw()


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------

# Filters the library by the mode each template was saved with. It does NOT
# change what the server renders — a template always renders in its own mode.
MODE_FILTER_ITEMS = [
    ("ALL", "All modes", "Show every template"),
    ("current-song", "Current song", "Only templates saved as current-song"),
    ("queue", "Queue", "Only templates saved as queue"),
    ("playlist", "Playlist", "Only templates saved as playlist"),
]

SIZE_ITEMS = [
    ("0", "Original", "The template's natural resolution"),
    ("1024", "1K", "Longest side 1024 px"),
    ("2048", "2K", "Longest side 2048 px"),
    ("4096", "4K", "Longest side 4096 px"),
    ("8192", "8K", "Longest side 8192 px"),
]


class MSPTemplateEntry(PropertyGroup):
    """One row of the library browser: a folder, or a template inside one."""

    kind: EnumProperty(
        items=[("FOLDER", "Folder", ""), ("TEMPLATE", "Template", "")],
        default="TEMPLATE",
    )
    label: StringProperty(default="")
    depth: IntProperty(default=0)
    template_id: StringProperty(default="")
    mode: StringProperty(default="")
    expanded: BoolProperty(
        name="Expanded",
        description="Show this folder's contents",
        default=True,
    )


class MSP_UL_templates(bpy.types.UIList):
    """Library browser. Indents by depth, hides collapsed branches, and filters
    by the mode a template was saved with."""

    def draw_item(
        self, _context, layout, _data, item, _icon, _active_data, _active_prop, _index
    ):
        row = layout.row(align=True)
        # Blender has no per-row indent, so pad with blank icons to fake depth.
        for _ in range(item.depth):
            row.label(text="", icon="BLANK1")

        if item.kind == "FOLDER":
            row.prop(
                item,
                "expanded",
                text="",
                emboss=False,
                icon="DISCLOSURE_TRI_DOWN" if item.expanded else "DISCLOSURE_TRI_RIGHT",
            )
            row.label(text=item.label, icon="FILE_FOLDER")
        else:
            row.label(text=item.label, icon="FILE_IMAGE")
            if item.mode:
                tail = row.row()
                tail.alignment = "RIGHT"
                tail.enabled = False
                tail.label(text=item.mode)

    def filter_items(self, context, data, propname):
        items = getattr(data, propname)
        count = len(items)
        settings = context.scene.msp
        wanted = settings.mode_filter
        needle = (self.filter_name or "").lower()
        flag = self.bitflag_filter_item

        # 1) Which templates survive the mode filter and the search box.
        passes = [False] * count
        for i, item in enumerate(items):
            if item.kind != "TEMPLATE":
                continue
            if wanted != "ALL" and item.mode != wanted:
                continue
            if needle and needle not in item.label.lower():
                continue
            passes[i] = True

        # 2) A folder is relevant only if something under it survived, so an empty
        #    folder disappears instead of dangling with nothing inside.
        for i, item in enumerate(items):
            if item.kind != "FOLDER":
                continue
            for j in range(i + 1, count):
                if items[j].depth <= item.depth:
                    break
                if items[j].kind == "TEMPLATE" and passes[j]:
                    passes[i] = True
                    break

        # 3) Apply collapse last. While searching we ignore it — hiding a match
        #    inside a closed folder would look like the search found nothing.
        flags = [0] * count
        collapsed_depth = -1
        for i, item in enumerate(items):
            if not needle and collapsed_depth >= 0:
                if item.depth > collapsed_depth:
                    continue
                collapsed_depth = -1
            if passes[i]:
                flags[i] = flag
            if item.kind == "FOLDER" and not item.expanded:
                collapsed_depth = item.depth

        return flags, []


class MSPSettings(PropertyGroup):
    entries: CollectionProperty(type=MSPTemplateEntry)
    active_index: IntProperty(default=0)
    mode_filter: EnumProperty(
        name="Show",
        description="Filter the library by the mode each template was saved with",
        items=MODE_FILTER_ITEMS,
        default="ALL",
    )
    size: EnumProperty(name="Size", items=SIZE_ITEMS, default="0")
    target_image: PointerProperty(
        name="Texture",
        description="The image datablock your material uses. Its file is overwritten in place",
        type=bpy.types.Image,
    )
    auto_refresh: BoolProperty(
        name="Refresh before render",
        description=(
            "Fetch a fresh texture before every render. Failures are logged and "
            "never abort the render — it just uses the previous texture"
        ),
        default=False,
    )
    status: StringProperty(name="Status", default="")


class MSPPreferences(AddonPreferences):
    bl_idname = __package__

    server_url: StringProperty(
        name="Server",
        description="Base URL of your MStreamParserWeb instance",
        default="https://m1999-tools.de/",
    )
    api_key: StringProperty(
        name="API key",
        description="Create one at <site>/account. Stored in Blender preferences, not in the .blend",
        default="",
        subtype="PASSWORD",
    )
    timeout: IntProperty(
        name="Timeout (s)",
        description="How long to wait for the server before giving up",
        default=15,
        min=3,
        max=120,
    )

    def draw(self, _context):
        layout = self.layout
        layout.prop(self, "server_url")
        layout.prop(self, "api_key")
        layout.prop(self, "timeout")
        layout.operator(MSP_OT_test_connection.bl_idname, icon="LINKED")


# ---------------------------------------------------------------------------
# Operators
# ---------------------------------------------------------------------------


class MSP_OT_test_connection(Operator):
    bl_idname = "msp.test_connection"
    bl_label = "Test Connection"
    bl_description = "Check the server URL and API key"

    def execute(self, _context):
        try:
            who = _request("/api/v1/whoami", expect_json=True)
        except ApiError as err:
            self.report({"ERROR"}, str(err))
            return {"CANCELLED"}
        self.report({"INFO"}, "Connected as {}".format(who.get("username", "?")))
        return {"FINISHED"}


class MSP_OT_refresh_templates(Operator):
    bl_idname = "msp.refresh_templates"
    bl_label = "Refresh Templates"
    bl_description = "Reload your template library from the server"

    def execute(self, context):
        settings = context.scene.msp
        try:
            count = load_templates(settings)
        except ApiError as err:
            settings.status = str(err)
            self.report({"ERROR"}, str(err))
            return {"CANCELLED"}
        settings.status = "{} template(s) loaded".format(count)
        self.report({"INFO"}, settings.status)
        return {"FINISHED"}


class MSP_OT_process_texture(Operator):
    bl_idname = "msp.process_texture"
    bl_label = "Process Texture"
    bl_description = "Render the template with your live music data and reload the texture"

    def execute(self, context):
        settings = context.scene.msp
        try:
            written = fetch_and_apply(settings)
        except ApiError as err:
            settings.status = str(err)
            self.report({"ERROR"}, str(err))
            return {"CANCELLED"}
        _redraw_everything()
        settings.status = "Updated {}".format(os.path.basename(written))
        self.report({"INFO"}, "Texture updated: {}".format(written))
        return {"FINISHED"}


# ---------------------------------------------------------------------------
# Panel
# ---------------------------------------------------------------------------


class MSP_PT_main(Panel):
    bl_label = "SVG Texture Labs"
    bl_idname = "MSP_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Music Streaming Tools"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.msp

        # --- Library ---
        box = layout.box()
        header = box.row(align=True)
        header.label(text="Library", icon="OUTLINER")
        header.operator(MSP_OT_refresh_templates.bl_idname, text="", icon="FILE_REFRESH")
        box.prop(settings, "mode_filter", text="")
        box.template_list(
            "MSP_UL_templates",
            "",
            settings,
            "entries",
            settings,
            "active_index",
            rows=8,
        )
        if not len(settings.entries):
            note = box.row()
            note.enabled = False
            note.label(text="Refresh to load your templates")

        # --- Target ---
        box = layout.box()
        box.label(text="Texture", icon="IMAGE_DATA")
        box.prop(settings, "target_image", text="")
        if settings.target_image is not None:
            path = settings.target_image.filepath_raw or settings.target_image.filepath
            row = box.row()
            row.enabled = False
            row.label(text=path or "no file — a cache copy will be used", icon="FILE_IMAGE")
        box.prop(settings, "size")

        selected = active_template(settings)
        run = layout.column()
        run.scale_y = 1.5
        run.enabled = selected is not None and settings.target_image is not None
        run.operator(MSP_OT_process_texture.bl_idname, icon="PLAY")

        layout.prop(settings, "auto_refresh")

        if settings.status:
            layout.separator()
            row = layout.row()
            row.enabled = False
            row.label(text=settings.status)


# ---------------------------------------------------------------------------
# Pre-render handler
#
# Registered once for the add-on's lifetime and gated on the checkbox, rather
# than added/removed as the toggle flips — that pattern leaks duplicate handlers
# the moment anything gets out of step.
# ---------------------------------------------------------------------------


@persistent
def _on_render_pre(scene, *_args):
    settings = getattr(scene, "msp", None)
    if settings is None or not settings.auto_refresh:
        return
    try:
        written = fetch_and_apply(settings)
        print("[MStreamParser] pre-render texture updated: {}".format(written))
    except Exception as err:
        # Never abort a render because the music texture could not refresh —
        # same call the 3ds Max hook makes: log it, render with what's there.
        print("[MStreamParser] pre-render refresh failed: {}".format(err))


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

# MSPTemplateEntry must register before MSPSettings, which holds a
# CollectionProperty of it.
_CLASSES = (
    MSP_OT_test_connection,
    MSP_OT_refresh_templates,
    MSP_OT_process_texture,
    MSPTemplateEntry,
    MSP_UL_templates,
    MSPSettings,
    MSPPreferences,
    MSP_PT_main,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.msp = PointerProperty(type=MSPSettings)
    if _on_render_pre not in bpy.app.handlers.render_pre:
        bpy.app.handlers.render_pre.append(_on_render_pre)


def unregister():
    if _on_render_pre in bpy.app.handlers.render_pre:
        bpy.app.handlers.render_pre.remove(_on_render_pre)
    del bpy.types.Scene.msp
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
