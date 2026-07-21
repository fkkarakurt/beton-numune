# -*- coding: utf-8 -*-
"""Yerel (ücretsiz) PDF okuyucunun örnek raporla doğrulanması."""
import os

import pytest

from app.pdf_extract import ExtractionError, extract_report

PDF_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "assets", "ornek_beton_raporu.pdf")

# assets/ klasörü kişisel veri içerdiğinden depoya dahil edilmez; örnek PDF
# yoksa bu testler atlanır (yerel geliştirme ortamında çalışırlar).
pytestmark = pytest.mark.skipif(
    not os.path.exists(PDF_PATH),
    reason="assets/ornek_beton_raporu.pdf bulunamadı (depoya dahil değildir)")

# Örnek rapordaki beklenen tekil sonuçlar
EXPECTED = {
    "1": [44.8, 40.0, 45.8],
    "2": [48.0, 49.3, 47.9],
    "3": [45.7, 39.5, 42.1],
    "4": [45.4, 46.5, 47.4],
    "5": [45.6, 46.4, 43.0],
    "6": [43.5, 47.2, 46.6],
    "7": [46.9, 38.3, 47.5],
    "8": [47.2, 50.3, 47.0],
    "9": [47.9, 43.8, 52.2],
    "10": [48.5, 48.1, 43.9],
}


@pytest.fixture(scope="module")
def report():
    with open(PDF_PATH, "rb") as f:
        data = f.read()
    return extract_report([("ornek_beton_raporu.pdf", data)])


def test_groups_and_values(report):
    got = {g.group_no: g.values for g in report.gruplar}
    assert set(got.keys()) == set(EXPECTED.keys())
    for k, vals in EXPECTED.items():
        assert got[k] == pytest.approx(vals), f"grup {k}: {got[k]}"


def test_header_fields(report):
    assert report.rapor_no == "B601-28-23"
    assert report.yibf_no == "1487616"
    assert report.beton_sinifi == "C35/45"
    assert report.beton_miktari_m3 == pytest.approx(600)
    assert report.alinan_numune_adedi == 40
    assert report.yapi_elemani and "TEMEL" in report.yapi_elemani.upper()
    assert report.uretici_firma and "NUH" in report.uretici_firma
    assert report.deney_isteyen and "AHS" in report.deney_isteyen


def test_dates(report):
    assert report.alinis_tarihi == "2023-04-16"
    assert report.deney_tarihi == "2023-05-14"


def test_basis_detected_from_footnote(report):
    # Dipnot: "... Fck (150*300)'e eşdeğer olarak verilmiştir" -> silindir
    assert report.sonuc_esasi == "silindir"


def test_slump(report):
    g1 = next(g for g in report.gruplar if g.group_no == "1")
    assert g1.slump_class == "S4"
    assert g1.slump_measured_mm == pytest.approx(150)  # 15 cm -> 150 mm


def test_non_pdf_rejected():
    with pytest.raises(ExtractionError):
        extract_report([("foto.jpg", b"\xff\xd8\xff")])


def test_scanned_pdf_rejected():
    # Metin katmanı olmayan minik PDF -> anlamlı hata
    minimal = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
               b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
               b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
               b"trailer<</Root 1 0 R>>\n%%EOF")
    with pytest.raises(ExtractionError):
        extract_report([("tarama.pdf", minimal)])
