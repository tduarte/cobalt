import Adw from "gi://Adw?version=1"
import { page } from "../lib/ui"

// Pages from later M5 batches
export default function Placeholder({ title, icon }: { title: string; icon: string }) {
  return page({
    title,
    content: new Adw.StatusPage({
      iconName: icon,
      title,
      description: "Coming in a later Settings update",
    }),
  })
}
