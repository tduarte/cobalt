import GLib from "gi://GLib"
import { createState } from "ags"
import { execAsync } from "ags/process"

// OS updates: rpm-ostreed-automatic stages new images in the background
// (AutomaticUpdatePolicy=stage), and any restart or power off finishes them.
// We watch for a staged deployment so the power menu can say "Restart &
// Update" and the user gets one "Update Ready" notification per version.

export type Pending = { version: string } | null

const [pending, setPending] = createState<Pending>(null)
export { pending }

const CHECK_SECONDS = 30 * 60
const stateFile = `${GLib.get_user_state_dir()}/cobalt/update-notified`

function lastNotified() {
  try {
    return new TextDecoder().decode(GLib.file_get_contents(stateFile)[1]).trim()
  } catch {
    return ""
  }
}

async function notify(version: string, onRestart: () => void) {
  if (lastNotified() === version) return
  GLib.mkdir_with_parents(GLib.path_get_dirname(stateFile), 0o755)
  GLib.file_set_contents(stateFile, version)
  try {
    const action = await execAsync([
      "notify-send",
      "--app-name=Software",
      "--app-icon=org.gnome.Software",
      "--hint=string:desktop-entry:org.gnome.Software",
      "--action=restart=Restart…",
      "Update Ready",
      `cobalt ${version} is ready to install. Restart to finish updating.`,
    ])
    if (action.trim() === "restart") onRestart()
  } catch (err) {
    console.error("update notification", err)
  }
}

export async function checkUpdates(onRestart: () => void) {
  try {
    const status = JSON.parse(await execAsync(["rpm-ostree", "status", "--json"]))
    const staged = (status.deployments ?? []).find((d: { staged?: boolean }) => d.staged)
    const next: Pending = staged ? { version: String(staged.version ?? "") } : null
    setPending(next)
    if (next) notify(next.version, onRestart)
  } catch {
    // Not an rpm-ostree system (dev runs), or the daemon is busy
  }
}

export function watchUpdates(onRestart: () => void) {
  if (!GLib.find_program_in_path("rpm-ostree")) return
  checkUpdates(onRestart)
  GLib.timeout_add_seconds(GLib.PRIORITY_LOW, CHECK_SECONDS, () => {
    checkUpdates(onRestart)
    return GLib.SOURCE_CONTINUE
  })
}
