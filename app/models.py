# -*- coding: utf-8 -*-
"""API istek/yanıt ve AI veri çıkarma (extraction) Pydantic modelleri."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Değerlendirme isteği (frontend -> /api/evaluate)
# ---------------------------------------------------------------------------
class GroupInput(BaseModel):
    group_no: str = Field(..., description="Mikser / grup numarası")
    values: list[float] = Field(default_factory=list,
                                description="28 günlük basınç dayanımları (MPa)")
    slump_class: Optional[str] = Field(None, description="Beyan edilen çökme sınıfı (S1..S5)")
    slump_measured_mm: Optional[float] = Field(None, description="Ölçülen çökme (mm)")


class ProjectInfo(BaseModel):
    rapor_no: Optional[str] = None
    lab_adi: Optional[str] = None
    lab_izin_belge_no: Optional[str] = None
    yibf_no: Optional[str] = None
    deney_isteyen: Optional[str] = None
    yapi_denetim_kurulusu: Optional[str] = None
    muteahhit: Optional[str] = None
    yapi_sahibi: Optional[str] = None
    uretici_firma: Optional[str] = None
    santiye_adresi: Optional[str] = None
    pafta_ada_parsel: Optional[str] = None
    yapi_elemani: Optional[str] = None
    kat_kot_blok: Optional[str] = None
    numune_boyut_sekil: Optional[str] = None
    alinis_tarihi: Optional[str] = None      # ISO 'YYYY-MM-DD'
    deney_tarihi: Optional[str] = None       # ISO 'YYYY-MM-DD'
    degerlendiren: Optional[str] = None      # değerlendirmeyi yapan mühendis


class EvaluateRequest(BaseModel):
    concrete_class: str = Field(..., description="Örn. C35/45")
    basis: str = Field("silindir", description="'silindir' veya 'kup'")
    volume_m3: Optional[float] = None
    groups: list[GroupInput]
    project: ProjectInfo = Field(default_factory=ProjectInfo)


# ---------------------------------------------------------------------------
# AI veri çıkarma çıktısı (Claude vision -> structured output)
# ---------------------------------------------------------------------------
class ExtractedGroup(BaseModel):
    group_no: str = Field(..., description="Transmikser / grup sıra numarası")
    values: list[float] = Field(
        ..., description="Bu grubun 28 günlük basınç dayanımı değerleri (MPa), "
                         "raporda yazıldığı gibi")
    slump_class: Optional[str] = Field(
        None, description="Beyan edilen çökme sınıfı (S1..S5), varsa")
    slump_measured_cm: Optional[float] = Field(
        None, description="Ölçülen çökme değeri raporda cm ise cm olarak; yoksa null")
    slump_measured_mm: Optional[float] = Field(
        None, description="Ölçülen çökme değeri raporda mm ise mm olarak; yoksa null")


class ExtractedReport(BaseModel):
    """Türk beton deney raporundan (fotoğraf/PDF) çıkarılan veriler."""
    rapor_no: Optional[str] = None
    lab_adi: Optional[str] = Field(None, description="Laboratuvar firma adı")
    lab_izin_belge_no: Optional[str] = Field(
        None, description="Bakanlık laboratuvar izin belgesi numarası, varsa")
    yibf_no: Optional[str] = None
    deney_isteyen: Optional[str] = Field(
        None, description="Deney isteyen firma (genellikle yapı denetim kuruluşu)")
    muteahhit: Optional[str] = None
    yapi_sahibi: Optional[str] = None
    uretici_firma: Optional[str] = Field(None, description="Hazır beton üreticisi")
    santiye_adresi: Optional[str] = None
    pafta_ada_parsel: Optional[str] = None
    yapi_elemani: Optional[str] = Field(None, description="Örn. TEMEL, PERDE, DÖŞEME")
    kat_kot_blok: Optional[str] = None
    beton_sinifi: Optional[str] = Field(None, description="Örn. C35/45")
    beton_miktari_m3: Optional[float] = None
    alinan_numune_adedi: Optional[int] = None
    numune_boyut_sekil: Optional[str] = Field(
        None, description="Örn. '10x20 Silindir', '15 cm Küp'")
    sonuc_esasi: Optional[str] = Field(
        None,
        description="Rapordaki sonuçların hangi eşdeğere göre verildiği: "
                    "'silindir' (150x300 silindir eşdeğeri) veya 'kup' "
                    "(150 mm küp eşdeğeri). Raporun dipnotlarından belirle; "
                    "emin değilsen null bırak.")
    alinis_tarihi: Optional[str] = Field(None, description="Numune alınış tarihi, YYYY-MM-DD")
    lab_gelis_tarihi: Optional[str] = Field(None, description="YYYY-MM-DD")
    deney_tarihi: Optional[str] = Field(None, description="28 günlük deney tarihi, YYYY-MM-DD")
    gruplar: list[ExtractedGroup] = Field(
        default_factory=list,
        description="Her transmikser/grup için tekil dayanım değerleri")
    okuma_notlari: list[str] = Field(
        default_factory=list,
        description="Okunamayan, belirsiz veya çelişkili görülen alanlar için "
                    "kısa Türkçe uyarılar")
