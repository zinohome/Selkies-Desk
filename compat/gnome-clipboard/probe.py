import argparse
from io import BytesIO
import json
import os
from pathlib import Path
import time

from PIL import Image
from selkies.input_handler import _X11ClipboardMonitor


TEXT = "Selkies 双向剪贴板 fixture 2026-11-20"
SIZE = (12, 10)
COLOR = (28, 160, 96)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["read-text", "write-text", "read-image", "write-image"])
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    monitor = _X11ClipboardMonitor(os.environ["DISPLAY"])
    result = {"mode": arguments.mode, "ok": False, "done": False}
    try:
        if arguments.mode == "write-image":
            stream = BytesIO()
            Image.new("RGB", SIZE, COLOR).save(stream, format="PNG")
            result["ok"] = monitor.offer([("image/png", stream.getvalue())])
        elif arguments.mode == "write-text":
            result["ok"] = monitor.offer([("text/plain", TEXT.encode("utf-8"))])
        else:
            content, mime = monitor.read(True)
            if arguments.mode == "read-text":
                result["ok"] = content == TEXT and mime == "text/plain"
            elif isinstance(content, bytes) and mime == "image/png":
                image = Image.open(BytesIO(content)).convert("RGB")
                result["ok"] = image.size == SIZE and image.getpixel((0, 0)) == COLOR
        arguments.output.write_text(json.dumps(result), encoding="utf-8")
        if arguments.mode.startswith("write-"):
            time.sleep(8)
    finally:
        monitor.close()
        result["done"] = True
        arguments.output.write_text(json.dumps(result), encoding="utf-8")
        print(json.dumps(result))
