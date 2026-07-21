# -*- coding: utf-8 -*-
"""Değerlendirme motoru testleri.

Test verileri:
- assets/ornek_beton_raporu.pdf (İsbet Beton, C35/45, 10 grup x 3 numune,
  sonuçlar 150x300 silindir eşdeğeri)
- assets/BETON NUMUNE DEGERLENDIRME.xlsx (kullanıcının doğrulanmış Excel'i)
"""
from datetime import date

import pytest

from app.evaluation import evaluate, evaluate_group, parse_concrete_class

# Örnek PDF'teki tekil 28 günlük sonuçlar (MPa), grup -> [n1, n2, n3]
PDF_GROUPS = {
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


def _pdf_group_dicts():
    return [{"group_no": k, "values": v} for k, v in PDF_GROUPS.items()]


# ---------------------------------------------------------------------------
# Beton sınıfı çözümleme
# ---------------------------------------------------------------------------
def test_parse_class_variants():
    assert parse_concrete_class("C35/45") == "C35/45"
    assert parse_concrete_class("c 35 / 45") == "C35/45"
    assert parse_concrete_class("30/37") == "C30/37"
    assert parse_concrete_class("C25") == "C25/30"
    with pytest.raises(ValueError):
        parse_concrete_class("C33/44")


# ---------------------------------------------------------------------------
# TS 13515 Ek B1 — grup içi %15 kontrolü
# ---------------------------------------------------------------------------
def test_group_within_15pct():
    # Excel örneği: 53.7 / 53.3 / 51.6 -> fark 2.1 <= 0.15*52.87 = 7.93
    g = evaluate_group("1", [53.7, 53.3, 51.6])
    assert g.valid and g.within_limit
    assert g.mean_final == pytest.approx(52.9, abs=0.05)
    assert g.discarded_value is None


def test_group_discard_lowest_then_valid():
    # PDF grup 7: 46.9 / 38.3 / 47.5 -> fark 9.2 > 0.15*44.23 = 6.64
    # En düşük (38.3) atılır -> kalan 46.9/47.5, fark 0.6 <= 0.15*47.2
    g = evaluate_group("7", [46.9, 38.3, 47.5])
    assert not g.within_limit
    assert g.discarded_value == pytest.approx(38.3)
    assert g.valid
    assert g.mean_final == pytest.approx(47.2, abs=0.05)


def test_group_borderline_within():
    # PDF grup 3: 45.7 / 39.5 / 42.1 -> fark 6.2, sınır 0.15*42.43 = 6.365 -> geçerli
    g = evaluate_group("3", [45.7, 39.5, 42.1])
    assert g.within_limit and g.valid
    assert g.mean_final == pytest.approx(42.4, abs=0.05)


def test_group_invalid_after_discard():
    # 50 / 30 / 20: fark 30 > 0.15*33.3; 20 atılır -> 50/30 fark 20 > 0.15*40 -> geçersiz
    g = evaluate_group("x", [50.0, 30.0, 20.0])
    assert not g.valid
    assert g.discarded_value == pytest.approx(20.0)


def test_group_two_specimens_invalid():
    g = evaluate_group("x", [50.0, 30.0])
    assert not g.valid


def test_group_single_specimen():
    g = evaluate_group("x", [42.0])
    assert g.valid and g.mean_final == pytest.approx(42.0)


# ---------------------------------------------------------------------------
# Örnek PDF senaryosu — C35/45, silindir esası, n=10
# ---------------------------------------------------------------------------
def test_sample_pdf_report_conform():
    res = evaluate("C35/45", "silindir", _pdf_group_dicts(),
                   volume_m3=600,
                   sampling_date=date(2023, 4, 16),
                   test_date=date(2023, 5, 14))
    assert res.fck == 35.0
    assert res.n_valid == 10 and res.n_invalid == 0
    # Grup 7'de Ek B1 gereği 38.3 atıldığından fcm laboratuvarın basit
    # ortalamasından (45.9) bir miktar yüksek çıkar.
    assert res.fcm >= 45.9
    # n >= 5: fcm >= 35 + 2 = 37
    assert res.criterion1.applicable and res.criterion1.passed
    assert res.criterion1.threshold == pytest.approx(37.0)
    # her fci >= 31
    assert res.criterion2.passed
    assert res.ts500_conform and res.verdict == "UYGUN"
    # 28 günlük yaş: 16.04 -> 14.05 = 28 gün, uyarı olmamalı
    assert res.age_days == 28
    assert not any("Numune yaşı" in w for w in res.warnings)
    # 600 m3 için en az 6 grup beklenir; 10 grup var -> uyarı yok
    assert not any("TS 500" in w and "grup" in w for w in res.warnings)


def test_sample_pdf_wrong_basis_fails():
    # Aynı sonuçlar yanlışlıkla küp esasıyla değerlendirilirse (fck=45)
    # fcm ~46.0 < 45+2=47 -> 1. kriter sağlanmaz. Esas seçiminin önemi.
    res = evaluate("C35/45", "kup", _pdf_group_dicts())
    assert res.fck == 45.0
    assert res.criterion1.passed is False
    assert res.verdict == "UYGUN DEĞİL"


# ---------------------------------------------------------------------------
# Excel senaryosu — tek grup
# ---------------------------------------------------------------------------
def test_excel_single_group_n1():
    res = evaluate("C30/37", "kup", [{"group_no": "1",
                                      "values": [53.7, 53.3, 51.6]}])
    assert res.fck == 37.0
    assert res.criterion1.applicable is False          # n=1 -> uygulanamaz
    assert res.criterion2.threshold == pytest.approx(37.0)  # n=1: fci >= fck
    assert res.criterion2.passed
    assert res.verdict == "UYGUN"


def test_n1_fails_when_below_fck():
    res = evaluate("C30/37", "kup", [{"group_no": "1",
                                      "values": [35.0, 36.0, 36.5]}])
    assert res.criterion2.passed is False
    assert res.verdict == "UYGUN DEĞİL"


# ---------------------------------------------------------------------------
# n = 2..4 aralığı
# ---------------------------------------------------------------------------
def test_n3_margin_is_1():
    groups = [{"group_no": str(i), "values": [31.5, 31.0, 31.3]} for i in range(3)]
    res = evaluate("C25/30", "silindir", groups)
    # fcm ~31.3 >= 25+1=26, fci >= 21
    assert res.criterion1.threshold == pytest.approx(26.0)
    assert res.verdict == "UYGUN"


def test_n5_margin_is_2():
    groups = [{"group_no": str(i), "values": [26.5, 26.4, 26.6]} for i in range(5)]
    res = evaluate("C25/30", "silindir", groups)
    assert res.criterion1.threshold == pytest.approx(27.0)
    # fcm ~26.5 < 27 -> uygun değil
    assert res.verdict == "UYGUN DEĞİL"


def test_criterion2_catches_low_group():
    groups = [
        {"group_no": "1", "values": [40.0, 41.0, 40.5]},
        {"group_no": "2", "values": [40.0, 40.5, 41.0]},
        {"group_no": "3", "values": [30.2, 30.4, 30.6]},  # fci 30.4 < 31
    ]
    res = evaluate("C35/45", "silindir", groups)
    assert res.criterion1.passed  # fcm ~37 >= 36
    assert res.criterion2.passed is False
    assert res.verdict == "UYGUN DEĞİL"
    assert "3" in res.criterion2.detail


# ---------------------------------------------------------------------------
# Kenar durumlar ve yardımcı kontroller
# ---------------------------------------------------------------------------
def test_all_groups_invalid():
    res = evaluate("C30/37", "silindir",
                   [{"group_no": "1", "values": [50.0, 30.0]}])
    assert res.verdict == "DEĞERLENDİRİLEMEDİ"
    assert res.recommendations


def test_invalid_group_excluded_from_fcm():
    groups = [
        {"group_no": "1", "values": [40.0, 40.5, 41.0]},
        {"group_no": "2", "values": [50.0, 30.0]},  # geçersiz
    ]
    res = evaluate("C30/37", "silindir", groups)
    assert res.n_valid == 1 and res.n_invalid == 1
    assert res.criterion1.applicable is False  # geçerli n=1
    assert any("geçersiz" in w for w in res.warnings)


def test_sampling_plan_warning():
    res = evaluate("C30/37", "silindir",
                   [{"group_no": "1", "values": [40.0, 41.0, 40.5]}],
                   volume_m3=350)
    assert any("grup" in w for w in res.warnings)  # 350 m3 -> en az 4 grup


def test_age_warning():
    res = evaluate("C30/37", "silindir",
                   [{"group_no": "1", "values": [40.0, 41.0, 40.5]}],
                   sampling_date=date(2023, 4, 16),
                   test_date=date(2023, 5, 10))
    assert res.age_days == 24
    assert any("Numune yaşı" in w for w in res.warnings)


def test_en206_initial_info():
    res = evaluate("C35/45", "silindir", _pdf_group_dicts())
    assert res.en206_initial is not None
    assert res.en206_initial.passed  # fcm ~46 >= 39 ve fci_min >= 31
