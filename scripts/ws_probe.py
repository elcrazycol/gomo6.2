#!/usr/bin/env python3
"""
ws_probe.py — minimal WebSocket client (stdlib only, no external deps).

Used by scripts/e2e-privacy-wall.sh to verify that a user can (or cannot)
subscribe to a profile wall room in real time.

Usage:
    python3 ws_probe.py ws://HOST[:PORT]/ws <token> <room> [timeout_seconds]

Exit codes:
    0 — room subscription CONFIRMED (allowed)
    1 — access DENIED (server sent "Not authorized for this room")
    2 — protocol error / no definitive answer (timeout, handshake failure, ...)
"""

import base64
import hashlib
import json
import os
import socket
import ssl
import struct
import sys
import time

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def handshake(url, token):
    """Perform the WebSocket opening handshake and return a connected socket."""
    if not (url.startswith("ws://") or url.startswith("wss://")):
        raise RuntimeError("url must start with ws:// or wss://")
    secure = url.startswith("wss://")
    rest = url[len("ws://"):] if not secure else url[len("wss://"):]
    hostport, _, path = rest.partition("/")
    path = "/" + path if path else "/"
    # rpartition on an IPv6-free host: last ':' separates port. If there is no
    # port (e.g. ws://localhost/ws) the whole string is the host.
    if ":" in hostport:
        host, _, port = hostport.rpartition(":")
    else:
        host, port = hostport, ""
    if not port:
        port = "443" if secure else "80"

    sock = socket.create_connection((host, int(port)), timeout=10)
    if secure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        sock = ctx.wrap_socket(sock, server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    sock.sendall(req.encode())

    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("connection closed during handshake")
        resp += chunk

    status_line = resp.split(b"\r\n", 1)[0].decode(errors="replace")
    if " 101 " not in status_line:
        raise RuntimeError(f"handshake failed: {status_line}")

    headers = {}
    for line in resp.split(b"\r\n")[1:]:
        if b":" in line:
            k, _, v = line.partition(b":")
            headers[k.strip().lower().decode(errors="replace")] = v.strip().decode(errors="replace")

    # Verify Sec-WebSocket-Accept
    expected = base64.b64encode(
        hashlib.sha1((key + WS_GUID).encode()).digest()
    ).decode()
    got = headers.get("sec-websocket-accept", "")
    if got != expected:
        raise RuntimeError(
            f"invalid Sec-WebSocket-Accept: got={got!r} expected={expected!r} "
            f"status={status_line!r} headers={headers!r}"
        )

    sock.settimeout(5)
    return sock


def send_text(sock, text):
    """Send a masked text frame (RFC 6455)."""
    payload = text.encode()
    mask = os.urandom(4)
    length = len(payload)
    header = bytearray([0x81])  # FIN + text opcode
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header += struct.pack(">H", length)
    else:
        header.append(0x80 | 127)
        header += struct.pack(">Q", length)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(bytes(header) + mask + masked)


def recv_frame(sock):
    """Receive one frame. Returns (opcode, payload_bytes) or raises on close."""
    def recv_exact(n):
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("socket closed")
            buf += chunk
        return buf

    hdr = recv_exact(2)
    fin = hdr[0] & 0x80
    opcode = hdr[0] & 0x0F
    masked = hdr[1] & 0x80
    length = hdr[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", recv_exact(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exact(8))[0]
    mask = recv_exact(4) if masked else None
    payload = recv_exact(length)
    if mask:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload, fin


def recv_text_messages(sock, deadline):
    """Yield decoded text messages until the deadline passes."""
    while time.monotonic() < deadline:
        try:
            opcode, payload, fin = recv_frame(sock)
        except (socket.timeout, ConnectionError, OSError):
            return
        if opcode == 0x8:  # close
            return
        if opcode == 0x1:  # text
            try:
                yield payload.decode()
            except UnicodeDecodeError:
                continue
        # Ignore ping/pong/continuation frames


def main():
    if len(sys.argv) < 4:
        print("usage: ws_probe.py <ws://url> <token> <room> [timeout_s]", file=sys.stderr)
        return 2

    url = sys.argv[1]
    token = sys.argv[2]
    room = sys.argv[3]
    timeout = float(sys.argv[4]) if len(sys.argv) > 4 else 10.0

    sock = None
    try:
        sock = handshake(url, token)
    except Exception as exc:
        print(f"PROBE_RESULT=ERROR handshake: {exc}")
        return 2

    deadline = time.monotonic() + timeout
    try:
        # Authenticate first — the server requires auth before any room access.
        send_text(sock, json.dumps({"type": "auth", "data": {"token": token}}))

        authed = False
        for msg in recv_text_messages(sock, deadline):
            try:
                parsed = json.loads(msg)
            except json.JSONDecodeError:
                continue
            mtype = parsed.get("type")
            if mtype == "error":
                err = parsed.get("data", {}).get("error", "")
                if "auth" in err.lower() or "Authenticate" in err:
                    print(f"PROBE_RESULT=ERROR auth_failed: {err}")
                    return 2
                # Any error BEFORE subscribing: auth failure.
                print(f"PROBE_RESULT=ERROR {err}")
                return 2
            if mtype == "connected":
                authed = True
                break

        if not authed:
            print("PROBE_RESULT=ERROR no_connected_confirmation")
            return 2

        # Now try to subscribe to the target room.
        send_text(sock, json.dumps({"type": "subscribe", "data": {"room": room}}))

        for msg in recv_text_messages(sock, deadline):
            try:
                parsed = json.loads(msg)
            except json.JSONDecodeError:
                continue
            mtype = parsed.get("type")
            if mtype == "error":
                err = parsed.get("data", {}).get("error", "")
                print(f"PROBE_RESULT=DENIED {err}")
                return 1
            if mtype == "confirmation":
                action = parsed.get("data", {}).get("action", "")
                confirmed_room = parsed.get("data", {}).get("room", "")
                if action == "subscribe" and confirmed_room == room:
                    print("PROBE_RESULT=ALLOWED")
                    return 0
        print("PROBE_RESULT=TIMEOUT no_confirmation")
        return 2
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
