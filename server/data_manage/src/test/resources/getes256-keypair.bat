@echo off
REM Generates an ES256 (P-256) key pair
REM compatible with app.auth.jwt.es256-public-key-pem / IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0getes256-keypair.ps1"
