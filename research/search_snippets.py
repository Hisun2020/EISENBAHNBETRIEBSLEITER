from __future__ import annotations

import re
import sys
from pathlib import Path

OUT = Path("research/pdf_texts")
PATTERN = re.compile(r"Eisenbahnbetriebsleiter|EBL|Telefon|Tel\.|E-Mail|Mail|bahn|Bahnbetrieb|Gleisanschluss|Gleise|Gleis|Kontakt|bahnhof", re.IGNORECASE)

for path in sorted(OUT.glob("*.txt")):
    text = path.read_text(encoding="utf-8", errors="ignore")
    lines = text.splitlines()
    print(f"\n===== {path.name} =====")
    for i, line in enumerate(lines):
        if PATTERN.search(line):
            start = max(0, i - 2)
            end = min(len(lines), i + 4)
            print(f"--- line {i + 1} ---")
            for j in range(start, end):
                sys.stdout.buffer.write(f"{j + 1}: {lines[j]}\n".encode("utf-8", errors="replace"))
