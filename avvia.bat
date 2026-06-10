@echo off
title Lavallonea ROI Dashboard
cd /d "%~dp0"
echo.
echo  Avvio Lavallonea ROI Dashboard...
echo  Apri il browser su: http://localhost:3000
echo  (chiudi questa finestra per spegnere il server)
echo.
node server.js
pause
