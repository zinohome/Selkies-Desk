import ast
import asyncio
import logging
import os
from pathlib import Path
import time
from types import SimpleNamespace
from typing import List, Optional, Tuple, Union
import unittest
from unittest.mock import AsyncMock, patch


source_path = Path(os.environ["SELKIES_CLIPBOARD_TEST_SOURCE"])
source = ast.parse(source_path.read_text(encoding="utf-8"))
original = next(node for node in source.body
                if isinstance(node, ast.ClassDef) and node.name == "WebRTCInput")
methods = {
    "_uses_xwayland_clipboard", "_x11_session_display",
    "read_clipboard", "_set_clipboard", "start_clipboard",
}
selected = ast.ClassDef(
    name="ClipboardHandler",
    bases=[], keywords=[], decorator_list=[],
    body=[node for node in original.body
          if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
          and node.name in methods],
)
namespace = {
    "asyncio": asyncio, "os": os, "time": time,
    "Optional": Optional, "List": List, "Tuple": Tuple, "Union": Union,
    "SecretText": type("SecretText", (str,), {}),
    "CLIPBOARD_SECRET_HINTS": ["x-kde-passwordManagerHint"],
    "logger_webrtc_input": logging.getLogger("clipboard-test"),
    "x_display_live": lambda display: display == ":0",
    "x_display_is_xwayland": lambda display: display == ":0",
}
exec(compile(ast.fix_missing_locations(ast.Module(
    body=[selected], type_ignores=[])), str(source_path), "exec"), namespace)
Handler = namespace["ClipboardHandler"]


class Monitor:
    def __init__(self, content=("远端 fixture", "text/plain"), owned=False):
        self.content = content
        self.owned = owned
        self.offered = []
        self.closed = False
        self.accepts = True

    def read(self, binary):
        return self.content

    def offer(self, entries):
        self.offered = entries
        return self.accepts

    def owns_selection(self):
        return self.owned

    def alive(self):
        return True

    def close(self):
        self.closed = True

    async def wait_change(self, timeout):
        await asyncio.sleep(0.01)
        return True


class ClipboardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "SELKIES_CLIPBOARD_XWAYLAND": "1", "DISPLAY": ":0",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.monitor = Monitor()
        self.handler = Handler()
        self.handler.is_wayland = True
        self.handler._has_separate_app_compositor = lambda: True
        self.handler._ensure_x11_clipboard_monitor_async = AsyncMock(
            return_value=self.monitor)
        self.handler._app_clipboard_read = AsyncMock(return_value=(None, None))
        self.handler._png_beside = None
        self.handler._app_wayland_display = lambda: "wayland-0"
        self.handler._invalidate_app_wl_display_if_dead = lambda display: None

        def unsupported(*args):
            raise RuntimeError("app compositor advertises neither "
                               "ext_data_control_manager_v1 nor "
                               "zwlr_data_control_manager_v1")

        self.handler.wayland_input = SimpleNamespace(
            clipboard_write_app=unsupported)

    def test_opt_in_selects_the_current_xwayland_display(self):
        self.assertEqual(self.handler._x11_session_display(), ":0")

    def test_default_keeps_the_existing_wayland_backend(self):
        os.environ.pop("SELKIES_CLIPBOARD_XWAYLAND")
        self.assertIsNone(self.handler._x11_session_display())

    def test_missing_display_does_not_select_another_session(self):
        os.environ["DISPLAY"] = ""
        self.assertIsNone(self.handler._x11_session_display())

    async def test_text_reaches_xwayland_without_data_control(self):
        result = await self.handler._set_clipboard("本机 fixture")
        self.assertTrue(result)
        self.assertEqual(self.monitor.offered, [
            ("text/plain", "本机 fixture".encode("utf-8")),
        ])

    async def test_image_bytes_reach_xwayland(self):
        result = await self.handler._set_clipboard(b"\x89PNG fixture", "image/png")
        self.assertTrue(result)
        self.assertEqual(self.monitor.offered, [("image/png", b"\x89PNG fixture")])

    async def test_failed_native_offer_is_reported(self):
        self.monitor.accepts = False
        self.assertFalse(await self.handler._set_clipboard("fixture"))

    async def test_owned_selection_can_be_received_again(self):
        self.monitor.owned = True
        self.assertEqual(await self.handler.read_clipboard(), (
            "远端 fixture", "text/plain",
        ))

    async def test_remote_image_can_be_received_again(self):
        self.monitor.owned = True
        self.monitor.content = (b"\x89PNG remote fixture", "image/png")
        self.assertEqual(await self.handler.read_clipboard(True), (
            b"\x89PNG remote fixture", "image/png",
        ))

    async def test_seamless_sync_keeps_the_xwayland_monitor(self):
        handler = self.handler
        handler.enable_clipboard = "true"
        handler.enable_binary_clipboard = "true"
        handler._clipboard_monitor_active = False
        handler._clipboard_last_bytes = None
        handler._clipboard_self_write = None
        handler._x11_clipboard_monitor = self.monitor
        handler._clipboard_has_consumers = lambda: True
        handler._arm_app_compositor_watch = AsyncMock(return_value=None)
        delivered = []

        async def broadcast(content, mime):
            delivered.append((content, mime))
            handler.clipboard_running = False

        handler.on_clipboard_read = broadcast
        handler._spawn_task = lambda task, **kwargs: asyncio.create_task(task)
        await asyncio.wait_for(handler.start_clipboard(), 2)
        self.assertEqual(delivered, [("远端 fixture", "text/plain")])
        self.assertFalse(self.monitor.closed)
        handler._arm_app_compositor_watch.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
