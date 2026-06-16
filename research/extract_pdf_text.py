from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import requests
from pypdf import PdfReader

PDF_URLS = {
    "hhla_ghl2": "https://hhla.de/fileadmin/download/HHLA_NBS_Logistikterminals_Anlage_3_Betrieblicher_Teil_GHL2.pdf",
    "hhla_ctb": "https://hhla.de/fileadmin/download/HHLA_Anlage_2_NBS_Betrieblicher_Teil_CTB.pdf",
    "chempark": "https://www.chempark.de/wp-content/uploads/sites/3/2024/04/NBS-BT-Uebergabebahnhof-DOR-CP-Stand-11-2023.pdf",
    "ibb_stade": "https://www.ibb-terminal-stade.de/resources/download/Nutzungsbedingungen_Besonderer_Teil.pdf",
    "eurokombi": "https://www.eurokombi.de/wp-content/uploads/2025/09/NBSBetrieblicherTeilVers132025.pdf",
    "hans_lehmann": "https://www.hans-lehmann.de/files/content/pdf_2026/nutzungsbedingungen/lk1-nbs-bt-20260216.pdf",
    "stadtwerke_essen": "https://www.stadtwerke-essen.de/downloadcenter/nutzungsbedingungen-serviceeinrichtungen-besonderer-teil",
    "hafen_kehl": "https://www.hafen-kehl.de/wLayout25/wGlobal/scripts/accessDocument.php?forceDownload=0&document=/wMedia/docs/download/hafenbahn/NBS-2025-Eisenbahnbetriebsanweisung-Infrastruktur-Nutzungsbedingungen.pdf",
    "wertheim": "https://www.wertheim.de/site/Wertheim-Mainhafen/get/params_E220155964/3230802/Nutzungsbedingungen%20NBS-BT%200817.pdf",
    "wahlstedt": "https://stadtwerke-wahlstedt.de/wp-content/uploads/2026/01/Nutzung_Besonders.pdf",
    "deltaport": "https://www.deltaport.de/wp-content/uploads/2025/07/B_RL_NBSBT_KBHE_20250701_UZ.pdf",
    "stadtwerke_schweinfurt": "https://www.stadtwerke-sw.de/_Resources/Persistent/0/6/1/a/061aa8097dadc5d4087d05da60afe2b8a9007335/Infrastrukturvertrag_mit_Anlagen.pdf",
}

OUT_DIR = Path("research/pdf_texts")
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; eisenbahnbetriebsleiter-research/1.0)",
    "Accept": "application/pdf,application/xhtml+xml,text/html,*/*;q=0.8",
}

for name, url in PDF_URLS.items():
    try:
        response = requests.get(url, headers=HEADERS, timeout=60, allow_redirects=True)
        print(f"{name}: HTTP {response.status_code}, {len(response.content)} bytes, {response.headers.get('content-type')}")

        if response.status_code != 200 or not response.content:
            continue

        if "pdf" not in response.headers.get("content-type", "").lower() and not response.content.startswith(b"%PDF"):
            continue

        pdf_path = OUT_DIR / f"{name}.pdf"
        pdf_path.write_bytes(response.content)

        reader = PdfReader(str(pdf_path))
        text_parts = []
        for page in reader.pages:
            try:
                text_parts.append(page.extract_text() or "")
            except Exception as exc:
                text_parts.append(f"\n[EXTRACTION_ERROR: {exc}]\n")

        text = "\n".join(text_parts)
        text_path = OUT_DIR / f"{name}.txt"
        text_path.write_text(text, encoding="utf-8")
        print(f"  extracted {len(text)} chars -> {text_path}")
    except Exception as exc:
        print(f"{name}: ERROR {exc}")