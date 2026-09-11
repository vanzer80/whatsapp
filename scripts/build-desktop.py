#!/usr/bin/env python3
"""Build a Windows x64 test candidate from already verified local components.

This script does not download components, install dependencies, sign binaries,
change security policy, or claim that the candidate is ready for distribution.
See DESENVOLVIMENTO.md for input provenance and pending Windows acceptance.
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
import tempfile
import xml.etree.ElementTree as ET
import zipfile

VERSION = "0.3.0"
NODE_VERSION = "v24.21.0"
ROOT = Path(__file__).resolve().parents[1]


def digest(file: Path) -> str:
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def regular_file(value: str) -> Path:
    candidate = Path(value).absolute()
    for item in [candidate, *candidate.parents]:
        if item.is_symlink():
            raise ValueError(f"Link recusado: {candidate.name}")
    if not candidate.is_file():
        raise ValueError(f"Componente local ausente: {candidate.name}")
    return candidate


def run(arguments: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(arguments, check=True, text=True, timeout=300, **kwargs)


def verify_pe(binary: Path) -> None:
    with binary.open("rb") as stream:
        if stream.read(2) != b"MZ":
            raise ValueError("Node para Windows não é um executável PE.")
        stream.seek(0x3C)
        offset = struct.unpack("<I", stream.read(4))[0]
        stream.seek(offset)
        if stream.read(6) != b"PE\0\0\x64\x86":
            raise ValueError("O executável não é Windows x64.")


def validate_tests(node: Path, directory: Path) -> None:
    report = directory / "node-tests.xml"
    tests = [str(p) for p in sorted((ROOT / "test").glob("*.test.mjs"))]
    result = run([str(node), "--test", "--test-reporter=junit", *tests], cwd=ROOT, capture_output=True)
    report.write_text(result.stdout, encoding="utf-8")
    parsed = ET.fromstring(result.stdout)
    skipped = list(parsed.iter("skipped"))
    failed = list(parsed.iter("failure")) + list(parsed.iter("error"))
    if skipped or failed:
        raise ValueError("Há testes não executados ou falhos. Não gerar o candidato até resolver as pendências.")


def collect_payload(node: Path, license_file: Path) -> list[tuple[Path, str]]:
    result = [(node, "runtime/node.exe"), (license_file, "runtime/LICENSE")]
    directories = ["src", "scripts", "desktop-ui", "node_modules", ".codex-plugin"]
    for folder in directories:
        for file in sorted((ROOT / folder).rglob("*")):
            if file.is_symlink():
                # npm creates optional command shortcuts here. They are unused.
                if "node_modules/.bin/" in file.as_posix():
                    continue
                raise ValueError(f"Link inesperado no pacote: {file.relative_to(ROOT)}")
            if not file.is_file() or ".bin" in file.parts or "__pycache__" in file.parts:
                continue
            if file.suffix.lower() in {".node", ".so", ".dylib"}:
                raise ValueError("Dependência nativa exige revisão específica para Windows.")
            if folder == "scripts" and file.name not in {"desktop-service.mjs", "desktop-stdio.mjs", "open-desktop.mjs"}:
                continue
            if folder == "src" and file.name == "server.mjs":
                pass  # Exports the same four read-only MCP tools.
            result.append((file, "whatsapp-manutencao/" + file.relative_to(ROOT).as_posix()))
    for name in ["package.json", "package-lock.json", ".mcp.json", "mcp.json", "plugin.json", "LEIA-ME.md", "RELATORIO-VALIDACAO.md"]:
        result.append((ROOT / name, "whatsapp-manutencao/" + name))
    if not (ROOT / "node_modules/@modelcontextprotocol/sdk/package.json").is_file():
        raise ValueError("As dependências preparadas não estão disponíveis.")
    return result


def build(args) -> None:
    # A local manifest records values retrieved separately from the official
    # Node release. It is never accepted from inside an untrusted Node archive.
    inputs = json.loads(regular_file(args.inputs).read_text(encoding="utf-8"))
    if inputs.get("node_version") != NODE_VERSION:
        raise ValueError("Versão do Node diferente da versão revisada.")
    for key in ["node_windows", "node_host", "node_license"]:
        item = inputs[key]
        if not item["source_url"].startswith(f"https://nodejs.org/dist/{NODE_VERSION}/"):
            raise ValueError("Origem do componente não corresponde à distribuição oficial revisada.")
        file = regular_file(item["file"])
        if digest(file) != item["sha256"]:
            raise ValueError(f"SHA-256 divergente: {key}")
    windows_node = regular_file(inputs["node_windows"]["file"])
    host_node = regular_file(inputs["node_host"]["file"])
    node_license = regular_file(inputs["node_license"]["file"])
    go = regular_file(args.go)
    verify_pe(windows_node)
    if run([str(host_node), "--version"], capture_output=True).stdout.strip() != NODE_VERSION:
        raise ValueError("Node de testes não corresponde à versão do pacote.")
    output = Path(args.output).absolute()
    if output.exists():
        raise ValueError("A pasta de saída já existe. Use uma pasta nova para preservar compilações anteriores.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wa-build-", dir=output.parent) as scratch:
        stage = Path(scratch)
        validate_tests(host_node, stage)
        run([str(go), "test", "./..."], cwd=ROOT / "launcher", env={**os.environ, "GOTOOLCHAIN": "local", "GOPROXY": "off"})
        payload = stage / "payload.zip"
        with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for source, name in collect_payload(windows_node, node_license):
                if source.stat().st_size > 140 * 1024 * 1024:
                    raise ValueError("Componente excede o limite individual do instalador.")
                info = zipfile.ZipInfo(name, date_time=(2026, 9, 11, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100600 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, source.read_bytes())
        payload_hash, payload_size = digest(payload), payload.stat().st_size
        if payload_size > 300 * 1024 * 1024:
            raise ValueError("Pacote maior que o limite aceito pelo iniciador.")
        with zipfile.ZipFile(payload) as archive:
            if len(archive.infolist()) > 30000 or sum(i.file_size for i in archive.infolist()) > 650 * 1024 * 1024:
                raise ValueError("O pacote excede os limites do iniciador.")
        stub = stage / "launcher.exe"
        flags = f"-H=windowsgui -s -w -X main.payloadSHA={payload_hash} -X main.payloadLength={payload_size}"
        environment = {**os.environ, "GOOS": "windows", "GOARCH": "amd64", "CGO_ENABLED": "0", "GOTOOLCHAIN": "local", "GOPROXY": "off"}
        run([str(go), "build", "-trimpath", "-buildvcs=false", "-ldflags", flags, "-o", str(stub), "."], cwd=ROOT / "launcher", env=environment)
        verify_pe(stub)
        result = stage / f"WhatsApp-Manutencao-{VERSION}-CANDIDATO.exe"
        with result.open("xb") as stream:
            for file in [stub, payload]:
                with file.open("rb") as source:
                    shutil.copyfileobj(source, stream)
        report = {
            "version": VERSION, "status": "candidate_requires_windows_acceptance",
            "executable": result.name, "sha256": digest(result),
            "payload_sha256": payload_hash, "payload_bytes": payload_size,
            "node_version": NODE_VERSION, "code_signed": False,
            "pending": ["Windows installation and ACL verification", "Google Chrome and WhatsApp QR pairing", "ChatGPT Windows MCP recognition", "Full allow/revoke/restart workflow", "GUI visual and accessibility review"],
        }
        (stage / "BUILD.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        output.mkdir()
        for file in [result, stage / "BUILD.json", stage / "node-tests.xml"]:
            shutil.copyfile(file, output / file.name)
    print(f"Candidato criado para testes de aceitação: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", required=True, help="Manifesto dos componentes oficiais já verificados")
    parser.add_argument("--go", required=True, help="Compilador Go local já verificado")
    parser.add_argument("--output", required=True, help="Nova pasta de saída")
    try:
        build(parser.parse_args())
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, ET.ParseError) as error:
        raise SystemExit(f"Compilação interrompida: {error}") from error
