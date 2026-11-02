-- cobalt system Hyprland config (ships with the image, read-only).
--
-- Personal changes go in ~/.config/cobalt/hyprland.lua, which is loaded at the
-- end of this file, so anything set there overrides these defaults. Image
-- updates keep improving the defaults without touching your file.
--
-- Reference: https://wiki.hypr.land/configuring/ and the API stubs in
-- /usr/share/hypr/stubs/hl.meta.lua


------------------
---- MONITORS ----
------------------

hl.monitor({
    output   = "",
    mode     = "preferred",
    position = "auto",
    scale    = "auto",
})


-- Running in the dev VM (QEMU/virgl)? Some defaults below differ there.
local function is_vm()
    local f = io.open("/sys/class/dmi/id/sys_vendor", "r")
    if not f then return false end
    local vendor = f:read("*l") or ""
    f:close()
    return vendor:match("QEMU") ~= nil
end
local in_vm = is_vm()


---------------------
---- PROGRAMS ----
---------------------

-- ghostty's OpenGL renderer garbles its output on virgl; use software GL in the VM
local terminal    = in_vm and "env LIBGL_ALWAYS_SOFTWARE=1 ghostty" or "ghostty"
local fileManager = "nautilus --new-window"
-- Activities overview and app grid (the AGS shell)
local overview    = "ags request -i cobalt overview"
local appGrid     = "ags request -i cobalt overview apps"
local lock        = "loginctl lock-session"
-- GNOME's Log Out dialog; quits directly if the shell isn't running
local logOut      = "ags request -i cobalt session logout || hyprctl dispatch 'hl.dsp.exit()'"


-------------------
---- AUTOSTART ----
-------------------

hl.on("hyprland.start", function()
    -- Give systemd user services and D-Bus activated apps (dbus-broker starts
    -- them through systemd) the session environment, then start the session
    -- services: shell, idle, wallpaper, polkit agent, clipboard history
    -- (cobalt-session.target). systemd restarts each one if it crashes.
    -- (dbus-update-activation-environment isn't in the image.)
    hl.exec_cmd("systemctl --user import-environment WAYLAND_DISPLAY DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE " ..
        "HYPRLAND_INSTANCE_SIGNATURE XCURSOR_THEME XCURSOR_SIZE HYPRCURSOR_SIZE QT_QPA_PLATFORM ELECTRON_OZONE_PLATFORM_HINT " ..
        "XDG_SESSION_CLASS XDG_SESSION_ID XDG_SESSION_DESKTOP SSH_AUTH_SOCK; " ..
        "systemctl --user start cobalt-session.target")
    -- Handy (speech-to-text) in the background; hold Alt+Space to dictate
    hl.exec_cmd("handy --start-hidden")
    if in_vm then
        hl.exec_cmd("/usr/libexec/cobalt/vm-session-fixes")
    end
end)


-------------------------------
---- ENVIRONMENT VARIABLES ----
-------------------------------

hl.env("XCURSOR_THEME", "Bibata-Modern-Ice")
hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")
hl.env("QT_QPA_PLATFORM", "wayland;xcb")
hl.env("ELECTRON_OZONE_PLATFORM_HINT", "auto")


-----------------------
---- LOOK AND FEEL ----
-----------------------

-- Adwaita: dark surfaces, the accent color (#3584e4 by default), soft shadows, rounded corners,
-- plus blur and springy animations.
hl.config({
    general = {
        gaps_in  = 4,
        gaps_out = 8,

        border_size = 2,

        col = {
            -- Blue until the shell applies the accent from Settings (lib/accent.ts)
            active_border   = "rgba(3584e4ee)",
            inactive_border = "rgba(ffffff14)",
        },

        resize_on_border = true,

        -- Games opt in to tearing through the window rules below
        allow_tearing = true,

        layout = "dwindle",
    },

    decoration = {
        rounding       = 12,
        rounding_power = 2,

        active_opacity   = 1.0,
        inactive_opacity = 1.0,

        shadow = {
            enabled      = true,
            range        = 18,
            render_power = 3,
            color        = 0x55000000,
            color_inactive = 0x33000000,
        },

        blur = {
            enabled  = true,
            size     = 8,
            passes   = 3,
            noise    = 0.02,
            contrast = 1.0,
            vibrancy = 0.2,
            popups   = true,
        },
    },

    animations = {
        enabled = true,
    },
})

hl.curve("easeOutQuint", { type = "bezier", points = { {0.23, 1},    {0.32, 1} } })
hl.curve("linear",       { type = "bezier", points = { {0, 0},       {1, 1}    } })
hl.curve("almostLinear", { type = "bezier", points = { {0.5, 0.5},   {0.75, 1} } })
hl.curve("quick",        { type = "bezier", points = { {0.15, 0},    {0.1, 1}  } })
hl.curve("easy",         { type = "spring", mass = 1, stiffness = 238.1191, damping = 24.21279333 })

hl.animation({ leaf = "global",        enabled = true, speed = 10,   bezier = "default" })
hl.animation({ leaf = "border",        enabled = true, speed = 5.39, bezier = "easeOutQuint" })
hl.animation({ leaf = "windows",       enabled = true, speed = 4.79, spring = "easy" })
hl.animation({ leaf = "windowsIn",     enabled = true, speed = 4.1,  spring = "easy",         style = "popin 90%" })
hl.animation({ leaf = "windowsOut",    enabled = true, speed = 1.49, bezier = "linear",       style = "popin 90%" })
hl.animation({ leaf = "fadeIn",        enabled = true, speed = 1.73, bezier = "almostLinear" })
hl.animation({ leaf = "fadeOut",       enabled = true, speed = 1.46, bezier = "almostLinear" })
hl.animation({ leaf = "fade",          enabled = true, speed = 3.03, bezier = "quick" })
hl.animation({ leaf = "layers",        enabled = true, speed = 3.81, bezier = "easeOutQuint" })
hl.animation({ leaf = "layersIn",      enabled = true, speed = 4,    bezier = "easeOutQuint", style = "fade" })
hl.animation({ leaf = "layersOut",     enabled = true, speed = 1.5,  bezier = "linear",       style = "fade" })
hl.animation({ leaf = "workspaces",    enabled = true, speed = 3,    bezier = "easeOutQuint", style = "slide" })
hl.animation({ leaf = "zoomFactor",    enabled = true, speed = 7,    bezier = "quick" })

hl.config({
    dwindle = {
        preserve_split = true,
    },
})


-----------------------
---- MISC / GAMING ----
-----------------------

hl.config({
    misc = {
        force_default_wallpaper = 0,
        disable_hyprland_logo   = true,
        disable_splash_rendering = true,
        -- Lua colors are 0xAARRGGBB; without the ff alpha it's transparent
        background_color        = 0xff1e1e1e,
        focus_on_activate       = true,
        -- Adaptive sync for fullscreen windows only (safe default on AMD)
        vrr                     = 2,
    },

    render = {
        -- Bypass composition for fullscreen windows marked as games
        direct_scanout = 2,
    },

    cursor = {
        -- The VM needs software cursors; real hardware uses "auto"
        no_hardware_cursors = in_vm and 1 or 2,
    },

    ecosystem = {
        no_update_news  = true,
        no_donation_nag = true,
    },
})


---------------
---- INPUT ----
---------------

hl.config({
    input = {
        kb_layout    = "us",
        follow_mouse = 1,
        sensitivity  = 0,

        touchpad = {
            natural_scroll = true,
        },
    },
})

hl.gesture({
    fingers   = 3,
    direction = "horizontal",
    action    = "workspace",
})


---------------------
---- KEYBINDINGS ----
---------------------

-- GNOME-flavored; see docs/BRIEF.md. Super alone opens the Activities overview.
-- `desc` is "Category: Label"; the shortcut cheat sheet (Super+/) is generated
-- from these, so every bind worth knowing gets one. Binds without desc (media
-- keys) are left off the sheet.
--
-- Settings > Keyboard > Shortcuts can change or disable the binds made with
-- bind() below: its changes are in ~/.config/cobalt/settings/binds.lua
-- ({ [id] = "KEYS" | false, custom = { {name, command, keys}, ... } }), read
-- here before binding. The registry (cobalt.binds) is written to
-- $XDG_RUNTIME_DIR/cobalt/binds.json for Settings, and cobalt.rebind() lets it
-- change a bind live through `hyprctl eval`.
local mainMod = "SUPER"

cobalt = { binds = {}, by_id = {}, custom = {} }
local shortcut_overrides = {}
do
    local config_home = os.getenv("XDG_CONFIG_HOME") or ((os.getenv("HOME") or "") .. "/.config")
    local ok, t = pcall(dofile, config_home .. "/cobalt/settings/binds.lua")
    if ok and type(t) == "table" then shortcut_overrides = t end
end

-- `name` is the label in Settings (desc is shared by grouped binds on the sheet)
local function bind(id, keys, action, opts)
    opts = opts or {}
    local hl_opts = {}
    for k, v in pairs(opts) do
        if k ~= "name" then hl_opts[k] = v end
    end
    local entry = { id = id, default = keys, keys = keys, action = action, opts = hl_opts, desc = opts.desc, name = opts.name }
    local override = shortcut_overrides[id]
    if override == false then
        entry.keys = nil
    elseif type(override) == "string" then
        entry.keys = override
    end
    cobalt.binds[#cobalt.binds + 1] = entry
    cobalt.by_id[id] = entry
    if entry.keys then hl.bind(entry.keys, action, hl_opts) end
end

local function json_string(v)
    return '"' .. tostring(v):gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"'
end

function cobalt.write_binds()
    local runtime = os.getenv("XDG_RUNTIME_DIR")
    if not runtime then return end
    os.execute("mkdir -p '" .. runtime .. "/cobalt'")
    local rows = {}
    for _, e in ipairs(cobalt.binds) do
        rows[#rows + 1] = string.format('{"id":%s,"desc":%s,"name":%s,"default":%s,"keys":%s}',
            json_string(e.id), json_string(e.desc or ""), json_string(e.name or ""),
            json_string(e.default), e.keys and json_string(e.keys) or "null")
    end
    local f = io.open(runtime .. "/cobalt/binds.json", "w")
    if f then
        f:write("[" .. table.concat(rows, ",") .. "]")
        f:close()
    end
end

-- Change a bind live (keys = false disables it)
function cobalt.rebind(id, keys)
    local e = cobalt.by_id[id]
    if not e then return end
    if e.keys then hl.unbind(e.keys) end
    e.keys = keys or nil
    if e.keys then hl.bind(e.keys, e.action, e.opts) end
    cobalt.write_binds()
end

-- Custom shortcuts (Settings > Keyboard > Shortcuts > Custom Shortcuts)
function cobalt.set_custom(list)
    for _, c in ipairs(cobalt.custom) do
        if c.keys and c.keys ~= "" then hl.unbind(c.keys) end
    end
    cobalt.custom = list or {}
    for _, c in ipairs(cobalt.custom) do
        if c.keys and c.keys ~= "" and c.command and c.command ~= "" then
            hl.bind(c.keys, hl.dsp.exec_cmd(c.command), { desc = "Custom Shortcuts: " .. (c.name or c.command) })
        end
    end
end

bind("overview", "SUPER + SUPER_L", hl.dsp.exec_cmd(overview), { release = true, desc = "System: Activities overview" })
bind("show-apps", mainMod .. " + A", hl.dsp.exec_cmd(appGrid), { desc = "System: Show apps" })
bind("terminal", mainMod .. " + Return", hl.dsp.exec_cmd(terminal), { desc = "Launchers: Terminal" })
bind("files", mainMod .. " + E", hl.dsp.exec_cmd(fileManager), { desc = "Launchers: Files" })
bind("settings", mainMod .. " + I", hl.dsp.exec_cmd("cobalt-settings"), { desc = "Launchers: Settings" })
bind("system-monitor", "CTRL + SHIFT + Escape", hl.dsp.exec_cmd("flatpak run io.missioncenter.MissionCenter"), { desc = "Launchers: System monitor" })
bind("notifications", mainMod .. " + V", hl.dsp.exec_cmd("ags request -i cobalt toggle date-menu"), { desc = "System: Notifications" })
bind("shortcuts", mainMod .. " + slash", hl.dsp.exec_cmd("ags request -i cobalt shortcuts"), { desc = "System: Keyboard shortcuts" })
bind("lock", mainMod .. " + L", hl.dsp.exec_cmd(lock), { desc = "System: Lock screen" })
bind("log-out", mainMod .. " + SHIFT + E", hl.dsp.exec_cmd(logOut), { desc = "System: Log out" })
bind("log-out-alt", "CTRL + ALT + Delete", hl.dsp.exec_cmd(logOut), { desc = "System: Log out", name = "Log out (alternative)" })
bind("switch-input-source", mainMod .. " + space", hl.dsp.exec_cmd("hyprctl switchxkblayout all next"), { desc = "Typing: Switch input source" })

-- Dictation with Handy: hold Alt+Space to record, release to transcribe into
-- the focused app. Handy's own shortcut is unreliable on Wayland, so Hyprland
-- toggles it on press and again on release (two binds, so not editable).
hl.bind("ALT + space", hl.dsp.exec_cmd("handy --toggle-transcription"), { desc = "System: Dictate (hold)" })
hl.bind("ALT + space", hl.dsp.exec_cmd("handy --toggle-transcription"), { release = true })

-- Screenshots (saved to ~/Pictures/Screenshots and copied)
-- Print opens the shell's screenshot UI (area selection if the shell is down)
bind("screenshot-ui", "Print", hl.dsp.exec_cmd("ags request -i cobalt screenshot || cobalt-screenshot area"), { desc = "Screenshots: Take a screenshot interactively" })
bind("screenshot-screen", "SHIFT + Print", hl.dsp.exec_cmd("cobalt-screenshot screen"), { desc = "Screenshots: Take a screenshot" })
bind("screenshot-window", "ALT + Print", hl.dsp.exec_cmd("cobalt-screenshot active"), { desc = "Screenshots: Take a screenshot of a window" })
bind("screencast", "CTRL + ALT + SHIFT + R", hl.dsp.exec_cmd("cobalt-screenrecord toggle"), { desc = "Screenshots: Record a screencast" })

bind("close", mainMod .. " + Q", hl.dsp.window.close(), { desc = "Windows: Close window" })
bind("close-alt", "ALT + F4", hl.dsp.window.close(), { desc = "Windows: Close window", name = "Close window (alternative)" })
bind("maximize", mainMod .. " + Up", hl.dsp.window.fullscreen({ mode = "maximized", action = "toggle" }), { desc = "Windows: Maximize" })
bind("fullscreen", mainMod .. " + SHIFT + F", hl.dsp.window.fullscreen({ mode = "fullscreen", action = "toggle" }), { desc = "Windows: Fullscreen" })
bind("float", mainMod .. " + F", hl.dsp.window.float({ action = "toggle" }), { desc = "Windows: Toggle floating" })
bind("toggle-split", mainMod .. " + J", hl.dsp.layout("togglesplit"), { desc = "Windows: Toggle split direction" })

-- Alt+Tab: GNOME's app switcher in the shell (switches when Alt is released);
-- cycles windows directly if the shell isn't running
local function switcher(cmd)
    return hl.dsp.exec_cmd("ags request -i cobalt switcher " .. cmd .. " || hyprctl dispatch 'hl.dsp.window.cycle_next()'")
end
bind("switch-apps", "ALT + Tab", switcher("next"), { desc = "Navigation: Switch apps" })
bind("switch-apps-backward", "ALT + SHIFT + Tab", switcher("prev"), { desc = "Navigation: Switch apps", name = "Switch apps backward" })
bind("switch-app-windows", mainMod .. " + grave", switcher("app-window"), { desc = "Navigation: Switch windows of an app" })

-- Focus and move windows (Super+Up is maximize, as in GNOME)
local directions = { { "Left", "left" }, { "Right", "right" }, { "Up", "up" }, { "Down", "down" } }
for _, d in ipairs(directions) do
    local key, dir = d[1], d[2]
    if key ~= "Up" then
        bind("focus-" .. dir, mainMod .. " + " .. key, hl.dsp.focus({ direction = dir }), { desc = "Navigation: Move focus", name = "Move focus " .. dir })
    end
    bind("move-" .. dir, mainMod .. " + SHIFT + " .. key, hl.dsp.window.move({ direction = dir }), { desc = "Windows: Move window", name = "Move window " .. dir })
end

-- Move/resize with Super + left/right drag (mouse binds aren't editable)
hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(),   { mouse = true, desc = "Windows: Move window" })
hl.bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), { mouse = true, desc = "Windows: Resize window" })

-- Workspaces: Super+1..9, Super+Page Up/Down, Super+scroll
for i = 1, 9 do
    bind("workspace-" .. i, mainMod .. " + " .. i, hl.dsp.focus({ workspace = i }), { desc = "Navigation: Go to workspace", name = "Switch to workspace " .. i })
    bind("move-to-workspace-" .. i, mainMod .. " + SHIFT + " .. i, hl.dsp.window.move({ workspace = i }), { desc = "Navigation: Move window to workspace", name = "Move window to workspace " .. i })
end
bind("workspace-previous", mainMod .. " + Page_Up", hl.dsp.focus({ workspace = "r-1" }), { desc = "Navigation: Previous workspace" })
bind("workspace-next", mainMod .. " + Page_Down", hl.dsp.focus({ workspace = "r+1" }), { desc = "Navigation: Next workspace" })
bind("move-to-workspace-previous", mainMod .. " + SHIFT + Page_Up", hl.dsp.window.move({ workspace = "r-1" }), { desc = "Navigation: Move window to previous workspace" })
bind("move-to-workspace-next", mainMod .. " + SHIFT + Page_Down", hl.dsp.window.move({ workspace = "r+1" }), { desc = "Navigation: Move window to next workspace" })
hl.bind(mainMod .. " + mouse_down", hl.dsp.focus({ workspace = "e+1" }), { desc = "Navigation: Scroll through workspaces" })
hl.bind(mainMod .. " + mouse_up",   hl.dsp.focus({ workspace = "e-1" }), { desc = "Navigation: Scroll through workspaces" })

cobalt.set_custom(shortcut_overrides.custom)
cobalt.write_binds()

-- Media and brightness keys
-- swayosd-client changes the value and shows SwayOSD's on-screen display
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("swayosd-client --output-volume raise"),      { locked = true, repeating = true })
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("swayosd-client --output-volume lower"),      { locked = true, repeating = true })
hl.bind("XF86AudioMute",        hl.dsp.exec_cmd("swayosd-client --output-volume mute-toggle"), { locked = true })
hl.bind("XF86AudioMicMute",     hl.dsp.exec_cmd("swayosd-client --input-volume mute-toggle"),  { locked = true })
hl.bind("XF86MonBrightnessUp",  hl.dsp.exec_cmd("swayosd-client --brightness raise"),         { locked = true, repeating = true })
hl.bind("XF86MonBrightnessDown",hl.dsp.exec_cmd("swayosd-client --brightness lower"),         { locked = true, repeating = true })
hl.bind("XF86PowerOff",         hl.dsp.exec_cmd("cobalt-power-button"),  { locked = true })
hl.bind("XF86AudioNext",        hl.dsp.exec_cmd("playerctl next"),       { locked = true })
hl.bind("XF86AudioPause",       hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPlay",        hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPrev",        hl.dsp.exec_cmd("playerctl previous"),   { locked = true })


--------------------------------
---- WINDOWS AND LAYERS ----
--------------------------------

hl.window_rule({
    name  = "suppress-maximize-events",
    match = { class = ".*" },
    suppress_event = "maximize",
})

hl.window_rule({
    -- Fix some dragging issues with XWayland
    name  = "fix-xwayland-drags",
    match = { class = "^$", title = "^$", xwayland = true, float = true, fullscreen = false, pin = false },
    no_focus = true,
})

-- Steam games (Proton and native): game content type for VRR/direct scanout,
-- tearing when fullscreen, and no idle lock while playing
hl.window_rule({
    name  = "steam-games",
    match = { class = "^steam_app_[0-9]+$" },
    content      = "game",
    immediate    = true,
    idle_inhibit = "fullscreen",
})

hl.window_rule({
    name  = "games-tear",
    match = { content = "game" },
    immediate    = true,
    idle_inhibit = "fullscreen",
})

hl.window_rule({
    name  = "video-no-idle",
    match = { content = "video" },
    idle_inhibit = "fullscreen",
})

-- Small utility windows float, GNOME-style
for _, class in ipairs({
    "^xdg-desktop-portal-gtk$",
    "^org.gnome.Calculator$",
    "^hyprland-run$",
}) do
    hl.window_rule({ match = { class = class }, float = true })
end

-- Settings opens as a floating, centered window like on GNOME
hl.window_rule({
    name  = "settings-float",
    match = { class = "^io.github.tduarte.cobalt.Settings$" },
    float = true,
    size = "980 720",
    center = true,
})

-- The screen-share picker is a dialog
hl.window_rule({
    name  = "share-picker-float",
    match = { class = "^io.github.tduarte.cobalt.SharePicker$" },
    float = true,
    size = "480 560",
    center = true,
})

-- Shell surfaces: blur behind the translucent bar, menus and the overview
hl.layer_rule({ name = "overview-blur", match = { namespace = "^cobalt-overview$" }, blur = true })
hl.layer_rule({ name = "menu-blur", match = { namespace = "^cobalt-menu$" }, blur = true, ignore_alpha = 0.2 })
hl.layer_rule({ name = "bar-blur", match = { namespace = "^cobalt-bar$" }, blur = true, blur_popups = true, ignore_alpha = 0.2 })
hl.layer_rule({ name = "notifications-blur", match = { namespace = "^cobalt-notifications$" }, blur = true, ignore_alpha = 0.2 })


--------------------------
---- SETTINGS APP FILES ----
--------------------------

-- The Settings app writes what it changes (displays, workspaces, input,
-- shortcuts) to ~/.config/cobalt/settings/<name>.lua and applies it live with
-- `hyprctl eval`; load them on start, before personal overrides.
do
    local config_home = os.getenv("XDG_CONFIG_HOME") or ((os.getenv("HOME") or "") .. "/.config")
    for _, name in ipairs({ "monitors", "workspaces", "input", "binds" }) do
        local path = config_home .. "/cobalt/settings/" .. name .. ".lua"
        local f = io.open(path, "r")
        if f then
            f:close()
            local ok, err = pcall(dofile, path)
            if not ok then print("cobalt: " .. path .. ": " .. tostring(err)) end
        end
    end
end


-----------------------
---- USER OVERRIDES ----
-----------------------

do
    local config_home = os.getenv("XDG_CONFIG_HOME") or ((os.getenv("HOME") or "") .. "/.config")
    local user_config = config_home .. "/cobalt/hyprland.lua"
    local f = io.open(user_config, "r")
    if f then
        f:close()
        dofile(user_config)
    end
end
