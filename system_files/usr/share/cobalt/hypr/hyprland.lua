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


-------------------
---- AUTOSTART ----
-------------------

hl.on("hyprland.start", function()
    -- Let systemd user services and D-Bus activated apps (portals, polkit agent)
    -- see the Wayland session
    hl.exec_cmd("dbus-update-activation-environment --systemd --all")
    hl.exec_cmd("systemctl --user start hyprpolkitagent")
    hl.exec_cmd("hypridle --config /usr/share/cobalt/hypr/hypridle.conf")
    hl.exec_cmd("wl-paste --watch cliphist store")
    -- Wallpaper (hyprpaper, following GNOME's background settings)
    hl.exec_cmd("cobalt-wallpaper")
    -- Top bar, menus and notifications (AGS, shell/ in the repo)
    hl.exec_cmd("cobalt-shell")
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

-- Adwaita: dark surfaces, blue accent (#3584e4), soft shadows, rounded corners,
-- plus blur and springy animations.
hl.config({
    general = {
        gaps_in  = 4,
        gaps_out = 8,

        border_size = 2,

        col = {
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
local mainMod = "SUPER"

hl.bind("SUPER + SUPER_L", hl.dsp.exec_cmd(overview), { release = true, desc = "System: Activities overview" })
hl.bind(mainMod .. " + A", hl.dsp.exec_cmd(appGrid), { desc = "System: Show apps" })
hl.bind(mainMod .. " + Return", hl.dsp.exec_cmd(terminal), { desc = "System: Terminal" })
hl.bind(mainMod .. " + E", hl.dsp.exec_cmd(fileManager), { desc = "System: Files" })
hl.bind(mainMod .. " + V", hl.dsp.exec_cmd("ags request -i cobalt toggle date-menu"), { desc = "System: Notifications" })
hl.bind(mainMod .. " + slash", hl.dsp.exec_cmd("ags request -i cobalt shortcuts"), { desc = "System: Keyboard shortcuts" })
hl.bind(mainMod .. " + L", hl.dsp.exec_cmd(lock), { desc = "System: Lock screen" })
hl.bind(mainMod .. " + SHIFT + E", hl.dsp.exit(), { desc = "System: Log out" })

-- Dictation with Handy: hold Alt+Space to record, release to transcribe into
-- the focused app. Handy's own shortcut is unreliable on Wayland, so Hyprland
-- toggles it on press and again on release.
hl.bind("ALT + space", hl.dsp.exec_cmd("handy --toggle-transcription"), { desc = "System: Dictate (hold)" })
hl.bind("ALT + space", hl.dsp.exec_cmd("handy --toggle-transcription"), { release = true })

-- Screenshots (saved to ~/Pictures/Screenshots and copied)
hl.bind("Print",         hl.dsp.exec_cmd("cobalt-screenshot area"),   { desc = "System: Screenshot area" })
hl.bind("SHIFT + Print", hl.dsp.exec_cmd("cobalt-screenshot screen"), { desc = "System: Screenshot screen" })

hl.bind(mainMod .. " + Q", hl.dsp.window.close(), { desc = "Windows: Close window" })
hl.bind("ALT + F4", hl.dsp.window.close(), { desc = "Windows: Close window" })
hl.bind(mainMod .. " + Up", hl.dsp.window.fullscreen({ mode = "maximized", action = "toggle" }), { desc = "Windows: Maximize" })
hl.bind(mainMod .. " + SHIFT + F", hl.dsp.window.fullscreen({ mode = "fullscreen", action = "toggle" }), { desc = "Windows: Fullscreen" })
hl.bind(mainMod .. " + F", hl.dsp.window.float({ action = "toggle" }), { desc = "Windows: Toggle floating" })
hl.bind(mainMod .. " + J", hl.dsp.layout("togglesplit"), { desc = "Windows: Toggle split direction" })

-- Alt+Tab cycles windows on the current workspace
hl.bind("ALT + Tab", function()
    hl.dispatch(hl.dsp.window.cycle_next())
    hl.dispatch(hl.dsp.window.bring_to_top())
end, { desc = "Windows: Switch windows" })

-- Focus and move windows (Super+Up is maximize, as in GNOME)
for key, dir in pairs({ Left = "left", Right = "right", Down = "down" }) do
    hl.bind(mainMod .. " + " .. key, hl.dsp.focus({ direction = dir }), { desc = "Windows: Move focus" })
end
for key, dir in pairs({ Left = "left", Right = "right", Up = "up", Down = "down" }) do
    hl.bind(mainMod .. " + SHIFT + " .. key, hl.dsp.window.move({ direction = dir }), { desc = "Windows: Move window" })
end

-- Move/resize with Super + left/right drag
hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(),   { mouse = true, desc = "Windows: Move window" })
hl.bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), { mouse = true, desc = "Windows: Resize window" })

-- Workspaces: Super+1..9, Super+Page Up/Down, Super+scroll
for i = 1, 9 do
    hl.bind(mainMod .. " + " .. i,          hl.dsp.focus({ workspace = i }),       { desc = "Workspaces: Go to workspace" })
    hl.bind(mainMod .. " + SHIFT + " .. i,  hl.dsp.window.move({ workspace = i }), { desc = "Workspaces: Move window to workspace" })
end
hl.bind(mainMod .. " + Page_Up",           hl.dsp.focus({ workspace = "r-1" }),       { desc = "Workspaces: Previous workspace" })
hl.bind(mainMod .. " + Page_Down",         hl.dsp.focus({ workspace = "r+1" }),       { desc = "Workspaces: Next workspace" })
hl.bind(mainMod .. " + SHIFT + Page_Up",   hl.dsp.window.move({ workspace = "r-1" }), { desc = "Workspaces: Move window to previous workspace" })
hl.bind(mainMod .. " + SHIFT + Page_Down", hl.dsp.window.move({ workspace = "r+1" }), { desc = "Workspaces: Move window to next workspace" })
hl.bind(mainMod .. " + mouse_down",        hl.dsp.focus({ workspace = "e+1" }),       { desc = "Workspaces: Scroll through workspaces" })
hl.bind(mainMod .. " + mouse_up",          hl.dsp.focus({ workspace = "e-1" }),       { desc = "Workspaces: Scroll through workspaces" })

-- Media and brightness keys
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+"), { locked = true, repeating = true })
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"),      { locked = true, repeating = true })
hl.bind("XF86AudioMute",        hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"),     { locked = true })
hl.bind("XF86AudioMicMute",     hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"),   { locked = true })
hl.bind("XF86MonBrightnessUp",  hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%+"),                  { locked = true, repeating = true })
hl.bind("XF86MonBrightnessDown",hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%-"),                  { locked = true, repeating = true })
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
    "^hyprpolkitagent$",
}) do
    hl.window_rule({ match = { class = class }, float = true })
end

-- Shell surfaces: blur behind the translucent bar, menus and the overview
hl.layer_rule({ name = "overview-blur", match = { namespace = "^cobalt-overview$" }, blur = true })
hl.layer_rule({ name = "menu-blur", match = { namespace = "^cobalt-menu$" }, blur = true, ignore_alpha = 0.2 })
hl.layer_rule({ name = "bar-blur", match = { namespace = "^cobalt-bar$" }, blur = true, blur_popups = true, ignore_alpha = 0.2 })
hl.layer_rule({ name = "notifications-blur", match = { namespace = "^cobalt-notifications$" }, blur = true, ignore_alpha = 0.2 })


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
