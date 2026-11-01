#!/usr/bin/python3
"""A minimal tray app (StatusNotifierItem + DBusMenu) for testing the shell's
Background Apps list in the dev VM, where no real tray apps are installed.

Usage (inside the VM's session):
    python3 fake-tray-app.py [Name] [icon-name]

Its menu has "Open Window" (prints a line) and "Quit" (exits), so the
Background Apps close button can be tested end to end.
"""

import os
import sys

import gi

gi.require_version("Dbusmenu", "0.4")
from gi.repository import Dbusmenu, Gio, GLib  # noqa: E402

NAME = sys.argv[1] if len(sys.argv) > 1 else "QA Tray App"
ICON = sys.argv[2] if len(sys.argv) > 2 else "org.gnome.Calculator"
ITEM_PATH = "/StatusNotifierItem"
MENU_PATH = "/MenuBar"

SNI_XML = """
<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="Category" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <property name="ItemIsMenu" type="b" access="read"/>
    <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
    <signal name="NewIcon"/>
    <signal name="NewTitle"/>
    <signal name="NewStatus"><arg type="s"/></signal>
  </interface>
</node>
"""

loop = GLib.MainLoop()

# DBusMenu with an "Open Window" and a "Quit" item
server = Dbusmenu.Server.new(MENU_PATH)
root = Dbusmenu.Menuitem.new()
for label, handler in (
    ("Open Window", lambda *_: print(f"{NAME}: activated", flush=True)),
    ("Quit", lambda *_: loop.quit()),
):
    item = Dbusmenu.Menuitem.new()
    item.property_set(Dbusmenu.MENUITEM_PROP_LABEL, label)
    item.connect("item-activated", handler)
    root.child_append(item)
server.set_root(root)

props = {
    "Category": GLib.Variant("s", "ApplicationStatus"),
    "Id": GLib.Variant("s", "cobalt-qa-" + NAME.lower().replace(" ", "-")),
    "Title": GLib.Variant("s", NAME),
    "Status": GLib.Variant("s", "Active"),
    "IconName": GLib.Variant("s", ICON),
    "Menu": GLib.Variant("o", MENU_PATH),
    "ItemIsMenu": GLib.Variant("b", False),
}


def on_call(_conn, _sender, _path, _iface, method, _params, invocation):
    if method == "Activate":
        print(f"{NAME}: activated", flush=True)
    invocation.return_value(None)


def on_get(_conn, _sender, _path, _iface, prop):
    return props[prop]


bus = Gio.bus_get_sync(Gio.BusType.SESSION)
node = Gio.DBusNodeInfo.new_for_xml(SNI_XML)
bus.register_object(ITEM_PATH, node.interfaces[0], on_call, on_get, None)
service = f"org.kde.StatusNotifierItem-{os.getpid()}-1"
Gio.bus_own_name_on_connection(bus, service, Gio.BusNameOwnerFlags.NONE, None, None)
bus.call_sync(
    "org.kde.StatusNotifierWatcher",
    "/StatusNotifierWatcher",
    "org.kde.StatusNotifierWatcher",
    "RegisterStatusNotifierItem",
    GLib.Variant("(s)", (service,)),
    None,
    Gio.DBusCallFlags.NONE,
    -1,
    None,
)
print(f"{NAME}: registered as {service}", flush=True)
loop.run()
print(f"{NAME}: quit", flush=True)
