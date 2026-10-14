@echo off
rem ダブルクリックで外部公開（Cloudflare Quick Tunnel）。表示された https://....trycloudflare.com を相手に伝える
cd /d "%~dp0"
chcp 65001 >nul
python share.py
pause
