#!/usr/bin/env python3
"""Packaging script for WhatsApp Manutenção on Windows x64.

Bundles node.exe, application dependencies, scripts and UI assets into
dist/whatsapp-manutencao.exe and creates dist/whatsapp-manutencao-windows-x64.zip.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
VERSION = "0.3.0"
TRAILER_MAGIC = b"WAPAYLOD"

NODE_LICENSE_TEXT = """Node.js is licensed for use as follows:

Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
"""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def find_windows_node() -> Path:
    # 1. Environment variable
    if os.environ.get("NODE_EXE"):
        p = Path(os.environ["NODE_EXE"])
        if p.is_file():
            return p

    # 2. PATH lookup
    which = shutil.which("node") or shutil.which("node.exe")
    if which:
        p = Path(which)
        if p.is_file() and p.suffix.lower() == ".exe":
            return p

    # 3. Standard locations on Windows
    candidates = [
        Path(r"C:\nvm4w\nodejs\node.exe"),
        Path(r"C:\Program Files\nodejs\node.exe"),
        Path(r"C:\Program Files (x86)\nodejs\node.exe"),
    ]
    for c in candidates:
        if c.is_file():
            return c

    raise FileNotFoundError("Não foi possível localizar o node.exe no sistema.")


def verify_pe_x64(path: Path) -> None:
    with path.open("rb") as stream:
        if stream.read(2) != b"MZ":
            raise ValueError(f"{path.name} não é um executável PE válido.")
        stream.seek(0x3C)
        offset_bytes = stream.read(4)
        if len(offset_bytes) < 4:
            raise ValueError(f"{path.name} cabeçalho PE corrompido.")
        offset = struct.unpack("<I", offset_bytes)[0]
        stream.seek(offset)
        sig = stream.read(6)
        if sig != b"PE\0\0\x64\x86":
            raise ValueError(f"{path.name} não é um executável Windows x64 (esperado AMD64).")


def collect_payload_files(node_exe: Path) -> list[tuple[Path | bytes, str]]:
    """Returns list of (source_path_or_bytes, relative_zip_path)."""
    items: list[tuple[Path | bytes, str]] = [
        (node_exe, "runtime/node.exe"),
        (NODE_LICENSE_TEXT.encode("utf-8"), "runtime/LICENSE"),
    ]

    directories = ["src", "scripts", "desktop-ui", "node_modules", ".codex-plugin"]
    for folder in directories:
        folder_path = ROOT / folder
        if not folder_path.exists():
            continue
        for file in sorted(folder_path.rglob("*")):
            if file.is_symlink():
                if "node_modules/.bin/" in file.as_posix():
                    continue
                continue
            if not file.is_file() or ".bin" in file.parts or "__pycache__" in file.parts:
                continue
            if file.suffix.lower() in {".node", ".so", ".dylib"}:
                continue
            if folder == "scripts" and file.name not in {
                "desktop-service.mjs",
                "desktop-stdio.mjs",
                "open-desktop.mjs",
                "start-gpt-tunnel.mjs",
                "stdio.mjs",
            }:
                continue
            items.append((file, "whatsapp-manutencao/" + file.relative_to(ROOT).as_posix()))

    for name in [
        "package.json",
        "package-lock.json",
        ".mcp.json",
        "mcp.json",
        "plugin.json",
        "LEIA-ME.md",
        "RELATORIO-VALIDACAO.md",
        "README.md",
        "SECURITY.md",
    ]:
        f = ROOT / name
        if f.is_file():
            items.append((f, "whatsapp-manutencao/" + name))

    return items


def create_payload_zip(payload_path: Path, items: list[tuple[Path | bytes, str]]) -> tuple[str, int]:
    with zipfile.ZipFile(payload_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source, rel_name in items:
            # Ensure path uses forward slashes and no leading slash
            clean_name = rel_name.replace("\\", "/").lstrip("/")
            info = zipfile.ZipInfo(clean_name, date_time=(2026, 9, 11, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            if isinstance(source, bytes):
                archive.writestr(info, source)
            else:
                archive.writestr(info, source.read_bytes())

    sha256 = sha256_file(payload_path)
    size = payload_path.stat().st_size
    return sha256, size


def package(node_exe_arg: str | None = None) -> None:
    DIST.mkdir(parents=True, exist_ok=True)

    # 1. Locate and check node.exe
    node_exe = Path(node_exe_arg) if node_exe_arg else find_windows_node()
    if not node_exe.is_file():
        raise FileNotFoundError(f"node.exe não encontrado em: {node_exe}")
    print(f"[*] Node runtime localizado: {node_exe}")
    verify_pe_x64(node_exe)

    # 2. Check or build launcher stub
    stub_exe = DIST / "whatsapp-manutencao.exe"
    if not stub_exe.is_file():
        launcher_dir = ROOT / "launcher"
        print("[*] Compilando launcher Go...")
        subprocess.run(
            ["go", "build", "-ldflags=-H windowsgui -s -w", "-o", str(stub_exe), "."],
            cwd=launcher_dir,
            check=True,
        )
    verify_pe_x64(stub_exe)

    # Read the clean stub binary (strip existing trailer if previously appended)
    with stub_exe.open("rb") as f:
        stub_data = f.read()

    if len(stub_data) >= 80 and stub_data[-8:] == TRAILER_MAGIC:
        trailer = stub_data[-80:]
        prev_size = struct.unpack("<Q", trailer[64:72])[0]
        stub_data = stub_data[:-80 - prev_size]
        print(f"[*] Stub anterior limpo (tamanho base: {len(stub_data)} bytes)")

    with tempfile.TemporaryDirectory(prefix="wa-pkg-") as temp_dir:
        temp_payload = Path(temp_dir) / "payload.zip"
        print("[*] Coletando arquivos para o pacote...")
        items = collect_payload_files(node_exe)
        print(f"[*] Total de itens no payload: {len(items)}")

        print("[*] Gerando arquivo ZIP do payload...")
        payload_sha256, payload_size = create_payload_zip(temp_payload, items)
        print(f"[*] Payload criado: {payload_size} bytes, SHA256: {payload_sha256}")

        payload_bytes = temp_payload.read_bytes()

        # Build trailer: 64 ascii hex + 8 bytes uint64 LE + 8 bytes magic
        trailer = payload_sha256.encode("ascii") + struct.pack("<Q", payload_size) + TRAILER_MAGIC
        assert len(trailer) == 80, f"Trailer deve ter 80 bytes, tem {len(trailer)}"

        standalone_exe = DIST / "whatsapp-manutencao.exe"
        print(f"[*] Montando executável standalone final em: {standalone_exe}")
        with standalone_exe.open("wb") as f:
            f.write(stub_data)
            f.write(payload_bytes)
            f.write(trailer)

    final_exe_size = standalone_exe.stat().st_size
    final_exe_sha = sha256_file(standalone_exe)
    print(f"[OK] Executável standalone gerado com sucesso!")
    print(f"     Tamanho: {final_exe_size} bytes")
    print(f"     SHA256: {final_exe_sha}")

    # 3. Create dist/whatsapp-manutencao-windows-x64.zip
    release_zip = DIST / "whatsapp-manutencao-windows-x64.zip"
    print(f"[*] Gerando arquivo de release: {release_zip}")
    with zipfile.ZipFile(release_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as rz:
        rz.write(standalone_exe, "whatsapp-manutencao.exe")
        for doc in ["LEIA-ME.md", "README.md", "RELATORIO-VALIDACAO.md", "SECURITY.md"]:
            doc_path = ROOT / doc
            if doc_path.is_file():
                rz.write(doc_path, doc)

    print(f"[OK] Release ZIP gerada: {release_zip.name} ({release_zip.stat().st_size} bytes)")
    print("[+] Empacotamento concluído com sucesso!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Empacotador WhatsApp Manutenção")
    parser.add_argument("--node", help="Caminho para o node.exe Windows x64", default=None)
    args = parser.parse_args()
    package(args.node)
