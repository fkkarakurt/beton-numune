@echo off
rem Beton Numune Degerlendirme - yerel calistirma (statik uygulama)
cd /d "%~dp0"
start "" http://127.0.0.1:8756
python serve.py
pause
