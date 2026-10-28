"""Проверки моста без загрузки моделей и выполнения стороннего кода."""
import importlib.util
import struct
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mglotek_bridge", HERE / "bridge.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class BridgeTests(unittest.TestCase):
    def test_registry(self):
        data = mod.manifest()
        self.assertTrue(mod.validate(data))
        self.assertEqual(len(data["tools"]), 15)

    def test_every_repository_unique(self):
        data = mod.manifest()
        self.assertEqual(15, len({i["repo"] for i in data["tools"]}))

    def test_blender_cpu(self):
        item = mod.select(mod.manifest(), "blender")[0]
        self.assertEqual(item["backend"], "cpu")

    def test_no_autocloning_all(self):
        with self.assertRaises(ValueError):
            mod.select(mod.manifest(), "absent")

    def test_invalid_png_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.png"
            p.write_bytes(b"not a PNG")
            with self.assertRaises(ValueError):
                mod.inspect_asset(p)

    def test_png_dimensions(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.png"
            p.write_bytes(b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" +
                          struct.pack(">II", 1900, 470) + bytes([8, 6, 0, 0, 0]) +
                          b"\0\0\0\0")
            self.assertEqual(mod.inspect_asset(p)["size"], [1900, 470])

    def test_bad_glb_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.glb"
            p.write_bytes(b"glTF" + struct.pack("<II", 2, 300) + bytes(8))
            with self.assertRaises(ValueError):
                mod.inspect_asset(p)


if __name__ == "__main__":
    unittest.main()
